import type { CaseArea } from "@/lib/case-area";
import type { CaseStatus } from "@/lib/case-status";

export type Role = "CLIENT" | "JUDGE" | "LAWYER" | "ADMIN";
export type User = { id: string; email: string; role: Role };
export type RedactionCount = { label: string; count: number };
export type CaseSummary = {
  id: string;
  title: string;
  status: CaseStatus;
  ai_probability_score: number | null;
  created_at: string;
};
export type Evidence = { id: string; filename: string; content_type: string; size_bytes: number; created_at: string };
export type CaseOwnerView = CaseSummary & {
  area: CaseArea;
  evidence_count: number;
  raw_text: string;
  anonymized_text: string;
  consent_at: string | null;
  consent_version: string | null;
  raw_text_erased_at: string | null;
};
export type Consent = { version: string; text: string };
export type CaseCreated = CaseOwnerView & { redactions: RedactionCount[] };
export type CaseForJudge = { id: string; title: string; anonymized_text: string; created_at: string; evidence_count: number; area: CaseArea };
export type CaseForLawyer = CaseSummary & {
  anonymized_text: string;
  evidence_count: number;
  area: CaseArea;
  suggested: boolean;
};
export type ReviewInput = { score_evidence: number; score_jurisprudence: number; notes?: string };
export type Review = {
  id: string;
  case_id: string;
  score_evidence: number;
  score_jurisprudence: number;
  notes: string | null;
  created_at: string;
};
export type AdminActivity = { audit_events: number; stepup_failures: number; rate_limit_hits: number };
export type AdminStats = {
  cases_by_status: Record<string, number>;
  users_by_role: Record<Role, number>;
  last_24h: AdminActivity;
};
export type AdminUser = {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  is_active: boolean;
  totp_enabled?: boolean;
};
export type TotpStatus = { enabled: boolean; recovery_codes_left: number };
export type TotpSetup = { secret: string; uri: string };
export type FieldError = { field: string; message: string };

export const HOME_FOR_ROLE: Record<Role, string> = {
  CLIENT: "/client",
  JUDGE: "/judge",
  LAWYER: "/lawyer",
  ADMIN: "/admin",
};

const FALLBACK_MESSAGE = "Não foi possível concluir a operação. Tente novamente.";

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldError[];
  // Set when the password was right but the account needs its second-factor code.
  readonly totpRequired: boolean;

  constructor(status: number, message: string, fieldErrors: FieldError[] = [], totpRequired = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.totpRequired = totpRequired;
  }
}

function parseError(status: number, body: unknown): ApiError {
  const data = (typeof body === "object" && body !== null ? body : {}) as {
    detail?: unknown;
    errors?: unknown;
    totp_required?: unknown;
  };
  const message = typeof data.detail === "string" ? data.detail : FALLBACK_MESSAGE;
  const fieldErrors = Array.isArray(data.errors) ? (data.errors as FieldError[]) : [];
  return new ApiError(status, message, fieldErrors, data.totp_required === true);
}

// Called when an authenticated call answers 401 (session expired); the
// SessionProvider registers a handler that marks the session anonymous, which
// makes RoleGate redirect to /login.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const AUTH_PROBES = new Set(["/api/auth/me", "/api/auth/login", "/api/auth/register"]);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return send<T>(path, { ...init, headers: init.body ? { "Content-Type": "application/json" } : undefined });
}

// Sends a File as the raw body (no JSON encoding); extra headers such as X-Filename are kept.
function rawRequest<T>(path: string, init: { method: string; body: File; headers?: Record<string, string> }): Promise<T> {
  return send<T>(path, { ...init, headers: { ...init.headers, "Content-Type": "application/octet-stream" } });
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor.");
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !AUTH_PROBES.has(path)) unauthorizedHandler?.();
    throw parseError(response.status, body);
  }
  return body as T;
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

export type Page = { limit?: number; offset?: number };

function withPage(path: string, page?: Page, extra?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  if (page?.limit !== undefined) params.set("limit", String(page.limit));
  if (page?.offset !== undefined) params.set("offset", String(page.offset));
  for (const [key, value] of Object.entries(extra ?? {})) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

const caseUrl = (id: string, suffix = "") => `/api/cases/${encodeURIComponent(id)}${suffix}`;

export const api = {
  register: (email: string, password: string) => post<User>("/api/auth/register", { email, password }),
  login: (email: string, password: string, totpCode?: string) =>
    post<User>("/api/auth/login", { email, password, ...(totpCode ? { totp_code: totpCode } : {}) }),
  totpStatus: () => request<TotpStatus>("/api/auth/totp"),
  totpSetup: (password: string) => post<TotpSetup>("/api/auth/totp/setup", { password }),
  totpEnable: (code: string) => post<{ recovery_codes: string[] }>("/api/auth/totp/enable", { code }),
  totpDisable: (password: string, code: string) => post<void>("/api/auth/totp/disable", { password, code }),
  adminResetTotp: (id: string, adminPassword: string) =>
    post<void>(`/api/admin/users/${encodeURIComponent(id)}/reset-totp`, { admin_password: adminPassword }),
  logout: () => post<void>("/api/auth/logout"),
  me: () => request<User>("/api/auth/me"),
  consent: () => request<Consent>("/api/consent"),
  createCase: (title: string, text: string, lgpdConsent: boolean, consentVersion: string, area?: CaseArea) =>
    post<CaseCreated>("/api/cases", {
      title,
      text,
      lgpd_consent: lgpdConsent,
      consent_version: consentVersion,
      ...(area ? { area } : {}),
    }),
  myCases: (page?: Page) => request<CaseSummary[]>(withPage("/api/cases/mine", page)),
  getCase: (id: string) => request<CaseOwnerView>(caseUrl(id)),
  approveCase: (id: string) => post<CaseOwnerView>(caseUrl(id, "/approve")),
  eraseOriginal: (id: string) => post<CaseOwnerView>(caseUrl(id, "/erase-original")),
  deleteCase: (id: string) => request<void>(caseUrl(id), { method: "DELETE" }),
  uploadEvidence: (caseId: string, file: File) =>
    rawRequest<Evidence>(caseUrl(caseId, "/evidence"), {
      method: "POST",
      body: file,
      headers: { "X-Filename": encodeURIComponent(file.name) },
    }),
  listEvidence: (caseId: string) => request<Evidence[]>(caseUrl(caseId, "/evidence")),
  deleteEvidence: (caseId: string, id: string) =>
    request<void>(caseUrl(caseId, `/evidence/${encodeURIComponent(id)}`), { method: "DELETE" }),
  // The owner's own file as a Blob (for in-app playback of voice notes).
  evidenceBlob: async (caseId: string, id: string): Promise<Blob> => {
    let response: Response;
    try {
      response = await fetch(caseUrl(caseId, `/evidence/${encodeURIComponent(id)}`), { credentials: "same-origin" });
    } catch {
      throw new ApiError(0, "Sem conexão com o servidor.");
    }
    if (!response.ok) throw new ApiError(response.status, "Não foi possível carregar o áudio.");
    return response.blob();
  },
  evidenceDownloadUrl: (caseId: string, id: string) => caseUrl(caseId, `/evidence/${encodeURIComponent(id)}`),
  judgeQueue: (page?: Page) => request<CaseForJudge[]>(withPage("/api/judge/queue", page)),
  submitReview: (id: string, review: ReviewInput) => post<Review>(caseUrl(id, "/reviews"), review),
  lawyerBoard: (page?: Page) => request<CaseForLawyer[]>(withPage("/api/lawyer/board", page)),
  lawyerAreas: () => request<{ areas: CaseArea[] }>("/api/lawyer/areas"),
  setLawyerAreas: (areas: CaseArea[]) =>
    request<{ areas: CaseArea[] }>("/api/lawyer/areas", { method: "PUT", body: JSON.stringify({ areas }) }),
  matchCase: (id: string) => post<CaseForLawyer>(caseUrl(id, "/match")),
  resolveCase: (id: string) => post<CaseForLawyer>(caseUrl(id, "/resolve")),
  adminStats: () => request<AdminStats>("/api/admin/stats"),
  adminUsers: (page?: Page, role?: Role) =>
    request<AdminUser[]>(withPage("/api/admin/users", page, { role })),
  adminCreateUser: (email: string, role: Exclude<Role, "CLIENT">, password: string, adminPassword?: string) =>
    post<User>("/api/admin/users", { email, role, password, ...(adminPassword ? { admin_password: adminPassword } : {}) }),
  adminDeactivate: (id: string, adminPassword?: string) =>
    post<void>(
      `/api/admin/users/${encodeURIComponent(id)}/deactivate`,
      adminPassword ? { admin_password: adminPassword } : undefined,
    ),
  adminReactivate: (id: string, adminPassword?: string) =>
    post<void>(
      `/api/admin/users/${encodeURIComponent(id)}/reactivate`,
      adminPassword ? { admin_password: adminPassword } : undefined,
    ),
  adminResetPassword: (id: string, newPassword: string, adminPassword: string) =>
    post<void>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
      new_password: newPassword,
      admin_password: adminPassword,
    }),
  adminRevokeSessions: (id: string) => post<void>(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`),
  changePassword: (current: string, next: string) =>
    post<void>("/api/auth/change-password", { current_password: current, new_password: next }),
  adminPitch: () => request<{ html: string }>("/api/admin/pitch"),
};
