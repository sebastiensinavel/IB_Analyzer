import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { DIST } from "./global-setup.js";
import { startServer, type StaticServer } from "./server.js";

/**
 * Serveur coupé (sous-projet 40, spec §8) : l'application s'ouvre depuis le Service Worker
 * serveur arrêté ou en 502, `/api` n'est jamais servi depuis un cache, une mise à jour attend
 * le clic du bandeau puis recharge tous les onglets — ou un rechargement de l'onglet, un seul,
 * même quand la version installée ne démarre plus —, et la première installation ne recharge
 * rien. Chaque test a son serveur sur un port libre, donc une origine et un Service Worker neufs.
 */

declare global {
  interface Window {
    __e2eMark?: number;
  }
}

let server: StaticServer;
test.beforeEach(async () => {
  server = await startServer(join(DIST, "a"));
});
test.afterEach(async () => {
  await server.stop().catch(() => {});
});

async function waitForControl(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function createAccount(page: Page) {
  await page.goto(`${server.url}/accounts`);
  await waitForControl(page);
  await page.getByLabel("Nom").fill("Alpha");
  await page.getByLabel("Identifiant de compte IB").fill("U1234567");
  await page.getByRole("button", { name: "Ajouter ce compte" }).click();
  await page.waitForURL(/\/accounts\/alpha\/sources$/);
}

test("serveur arrêté : une route profonde, /login et /invitation s'ouvrent", async ({ page }) => {
  await createAccount(page);
  await server.stop();

  await page.goto(`${server.url}/accounts/alpha/history`);
  await expect(page.getByRole("heading", { level: 1, name: "Historique" })).toBeVisible();
  await expect(page.getByText("Alpha").first()).toBeVisible();

  await page.goto(`${server.url}/login`);
  await expect(page.getByRole("heading", { level: 1, name: "Compte serveur" })).toBeVisible();

  await page.goto(`${server.url}/invitation/abc`);
  await expect(page.getByText("Accepter l'invitation")).toBeVisible();
});

test("502 : la page du compte s'affiche", async ({ page }) => {
  await createAccount(page);
  server.setMode("502");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Sources de données" })).toBeVisible();
});

test("/api n'est jamais servi depuis un cache", async ({ page }) => {
  await createAccount(page);
  const ping = () => page.evaluate(() => fetch("/api/ping").then((r) => r.json() as Promise<{ hits: number }>));
  const first = await ping();
  expect(first.hits).toBeGreaterThan(0);
  expect(server.apiHits()).toBe(first.hits);

  await server.stop();
  await expect(ping()).rejects.toThrow();
  // Une navigation vers /api n'obtient pas index.html du Service Worker : elle échoue.
  await expect(page.goto(`${server.url}/api/ping`)).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
});

test("mise à jour : un clic sur « Recharger » recharge les deux onglets", async ({ context }) => {
  const first = await context.newPage();
  await first.goto(`${server.url}/accounts`);
  await waitForControl(first);

  const second = await context.newPage();
  await second.goto(`${server.url}/accounts`);
  if (!(await second.evaluate(() => navigator.serviceWorker.controller !== null))) await second.reload();
  await waitForControl(second);

  for (const page of [first, second]) await page.evaluate(() => (window.__e2eMark = 1));

  server.setRoot(join(DIST, "b"));
  await first.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r!.update()));

  for (const page of [first, second]) {
    await expect(page.getByRole("status").filter({ hasText: "Nouvelle version disponible" })).toBeVisible();
  }

  await first.getByRole("button", { name: "Recharger" }).click();

  for (const page of [first, second]) {
    await page.waitForFunction(() => window.__e2eMark === undefined);
    await expect(page.getByRole("status").filter({ hasText: "Nouvelle version disponible" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter ce compte" })).toBeVisible();
  }
});

test("première installation : l'onglet passe sous contrôle sans recharger", async ({ page }) => {
  await page.goto(`${server.url}/accounts`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (window.__e2eMark = 1));
  await waitForControl(page);
  // Un rechargement déclenché par `controllerchange` partirait juste après : lui laisser le temps.
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__e2eMark)).toBe(1);
});

const banner = (page: Page) => page.getByRole("status").filter({ hasText: "Nouvelle version disponible" });

test("version cassée : un correctif publié s'applique en un seul rechargement", async ({ page }) => {
  await page.goto(`${server.url}/accounts`);
  await waitForControl(page);

  // Publier la version cassée et l'appliquer par le bandeau : l'application ne démarre plus.
  server.setRoot(join(DIST, "broken"));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r!.update()));
  await banner(page).getByRole("button", { name: "Recharger" }).click();
  await page.waitForSelector('meta[name="e2e-version"][content="broken"]', { state: "attached" });
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => document.getElementById("root")!.childElementCount)).toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Publier le correctif : un seul F5, jamais un second.
  server.setRoot(join(DIST, "fixed"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Ajouter ce compte" })).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('meta[name="e2e-version"]').count()).toBe(0);
});

test("un simple chargement n'applique pas la version en attente", async ({ context }) => {
  const first = await context.newPage();
  await first.goto(`${server.url}/accounts`);
  await waitForControl(first);
  await first.evaluate(() => (window.__e2eMark = 1));

  server.setRoot(join(DIST, "b"));
  await first.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r!.update()));
  await expect(banner(first)).toBeVisible();

  // Un nouvel onglet est une navigation, pas un rechargement : le bandeau reste la règle.
  const second = await context.newPage();
  await second.goto(`${server.url}/accounts`);
  await waitForControl(second);
  await second.evaluate(() => (window.__e2eMark = 1));
  await expect(banner(second)).toBeVisible();
  await second.waitForTimeout(1_500);

  for (const page of [first, second]) {
    expect(await page.evaluate(() => window.__e2eMark)).toBe(1);
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r!.waiting !== null))).toBe(true);
  }
});
