const STORAGE_KEY = "ib2:lastAccountId";

export function getLastAccountId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastAccountId(accountId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, accountId);
  } catch {
    // Best-effort only (e.g. storage disabled in private browsing).
  }
}

export function clearLastAccountId(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above.
  }
}
