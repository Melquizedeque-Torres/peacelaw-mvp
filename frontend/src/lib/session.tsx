"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { HOME_FOR_ROLE, api, setUnauthorizedHandler, type Role, type User } from "@/lib/api";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: User };

type SessionContextValue = {
  state: SessionState;
  setUser: (user: User | null) => void;
  // Marks a deliberate logout so RoleGate does not redirect to /login while the caller navigates home.
  beginLogout: () => void;
  endLogout: () => void;
  isLoggingOut: () => boolean;
};

// Keeps the same object when already anonymous so a repeated sign-out does not re-run RoleGate.
const toAnonymous = (prev: SessionState): SessionState =>
  prev.status === "anonymous" ? prev : { status: "anonymous" };

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: SessionState;
}) {
  const [state, setState] = useState<SessionState>(initialState ?? { status: "loading" });

  const loggingOut = useRef(false);
  const beginLogout = useCallback(() => {
    loggingOut.current = true;
  }, []);
  const endLogout = useCallback(() => {
    loggingOut.current = false;
  }, []);
  const isLoggingOut = useCallback(() => loggingOut.current, []);

  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    api.me().then(
      (user) => {
        if (!cancelled) setState({ status: "authenticated", user });
      },
      () => {
        if (!cancelled) setState({ status: "anonymous" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [initialState]);

  useEffect(() => {
    setUnauthorizedHandler(() => setState(toAnonymous));
    return () => setUnauthorizedHandler(null);
  }, []);

  const setUser = useCallback((user: User | null) => {
    if (user) loggingOut.current = false;
    setState(user ? { status: "authenticated", user } : toAnonymous);
  }, []);

  const value = useMemo(
    () => ({ state, setUser, beginLogout, endLogout, isLoggingOut }),
    [state, setUser, beginLogout, endLogout, isLoggingOut],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const context = use(SessionContext);
  if (!context) throw new Error("useSession precisa estar dentro de <SessionProvider>.");
  return context;
}

export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const { state, isLoggingOut, endLogout } = useSession();
  const router = useRouter();
  const allowed = state.status === "authenticated" && state.user.role === role;

  useEffect(() => {
    if (state.status === "anonymous") {
      // After a deliberate sign-out go home once, then behave normally again.
      if (isLoggingOut()) {
        endLogout();
        router.replace("/");
      } else router.replace("/login");
    }
    else if (state.status === "authenticated" && state.user.role !== role) {
      router.replace(HOME_FOR_ROLE[state.user.role]);
    }
  }, [state, role, router, isLoggingOut, endLogout]);

  if (!allowed) {
    return (
      <p role="status" className="p-8 text-slate-600">
        Carregando…
      </p>
    );
  }
  return children;
}

// Any authenticated user may pass; anonymous visitors go to /login (or / after a deliberate sign-out).
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, isLoggingOut, endLogout } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "anonymous") return;
    if (isLoggingOut()) {
      endLogout();
      router.replace("/");
    } else router.replace("/login");
  }, [state, router, isLoggingOut, endLogout]);

  if (state.status !== "authenticated") {
    return (
      <p role="status" className="p-8 text-slate-600">
        Carregando…
      </p>
    );
  }
  return children;
}
