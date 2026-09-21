/**
 * One place that decides which ports and which database a checkout of this repository
 * uses in development.
 *
 * The main checkout keeps the historical values (Vite 5173, Django 8000, database
 * `ib_analyzer`). A linked git worktree (`.claude/worktrees/<name>`) gets a slot — the
 * lowest number from 1 that no other live worktree holds — and sits that many ports above
 * the root: 5174/8001 for the first, 5175/8002 for the second. The slot is written once in
 * the worktree's own git directory (`.git/worktrees/<id>/dev-slot`), so a worktree keeps
 * its ports for its whole life, and `git worktree remove` frees them for the next one.
 * Two checkouts served at the same time therefore never answer for each other, while the
 * ports a human forwards stay the same from one sub-project to the next. IndexedDB is per
 * origin, so a distinct port also means a distinct browser database — and a worktree that
 * inherits a slot inherits that browser database too.
 *
 * Consumers: apps/web/vite.config.ts, apps/web/playwright.config.ts,
 * .claude/skills/run-frontend/driver.mjs, tools/dev-env/run.mjs, api.mjs and instance.mjs.
 * `WEB_PORT`, `API_PORT` and `DATABASE_URL` in the environment override the derivation.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const ROOT_WEB_PORT = 5173;
export const ROOT_API_PORT = 8000;
/** The local TWS agent (apps/tws-agent) listens here: never hand this port to Django. */
export const AGENT_PORT = 8100;
const ROOT_DATABASE = "ib_analyzer";
const DATABASE_URL_PREFIX = "postgres://ib:ib@127.0.0.1:5432/";
// Slots 1..99: web ends below 5273, api below the agent's 8100.
const MAX_SLOT = 99;
const SLOT_FILE = "dev-slot";

/**
 * @param {string} root directory of the checkout
 * @returns {string | null} the worktree's directory name, or null in the main checkout
 */
export function worktreeName(root) {
  try {
    // `git worktree add` writes `.git` as a file ("gitdir: ..."); the main checkout has a
    // directory. No git invocation needed, and it works before `pnpm install`.
    return statSync(resolve(root, ".git")).isFile() ? basename(root) : null;
  } catch {
    return null;
  }
}

/**
 * The checkout's own git directory: `.git` in the main checkout, `.git/worktrees/<id>` in a
 * linked worktree. Never versioned, and removed with the worktree — where per-checkout
 * development state (slot, instance logs) lives.
 *
 * @param {string} root directory of the checkout
 */
export function checkoutGitDir(root) {
  const dotGit = resolve(root, ".git");
  if (worktreeName(root) === null) return dotGit;
  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
  if (!match) throw new Error(`${dotGit} does not name a git directory`);
  return resolve(root, match[1].trim());
}

function readSlot(gitDir) {
  try {
    const slot = Number(readFileSync(join(gitDir, SLOT_FILE), "utf8").trim());
    return Number.isInteger(slot) && slot > 0 ? slot : null;
  } catch {
    return null;
  }
}

/** A worktree deleted by hand keeps its metadata until `git worktree prune`: not live. */
function isLive(gitDir) {
  try {
    return existsSync(readFileSync(join(gitDir, "gitdir"), "utf8").trim());
  } catch {
    return false;
  }
}

/**
 * 0 in the main checkout. In a linked worktree, the slot it already holds, or the lowest one
 * no other live worktree holds, claimed on the spot.
 *
 * @param {string} root directory of the checkout
 */
export function worktreeSlot(root) {
  if (worktreeName(root) === null) return 0;
  const gitDir = checkoutGitDir(root);
  const own = readSlot(gitDir);
  if (own !== null) return own;
  const taken = new Set();
  for (const id of readdirSync(dirname(gitDir))) {
    const other = join(dirname(gitDir), id);
    if (other !== gitDir && isLive(other)) taken.add(readSlot(other));
  }
  let slot = 1;
  while (taken.has(slot)) slot++;
  writeFileSync(join(gitDir, SLOT_FILE), `${slot}\n`);
  return slot;
}

/**
 * The checkout's development secret key, shared with Django's own config/devkey.py: one
 * file, so a server started here and one started by hand never invalidate each other's
 * sessions. Never versioned, removed with the worktree.
 *
 * @param {string} root directory of the checkout
 */
export function devSecretKey(root = REPO_ROOT) {
  const path = join(checkoutGitDir(root), "dev-secret-key");
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Not created yet: fall through and claim it.
  }
  const key = randomBytes(48).toString("base64url");
  writeFileSync(path, `${key}\n`);
  return key;
}

function portFrom(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be a port number, got "${raw}"`);
  }
  return port;
}

/**
 * @param {string | null} worktree directory name of the worktree, null for the main checkout
 * @param {number} slot 0 for the main checkout, see worktreeSlot
 * @param {NodeJS.ProcessEnv} env
 */
export function portsFor(worktree, slot, env) {
  if (slot > MAX_SLOT) throw new Error(`dev-env: slot ${slot} is above ${MAX_SLOT}, remove unused worktrees`);
  const database =
    worktree === null ? ROOT_DATABASE : `${ROOT_DATABASE}_${worktree.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const databaseUrl = env.DATABASE_URL || `${DATABASE_URL_PREFIX}${database}`;
  return {
    worktree,
    slot,
    web: portFrom(env, "WEB_PORT", ROOT_WEB_PORT + slot),
    api: portFrom(env, "API_PORT", ROOT_API_PORT + slot),
    database: new URL(databaseUrl).pathname.slice(1),
    databaseUrl,
  };
}

/** The values for this checkout, honouring the process environment. */
export function devPorts(root = REPO_ROOT, env = process.env) {
  return portsFor(worktreeName(root), worktreeSlot(root), env);
}

/** One line for a banner, so the human and the driver always see which checkout answers. */
export function describePorts(p) {
  const where = p.worktree === null ? "main checkout" : `worktree ${p.worktree} (slot ${p.slot})`;
  return `dev-env: ${where} → web :${p.web}, api :${p.api}, db ${p.database}`;
}
