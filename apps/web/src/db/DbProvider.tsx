import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/api/session";
import { adoptDefaultProfile, profileDb } from "./profile";
import { db, type AppDatabase } from "./schema";

const DbContext = createContext<AppDatabase>(db);
// Whether the last profile-open attempt fell back to the default profile after failing.
// Read by SettingsPage to surface a discreet notice — this used to be only a
// `console.error`, invisible to a signed-in user whose profile silently came up empty.
const DbErrorContext = createContext(false);

/** Every hook and every writer reads its database here, never by import. */
export function useDb(): AppDatabase {
  return useContext(DbContext);
}

export function useDbError(): boolean {
  return useContext(DbErrorContext);
}

export function DbProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === "authenticated" ? session.user.id : null;
  const [ready, setReady] = useState<AppDatabase>(db);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      try {
        if (userId !== null) await adoptDefaultProfile(userId);
        const next = profileDb(userId);
        await next.open();
        if (!cancelled) {
          setReady(next);
          setFailed(false);
        }
      } catch (error) {
        // Never an unhandled rejection, and never a silent stay on the
        // previous `ready` value either: that value can belong to a
        // different session (the one before this login, or before this
        // logout), and leaving it on screen with nothing to say so *is*
        // showing another profile's data. Falling back to the default
        // profile is always a safe, visible choice — it never belongs to
        // any authenticated user, so at worst it reads as freshly empty,
        // never as someone else's portfolio.
        console.error("Failed to open the IndexedDB profile for the current session", error);
        if (!cancelled) {
          setReady(db);
          setFailed(true);
        }
      }
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <DbContext.Provider value={ready}>
      <DbErrorContext.Provider value={failed}>{children}</DbErrorContext.Provider>
    </DbContext.Provider>
  );
}
