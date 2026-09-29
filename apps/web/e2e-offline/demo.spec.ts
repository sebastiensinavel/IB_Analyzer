import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DIST } from "./global-setup.js";
import { startServer, type StaticServer } from "./server.js";

/**
 * Démonstration (sous-projet 41) : un navigateur neuf arrive sur l'accueil, entre dans la démo,
 * la quitte sans laisser de trace ; les captures de l'accueil ne sont jamais pré-cachées.
 */

let server: StaticServer;
test.beforeEach(async () => {
  server = await startServer(join(DIST, "a"));
});
test.afterEach(async () => {
  await server.stop().catch(() => {});
});

test("un navigateur neuf arrive sur l'accueil, explore la démo et la quitte sans trace", async ({ page }) => {
  await page.goto(`${server.url}/`);
  await page.waitForURL(/\/welcome$/);
  await page.getByRole("button", { name: "Explorer la démo" }).click();
  await page.waitForURL(/\/accounts\/demo\/dashboard$/);
  await expect(page.getByRole("status").filter({ hasText: "Mode démonstration" })).toBeVisible();
  await expect(page.getByText(/En direct/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Quitter la démo" }).click();
  await page.waitForURL(/\/welcome$/);
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names).not.toContain("ib-analyzer-demo");
  const flag = await page.evaluate(() => sessionStorage.getItem("ib2:demo"));
  expect(flag).toBeNull();
});

test("les captures ne sont pas pré-cachées", async ({ page }) => {
  await page.goto(`${server.url}/welcome`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = (await Promise.all(keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat();
    return { all: urls, welcome: urls.filter((u) => u.includes("/welcome/")) };
  });
  // Positive checks first: the precache is populated, so an empty welcome list is meaningful.
  expect(cached.all.length).toBeGreaterThan(0);
  expect(cached.all.some((u) => /\.js$/.test(u) || u.endsWith("index.html"))).toBe(true);
  expect(cached.welcome).toEqual([]);
  // The shots exist in the build and are served: they are just not precached.
  const shot = await page.evaluate(async () => {
    const r = await fetch("/welcome/dashboard.light.fr.webp");
    return { status: r.status, type: r.headers.get("content-type") };
  });
  expect(shot.status).toBe(200);
  expect(shot.type).toMatch(/^image\//);
});
