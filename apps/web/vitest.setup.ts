import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
// Side effect only: registers the app's i18next instance as react-i18next's global default
// (see initReactI18next), so `useTranslation()` resolves real strings even in a test that
// renders a page directly, without wrapping it in an <I18nextProvider> (task 14's
// LoginPage.test.tsx does exactly that — its assertions match on the translated text).
import "@/i18n";

// This project's vitest config doesn't set `test.globals: true`, so
// @testing-library/react's automatic afterEach(cleanup) never registers.
// Every prior test file only rendered once, so the gap was invisible;
// a file with multiple `it`s that each call `render` needs this explicitly.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia. shadcn/ui's Sidebar primitive (Task 7)
// uses it via the useIsMobile hook, so any test that mounts <SidebarProvider>
// needs this polyfill in place.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// ECharts (Task 5's Wheel capital charts) measures label text through a 2D canvas context;
// jsdom has none and logs a warning on every call, so this stub gives back jsdom's own `null`
// silently — behaviour is unchanged, only the noise is gone.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom's window carries its own Uint8Array/ArrayBuffer, a realm distinct from the one
// Node's native TextEncoder/TextDecoder, fetch's Response, WebCrypto and
// CompressionStream/DecompressionStream build their results with — those bypass jsdom
// entirely and stay bound to the outer Node process's intrinsics. Left alone, application
// code that writes the bare `new Uint8Array(...)` (the sub-project 6 backup's gzip/AES-GCM
// round trip in db/backup/crypto.ts, for one) gets jsdom's copy back, and a test comparing
// it against a TextEncoder-produced array (`toEqual`) fails on prototype identity despite
// byte-identical content — the failure shows "no visual difference" because the bytes truly
// do match. Re-pointing the global at Node's own intrinsic, reached through Buffer (a global
// jsdom never touches), removes the split for the whole suite instead of coping with it in
// every test that happens to mix the two.
{
  const nodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as typeof Uint8Array;
  if (globalThis.Uint8Array !== nodeUint8Array) {
    globalThis.Uint8Array = nodeUint8Array;
  }
}
