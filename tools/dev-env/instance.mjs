#!/usr/bin/env node
/**
 * This checkout's development instance — Vite and Django on its own ports (ports.mjs) —
 * running in the background, so that it outlives the shell that started it:
 *
 *   pnpm dev:start    start what is not answering yet, wait until it answers
 *   pnpm dev:status   what answers on this checkout's ports
 *   pnpm dev:stop     stop whatever listens on this checkout's ports
 *
 * A worktree leaves its instance running once its plan is done, for a human to look at the
 * branch before merging, and stops it before the merge (CLAUDE.md, Workflow). Logs land in
 * the checkout's git directory (`dev-instance/web.log`, `api.log`), never in the tree.
 *
 * Stopping goes by port, not by a recorded pid: the ports belong to this checkout alone, so
 * whatever listens there is this checkout's — started here, by `pnpm dev` in a terminal or
 * by the run-frontend driver's `--keep` — and a pid file could outlive a reboot and name
 * someone else's process.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { checkoutGitDir, describePorts, devPorts, REPO_ROOT } from "./ports.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listening(port) {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => done(socket.destroy() || true));
    socket.once("error", () => done(false));
  });
}

/** Pids listening on the port, from `ss` (only this user's processes are visible, which suffices). */
function listeners(port) {
  const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
  return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
}

function processGroup(pid) {
  try {
    return Number(readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\)\s+/, "").split(" ")[2]);
  } catch {
    return null;
  }
}

function tail(file, lines = 15) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

const ports = devPorts();
const logDir = join(checkoutGitDir(REPO_ROOT), "dev-instance");
const services = [
  { name: "web", port: ports.web, script: "dev", timeoutMs: 60_000, url: `http://127.0.0.1:${ports.web}/` },
  // First launch of a worktree: uv syncs, the database is created and migrated.
  { name: "api", port: ports.api, script: "dev:api", timeoutMs: 180_000, url: `http://127.0.0.1:${ports.api}/` },
];

async function start(service) {
  if (await listening(service.port)) {
    console.log(`${service.name}: already answering on ${service.url}`);
    return true;
  }
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${service.name}.log`);
  const out = openSync(log, "w");
  // detached: its own session and process group, so it survives this script and its shell,
  // and `stop` can signal the whole tree (pnpm → vite, uv → runserver → reloader child).
  const child = spawn("pnpm", [service.script], { cwd: REPO_ROOT, detached: true, stdio: ["ignore", out, out] });
  let exited = null;
  child.once("exit", (code) => (exited = code ?? 1));
  const deadline = Date.now() + service.timeoutMs;
  while (Date.now() < deadline && exited === null) {
    if (await listening(service.port)) {
      child.unref();
      console.log(`${service.name}: started on ${service.url} (log ${log})`);
      return true;
    }
    await sleep(500);
  }
  if (exited === null) process.kill(-child.pid, "SIGTERM");
  console.error(`${service.name}: did not come up on :${service.port} (log ${log})\n${tail(log)}`);
  return false;
}

async function stop(service) {
  const groups = new Set(listeners(service.port).map(processGroup).filter((g) => g !== null));
  // Never signal our own group: `pnpm dev:stop` run from the same terminal job as the server.
  groups.delete(processGroup(process.pid));
  if (groups.size === 0) {
    console.log(`${service.name}: nothing listening on :${service.port}`);
    return;
  }
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const group of groups) {
      try {
        process.kill(-group, signal);
      } catch {
        // already gone
      }
    }
    for (let i = 0; i < 20 && (await listening(service.port)); i++) await sleep(250);
    if (!(await listening(service.port))) break;
  }
  if (await listening(service.port)) {
    console.error(`${service.name}: still listening on :${service.port}, pids ${listeners(service.port).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${service.name}: stopped (:${service.port})`);
  }
}

const command = process.argv[2];
console.log(describePorts(ports));
if (command === "start") {
  // Vite first: the SPA works without Django (CLAUDE.md), a missing server only greys out the sync.
  const results = [];
  for (const service of services) results.push(await start(service));
  if (!results[1]) console.error("api: the SPA runs without it — is PostgreSQL up? docker compose -f docker-compose.dev.yml up -d db");
  if (!results[0]) process.exitCode = 1;
} else if (command === "stop") {
  for (const service of services) await stop(service);
} else if (command === "status") {
  for (const service of services) {
    const pids = listeners(service.port);
    console.log(`${service.name}: ${pids.length ? `answering on ${service.url} (pid ${pids.join(", ")})` : `down (:${service.port})`}`);
  }
} else {
  console.error("usage: node tools/dev-env/instance.mjs start|stop|status");
  process.exitCode = 2;
}
