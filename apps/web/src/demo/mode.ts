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

/** Full-page navigation, behind an object so tests can replace it (jsdom does not navigate). */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
