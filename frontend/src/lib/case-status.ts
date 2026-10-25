export type CaseStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "READY_FOR_JUDGE"
  | "EVALUATED"
  | "IN_MEDIATION"
  | "RESOLVED";

// Mirrors backend app/lifecycle.py.
export const canApprove = (s: CaseStatus) => s === "AWAITING_APPROVAL";
export const canDelete = (s: CaseStatus) => s === "AWAITING_APPROVAL" || s === "READY_FOR_JUDGE";
export const isAwaitingJudges = (s: CaseStatus) => s === "READY_FOR_JUDGE";
export const isEvaluated = (s: CaseStatus) => s === "EVALUATED";
export const isInMediation = (s: CaseStatus) => s === "IN_MEDIATION";
export const isResolved = (s: CaseStatus) => s === "RESOLVED";
