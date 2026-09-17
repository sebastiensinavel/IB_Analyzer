import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { devPorts } from "../../tools/dev-env/ports.mjs";

// 5173 / 8000 in the main checkout, an offset per git worktree: two checkouts served at
// the same time never answer for each other (tools/dev-env/ports.mjs).
const ports = devPorts();
const api = `http://127.0.0.1:${ports.api}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": `${import.meta.dirname}/src` },
  },
  server: {
    host: "127.0.0.1",
    port: ports.web,
    // Failing beats sliding to the next free port: a driver or a human expecting this
    // checkout on its port would otherwise reach whatever else is listening there.
    strictPort: true,
    // Reconstitutes in development the single origin Traefik gives us in production: the
    // SPA (5173) and Django (8000) would otherwise be two origins, and the whole session /
    // CSRF / Flex-proxy design assumes one (spec §3, §6).
    //
    // `changeOrigin: false` (the object form, not the bare-string shorthand, which defaults
    // it to `true`) is load-bearing, not a style choice: with it left `true`, Vite rewrites
    // the `Host` header to `127.0.0.1:8000` on its way to Django, while the browser's `Origin`
    // header still reads `http://127.0.0.1:5173` — Django's CSRF middleware compares the two
    // and rejects every unsafe request with "Origin checking failed" (constaté while writing
    // this task's e2e tests). Leaving `Host` untouched keeps it equal to `Origin`, which is
    // what actually reconstitutes a single origin for CSRF purposes, not just for routing.
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/_allauth": { target: api, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright owns everything under e2e/ (see playwright.config.ts); `pnpm check` never
    // runs Playwright, and vitest's own default include glob would otherwise happily pick up
    // `*.spec.ts` files there and try to run them as unit tests.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
