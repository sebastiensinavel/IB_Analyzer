#!/usr/bin/env node
/**
 * Runs a command with this checkout's development environment set:
 *
 *   node tools/dev-env/run.mjs <command> [args...]
 *
 * WEB_PORT, API_PORT and DATABASE_URL are derived by ports.mjs (main checkout or git
 * worktree) unless already present in the environment. Anything Python — pytest, Django —
 * reads DATABASE_URL, so a worktree's `pnpm test:api` uses `test_ib_analyzer_<worktree>`
 * and never races the main checkout's `test_ib_analyzer` under `--reuse-db`.
 */
import { spawnSync } from "node:child_process";
import { describePorts, devPorts } from "./ports.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node tools/dev-env/run.mjs <command> [args...]");
  process.exit(2);
}

const ports = devPorts();
console.error(describePorts(ports));

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    WEB_PORT: String(ports.web),
    API_PORT: String(ports.api),
    DATABASE_URL: ports.databaseUrl,
  },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(127);
}
process.exit(result.status ?? 1);
