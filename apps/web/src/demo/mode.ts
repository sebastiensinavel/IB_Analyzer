import Dexie from "dexie";

/**
 * The demonstration mode (sub-project 41): the only reader of the per-tab flag. Entering or
 * leaving always reloads the page, so everything decided from it — the database name first —
 * is fixed for the life of the tab. Nothing here depends on the server session.
 */
export const DEMO_FLAG = "ib2:demo";
export const DEMO_DB_NAME = "ib-analyzer-demo";
export const REAL_DB_NAME = "ib-analyzer";
export const DEMO_ACCOUNT_ID = "demo";

export function isDemo(): boolean {
  try {
    return window.sessionStorage.getItem(DEMO_FLAG) === "1";
  } catch {
    return false;
  }
}

export function databaseName(): string {
  return isDemo() ? DEMO_DB_NAME : REAL_DB_NAME;
}

/** A display key of localStorage, moved under `ib2:demo:` in the demo: a real account may be named "demo". */
export function storageKey(key: string): string {
  return isDemo() && key.startsWith("ib2:") ? `ib2:demo:${key.slice(4)}` : key;
}

/**
 * Whether the real base holds an account, asked from the demo, whose own base says nothing of
 * it. Read through a connection of its own, closed at once; an absent base is never created.
 */
export async function hasRealAccounts(): Promise<boolean> {
  try {
    if (!(await Dexie.exists(REAL_DB_NAME))) return false;
    const real = new Dexie(REAL_DB_NAME);
    try {
      await real.open();
      if (!real.tables.some((table) => table.name === "accounts")) return false;
      return (await real.table("accounts").count()) > 0;
    } finally {
      real.close();
    }
  } catch {
    return false;
  }
}

/** Full-page navigation, behind an object so tests can replace it (jsdom does not navigate). */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

export function enterDemo(): void {
  try {
    window.sessionStorage.setItem(DEMO_FLAG, "1");
  } catch {
    return; // No per-tab storage: the demo cannot be kept apart, so it does not start.
  }
  navigation.assign(`/accounts/${DEMO_ACCOUNT_ID}/dashboard`);
}

/** Deletes the demo base and every demo key; the real base and keys are never touched. */
export async function clearDemo(db: Dexie): Promise<void> {
  db.close();
  await Dexie.delete(DEMO_DB_NAME);
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("ib2:demo:")) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
    window.sessionStorage.removeItem(DEMO_FLAG);
  } catch {
    // Best-effort, like every other storage access.
  }
}

export async function leaveDemo(db: Dexie, destination = "/welcome"): Promise<void> {
  await clearDemo(db);
  navigation.assign(destination);
}
