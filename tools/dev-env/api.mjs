#!/usr/bin/env node
/**
 * Django development server for this checkout: `pnpm dev:api`.
 *
 * Creates the checkout's database on the shared dev PostgreSQL if it does not exist yet
 * (a worktree gets `ib_analyzer_<worktree>`, see ports.mjs), applies migrations, collects the
 * static files, then runs
 * `runserver` on this checkout's API port — the one its Vite proxy targets. The main
 * checkout keeps `ib_analyzer` on :8000, exactly what apps/api/README.md describes by hand.
 *
 * `docker compose -f docker-compose.dev.yml up -d db` must have been run first.
 */
import { spawnSync } from "node:child_process";
import { describePorts, devPorts, REPO_ROOT } from "./ports.mjs";

const ports = devPorts();
console.error(describePorts(ports));

const env = {
  ...process.env,
  DATABASE_URL: ports.databaseUrl,
  // apps/api/README.md has the human export this same value; settings.py refuses to boot
  // on the committed key outside DEBUG, and this script only ever runs a dev server.
  DJANGO_SECRET_KEY: process.env.DJANGO_SECRET_KEY || "dev-local-not-for-production",
};
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit", env, ...opts });

const compose = ["compose", "-f", "docker-compose.dev.yml", "exec", "-T", "db", "psql", "-U", "ib", "-d", "postgres"];
const exists = run("docker", [...compose, "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${ports.database}'`], {
  stdio: ["ignore", "pipe", "inherit"],
});
if (exists.status !== 0) {
  console.error("dev-env: PostgreSQL is not reachable — docker compose -f docker-compose.dev.yml up -d db");
  process.exit(exists.status ?? 1);
}
if (!String(exists.stdout).trim()) {
  console.error(`dev-env: creating database ${ports.database}`);
  const created = run("docker", [...compose, "-c", `CREATE DATABASE "${ports.database}" OWNER ib`]);
  if (created.status !== 0) process.exit(created.status ?? 1);
}

const manage = ["run", "--project", "apps/api", "python", "apps/api/manage.py"];
const migrated = run("uv", [...manage, "migrate"]);
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
// The server runs like production (DJANGO_DEBUG unset): WhiteNoise's manifest storage then
// refuses any `{% static %}` it has not collected, and every Django page — the admin — is a 500.
const collected = run("uv", [...manage, "collectstatic", "--noinput", "--verbosity", "0"]);
if (collected.status !== 0) process.exit(collected.status ?? 1);
process.exit(run("uv", [...manage, "runserver", `127.0.0.1:${ports.api}`]).status ?? 1);
