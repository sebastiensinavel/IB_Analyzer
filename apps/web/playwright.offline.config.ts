import { defineConfig } from "@playwright/test";

/**
 * Le Service Worker contre un vrai build de production (sous-projet 40). À part des e2e
 * existants, qui tournent sur `pnpm dev` et Django : ici ni Vite en mode dev, ni Django. Chaque
 * test démarre son propre serveur (e2e-offline/server.ts) sur un port libre, donc une origine
 * neuve et un Service Worker neuf. Pas dans `pnpm check`.
 */
export default defineConfig({
  testDir: "./e2e-offline",
  globalSetup: "./e2e-offline/global-setup.ts",
  workers: 1,
  timeout: 60_000,
  use: { browserName: "chromium" },
});
