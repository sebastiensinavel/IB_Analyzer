import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ib2:theme";

type Listener = () => void;

const listeners = new Set<Listener>();

function readStoredIsDark(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark";
  } catch {
    return false;
  }
}

let isDark = readStoredIsDark();
let synced = false;

function syncDocument() {
  document.documentElement.classList.toggle("dark", isDark);
  synced = true;
}

function setIsDark(next: boolean) {
  isDark = next;
  syncDocument();
  try {
    window.localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");
  } catch {
    // Best-effort only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (!synced) {
    syncDocument();
  }
  return isDark;
}

// Called once at startup (main.tsx), before any component renders: the class must be
// right on the very first paint of pages that never call useTheme() themselves (Positions,
// Historique, un Journal), not just lazily once some other page's hook happens to mount.
export function applyStoredTheme() {
  syncDocument();
}

// Shared across every caller (module-scoped store, not per-call useState): the
// DOM class and every consumer's rendered colors must move together on toggle.
export function useTheme() {
  const isDarkValue = useSyncExternalStore(subscribe, getSnapshot);
  return { isDark: isDarkValue, toggleTheme: () => setIsDark(!isDark) };
}
