#!/usr/bin/env node
// Régénère les captures de /welcome depuis la démonstration (sous-projet 41, spec §7) :
// `pnpm screenshots`. Démarre ou réutilise le Vite du checkout (tools/dev-env/ports.mjs), ouvre
// l'application en mode démo, horloge figée, et écrit public/welcome/<id>.<thème>.<langue>.webp.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { devPorts } from "../../../tools/dev-env/ports.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(WEB, "..", "..");
const OUT = join(WEB, "public", "welcome");
const BASE = `http://127.0.0.1:${devPorts(`${ROOT}/`).web}`;
// A Friday during the session, New York time: every capture shows the same day. The browser runs
// in New York too, so « En direct » reads the session's hour, not the machine's.
const TIME_ZONE = "America/New_York";
const FROZEN = new Date("2026-09-25T15:00:00-04:00");
const VIEWPORT = { width: 1280, height: 800 };
const CHART_SETTLE_MS = 1200;
const WAIT_MS = 15_000;

async function isUp() {
  try {
    return (await fetch(BASE, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function ensureVite() {
  if (await isUp()) return null;
  const port = new URL(BASE).port;
  const server = spawn("pnpm", ["--filter", "web", "exec", "vite", "--port", port, "--strictPort"], { cwd: ROOT, detached: true, stdio: "ignore" });
  for (let i = 0; i < 60; i += 1) {
    if (await isUp()) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite did not answer on ${BASE}`);
}

// The action a shot needs before its capture (`ShotSpec.prepare`, src/welcome/shots.ts).
const PREPARE = {
  // CondorRows: the fold button carries `journal.expand` as its accessible name.
  "expand-first-condor": async (page) => {
    await page.locator("main table").getByRole("button", { name: /Voir les jambes|Show legs/ }).first().click();
    await page.getByRole("button", { name: /Masquer les jambes|Hide legs/ }).first().waitFor({ timeout: WAIT_MS });
  },
  // StrategyPositionsPage: a click on a position row opens its PositionChartRow below it.
  "open-first-chart": async (page) => {
    await page.locator("main table tbody tr.cursor-pointer").first().click();
    await page.locator("[data-testid=position-chart-row] canvas").first().waitFor({ timeout: WAIT_MS });
  },
  // The sidebar trigger of AppLayout's header; the sidebar reopens at the next navigation (its cookie
  // is written, never read).
  "collapse-sidebar": async (page) => {
    await page.locator("[data-sidebar=trigger]").first().click();
    await page.locator("[data-slot=sidebar][data-state=collapsed]").first().waitFor({ timeout: WAIT_MS });
    await page.waitForTimeout(400);
  },
};

const server = await ensureVite();
const { chromium } = await import(pathToFileURL(join(WEB, "node_modules/playwright/index.mjs")).href);
const sharp = (await import("sharp")).default;
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const errors = [];

async function openDemo(theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: theme, timezoneId: TIME_ZONE });
  await context.addInitScript((t) => {
    window.sessionStorage.setItem("ib2:demo", "1");
    window.localStorage.setItem("ib2:theme", t);
  }, theme);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // No Django (502 from Vite's proxy) or nobody signed in (401 from allauth): the session reads
    // `unreachable` or `anonymous`, which render alike — a visitor's state, never an error.
    const path = new URL(m.location().url || BASE, BASE).pathname;
    if (/^\/(api|_allauth)\//.test(path) && /\b(401|502)\b/.test(m.text())) return;
    errors.push(`${page.url()}: ${m.text()}`);
  });
  // `install`, never `setFixedTime`: a Date frozen for good also freezes zrender's animation clock,
  // and every ECharts gauge and donut would stay an empty ring. Installed at FROZEN, time flows
  // from there: a whole run stays within the same minute of « En direct ».
  await page.clock.install({ time: FROZEN });
  return { context, page };
}

try {
  const first = await openDemo("light");
  await first.page.goto(`${BASE}/welcome`, { waitUntil: "networkidle" });
  const manifest = await first.page.evaluate(() =>
    import("/src/welcome/shots.ts").then((m) => ({ shots: m.SHOTS, themes: m.SHOT_THEMES, languages: m.SHOT_LANGUAGES, width: m.SHOT_WIDTH, height: m.SHOT_HEIGHT })),
  );
  await first.context.close();

  for (const theme of manifest.themes) {
    for (const lang of manifest.languages) {
      const { context, page } = await openDemo(theme);
      for (const shot of manifest.shots) {
        await page.goto(`${BASE}${shot.route}`, { waitUntil: "networkidle" });
        await page.evaluate((l) => import("/src/i18n/index.ts").then((m) => m.default.changeLanguage(l)), lang);
        // `snapshot.live`, « En direct, {{time}} » / "Live, {{time}}": the simulated agent has passed.
        await page.getByText(/En direct, |Live, /).first().waitFor({ timeout: WAIT_MS });
        await page.locator(shot.waitFor).first().waitFor({ timeout: WAIT_MS });
        if (shot.prepare) await PREPARE[shot.prepare](page);
        if (shot.scrollTo) await page.locator(shot.scrollTo).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.evaluate(() => document.fonts.ready);
        // Away from any chart: lightweight-charts draws its crosshair under the pointer of the last click.
        await page.mouse.move(0, 0);
        if ((await page.locator("[_echarts_instance_]").count()) > 0) await page.waitForTimeout(CHART_SETTLE_MS);
        const png = await page.screenshot();
        const file = join(OUT, `${shot.id}.${theme}.${lang}.webp`);
        await sharp(png).resize(manifest.width, manifest.height).webp({ quality: 85 }).toFile(file);
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (server) process.kill(-server.pid, "SIGTERM");
}

if (errors.length > 0) {
  console.error(`\n${errors.length} console/page error(s) during the captures:\n${errors.join("\n")}`);
  process.exitCode = 1;
}
