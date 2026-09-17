import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchSession,
  login as allauthLogin,
  logout as allauthLogout,
  type AllauthResult,
  type SessionUser,
} from "./allauth";
import { ensureCsrfCookie } from "./client";

/**
 * The server is optional (spec §2): a login is never required to use the app, only to reach
 * the Flex proxy. `loading` is the transient initial fetch; `anonymous`, `authenticated` and
 * `unreachable` are the three states an idle app can settle into. `unreachable` renders like
 * `anonymous` with a discreet note — never an error thrown across the UI.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "unreachable" }
  | { status: "authenticated"; user: SessionUser };

interface SessionActions {
  /**
   * Returns the raw allauth result, not just the derived SessionState: a rejected password
   * and a valid password pending a second factor both leave the session unauthenticated, but
   * task 14 needs to tell them apart (`result.kind`) to drive the 2FA step.
   */
  login: (email: string, password: string) => Promise<AllauthResult<SessionUser>>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({ status: "loading" });
const ActionsContext = createContext<SessionActions>({
  login: async () => ({ ok: false, kind: "unreachable" }),
  logout: async () => {},
  refresh: async () => {},
});

function toState(result: AllauthResult<SessionUser>): SessionState {
  if (result.ok) return { status: "authenticated", user: result.value };
  return result.kind === "unreachable" ? { status: "unreachable" } : { status: "anonymous" };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      await ensureCsrfCookie();
    } catch {
      // A network failure fetching the CSRF cookie is never an error shown across the app
      // (spec §2): the server is optional. `fetchSession()` below independently reports
      // "unreachable" for the same failure via allauth's own try/catch.
    }
    setState(toState(await fetchSession()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const actions = useMemo<SessionActions>(
    () => ({
      refresh,
      login: async (email: string, password: string) => {
        const result = await allauthLogin(email, password);
        setState(toState(result));
        return result;
      },
      logout: async () => {
        await allauthLogout();
        setState({ status: "anonymous" });
      },
    }),
    [refresh],
  );

  return (
    <SessionContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function useSessionActions(): SessionActions {
  return useContext(ActionsContext);
}
