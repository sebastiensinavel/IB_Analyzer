#!/usr/bin/env node
// Agent driver for the IB Analyzer web app: starts (or reuses) the Vite dev
// server, drives the app in headless Chromium, and writes screenshots.
//
//   node .claude/skills/run-frontend/driver.mjs <route> [route...] [options]
//
// Options:
//   --dark            flip the app's own theme toggle before shooting
//   --seed            seed IndexedDB with two demo accounts and a sample ledger (src/mocks/seed.ts)
//   --empty           create the two demo accounts with no data at all: a user's first visit (exclusive with --seed)
//   --out=<dir>       where PNGs land (default: /tmp/ib-frontend-shots)
//   --width=<px>      viewport width (default 1280)
//   --height=<px>     viewport height (default 800)
//   --port=<n>        dev server port (default: this checkout's own, see tools/dev-env/ports.mjs —
//                     5173 in the main checkout, 5173+N in the git worktree holding slot N)
//   --keep            leave the dev server running after the run
//   --ib-account=<id> after --seed or --empty, set the IB account id of the first route's account (to import a real file)
//   --import=<file>   upload a Flex XML or statement HTML on the Sources page of the first route's account; repeatable, in order
//   --sectors=<file>  upload a sector CSV on the Sector and Score page of the first route's account
//   --agent           stub the local agent (127.0.0.1:8100) with src/mocks/agent-snapshot.json and set a TWS port on the first route's account
//   --wait=<ms>       pause this long before each shot, whatever the page holds. Without it, a page
//                     holding an ECharts chart ([_echarts_instance_]) gets 1200 ms, so the shot shows
//                     the chart after its entry animation (about 1 s), never halfway; any other page
//                     is shot at once
//
// Exits non-zero if any route logged a console/page error: there is no
// backend any more, so every console error is fatal.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import agentSnapshot from "../../../apps/web/src/mocks/agent-snapshot.json" with { type: "json" };
import { AGENT_PORT, describePorts, devPorts } from "../../../tools/dev-env/ports.mjs";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
// playwright is a devDependency of apps/web only, so it lives under
// apps/web/node_modules — not reachable from here by ancestor lookup, hence
// the explicit path instead of a bare `from "playwright"` import.
const { chromium } = await import(pathToFileURL(`${REPO_ROOT}apps/web/node_modules/playwright/index.mjs`));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);
const flagsOf = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
if (has("seed") && has("empty")) throw new Error("--seed and --empty are exclusive");

const routes = args.filter((a) => !a.startsWith("--"));
if (routes.length === 0) routes.push("/accounts/alpha/dashboard");

// Each checkout has its own port, so "reuse whatever listens there" is safe: a server on
// this port serves this checkout's code, never the main checkout's (or another worktree's).
const ports = devPorts(REPO_ROOT);
const PORT = Number(flag("port", String(ports.web)));
const BASE = `http://127.0.0.1:${PORT}`;
console.log(describePorts({ ...ports, web: PORT }));
const OUT = flag("out", "/tmp/ib-frontend-shots");
const VIEWPORT = { width: Number(flag("width", "1280")), height: Number(flag("height", "800")) };

mkdirSync(OUT, { recursive: true });

async function isUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await isUp()) {
    console.log(`dev server: reusing the one already on ${BASE}`);
    return null;
  }
  const proc = spawn("pnpm", ["--filter", "web", "exec", "vite", "--port", String(PORT), "--strictPort"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  proc.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  for (let i = 0; i < 60; i++) {
    if (await isUp()) {
      console.log(`dev server: started on ${BASE}`);
      return proc;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite never came up on ${BASE} — is the port taken?`);
}

const server = await startServer();
const browser = await chromium.launch();
let failed = false;

try {
  for (const route of routes) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    let apiDown = false;
    let anonymous = false;
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // No Django on this checkout's API port: Vite's proxy answers 502 on /api and
      // /_allauth, the browser logs it, and SessionProvider is built to tolerate it (the
      // app never requires a login). Not a page error — just note it once.
      const path = new URL(m.location().url || BASE, BASE).pathname;
      if (/^\/(api|_allauth)\//.test(path) && /\b502\b/.test(m.text())) {
        apiDown = true;
        return;
      }
      // Django *is* up, and nobody is signed in: allauth answers its session probe with a 401,
      // which is the app's normal anonymous state — no route of the SPA ever requires a login.
      // Not a page error either; just note it once.
      if (/^\/_allauth\//.test(path) && /\b401\b/.test(m.text())) {
        anonymous = true;
        return;
      }
      errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    if (has("seed")) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedDemo()));
    }
    if (has("empty")) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedAccounts()));
    }

    const account = routes[0].match(/^\/accounts\/([^/]+)/)?.[1];
    const ibAccount = flag("ib-account");
    if (!account && (ibAccount || flagsOf("import").length > 0 || flag("sectors"))) {
      throw new Error(`--ib-account/--import/--sectors need the first route to be /accounts/<id>/..., got "${routes[0]}"`);
    }
    if (ibAccount) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([id, ibAccountId]) => import("/src/db/schema.ts").then((m) => m.db.accounts.update(id, { ibAccountId })),
        [account, ibAccount],
      );
    }
    if (has("agent")) {
      if (!account) throw new Error(`--agent needs the first route to be /accounts/<id>/..., got "${routes[0]}"`);
      // Playwright answers instead of a real agent. The Allow-Origin header matters: a
      // fulfilled cross-origin response still goes through the browser's CORS check.
      await page.route(`http://127.0.0.1:${AGENT_PORT}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(path === "/health" ? { version: "0.1.0" } : agentSnapshot),
        });
      });
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([id]) => import("/src/db/schema.ts").then((m) => m.db.accounts.update(id, { twsPort: 7502 })),
        [account],
      );
    }
    for (const [name, label, reportId, path] of [
      ["import", /importer des fichiers|import files/i, "import-report", "sources"],
      ["sectors", /importer un csv|import a csv/i, "sector-report", "sectors"],
    ]) {
      for (const file of flagsOf(name)) {
        await page.goto(`${BASE}/accounts/${account}/${path}`, { waitUntil: "networkidle" });
        await page.getByLabel(label).setInputFiles(file);
        await page.getByTestId(reportId).waitFor();
      }
    }

    if (has("dark")) {
      // The app stores its theme itself; Playwright's colorScheme does nothing. Since
      // sub-project 28 the toggle only lives on the Settings page (the "Affichage" card),
      // not in a global menu footer any more, so flip it there first: the flag persists in
      // localStorage, and the target route below picks it up on its own fresh navigation.
      await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /thème|theme/i }).first().click();
      await page.waitForTimeout(400);
    }

    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

    if (has("dark")) {
      // useTheme() only mirrors localStorage onto <html class="dark"> as a side effect of
      // its own hook running (Dashboard/Stats' charts, an open price chart, or the Settings
      // toggle) — nothing does it at the app root. A route whose page never calls the hook
      // (Positions, History, a Journal) would otherwise land on this fresh navigation still
      // showing the light class list even though localStorage says dark. Sync it by hand
      // instead of hoping some component on the page happens to call the hook.
      await page.evaluate(() => {
        document.documentElement.classList.toggle("dark", localStorage.getItem("ib2:theme") === "dark");
      });
    }

    // An ECharts chart animates its entry for about a second: shot at networkidle, its lines
    // stop short and their end labels sit halfway. --wait overrides the guess either way.
    const charts = await page.locator("[_echarts_instance_]").count();
    const wait = Number(flag("wait", charts > 0 ? "1200" : "0"));
    if (wait > 0) await page.waitForTimeout(wait);

    const name =(route.replace(/^\//, "").replace(/\//g, "-") || "root") + (has("dark") ? "-dark" : "");
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const sidebar = page.locator('[data-slot="sidebar-container"]').first();
    if (await sidebar.count()) {
      await sidebar.screenshot({ path: `${OUT}/${name}-sidebar.png` }).catch(() => {});
    }

    if (errors.length) failed = true;
    console.log(
      `${route} -> ${OUT}/${name}.png  (landed on ${new URL(page.url()).pathname}${wait > 0 ? `, waited ${wait} ms` : ""})` +
        (apiDown ? `\n    api: no Django on :${ports.api}, /api and /_allauth answered 502 (tolerated, session unreachable)` : "") +
        (anonymous ? `\n    api: Django on :${ports.api} answered 401 on /_allauth (tolerated, nobody signed in)` : "") +
        (errors.length ? `\n    ERRORS: ${errors.join(" | ")}` : ""),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  if (server && !has("keep")) process.kill(-server.pid, "SIGTERM");
  else if (server) console.log(`dev server left running on ${BASE} (pid ${server.pid})`);
}

process.exit(failed ? 1 : 0);
