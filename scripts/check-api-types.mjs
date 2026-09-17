#!/usr/bin/env node
/**
 * Fails when apps/web/src/api/schema.d.ts is not what openapi.json generates.
 * The other half of the chain — openapi.json against the running Django — is a
 * pytest test, so `pnpm check` never needs Python.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const committed = "apps/web/src/api/schema.d.ts";
const dir = mkdtempSync(join(tmpdir(), "api-types-"));
const fresh = join(dir, "schema.d.ts");

try {
  execFileSync(
    "pnpm",
    ["--filter", "web", "exec", "openapi-typescript", "../../apps/api/openapi.json", "-o", fresh],
    { stdio: "inherit" },
  );
  if (readFileSync(committed, "utf8") !== readFileSync(fresh, "utf8")) {
    console.error(`${committed} is stale. Run: pnpm gen:api`);
    process.exit(1);
  }
  console.log("api types up to date");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
