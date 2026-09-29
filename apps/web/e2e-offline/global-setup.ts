import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DIST = join(dirname(fileURLToPath(import.meta.url)), ".dist");

/**
 * Construit une fois l'application (`vite build`, sans `tsc -b`) puis dérive la version « b » :
 * un `sw.js` qui diffère d'un octet est une mise à jour pour le navigateur.
 */
export default function globalSetup() {
  const web = join(DIST, "../..");
  rmSync(DIST, { recursive: true, force: true });
  execFileSync("npx", ["vite", "build", "--outDir", join(DIST, "a"), "--emptyOutDir"], { cwd: web, stdio: "inherit" });
  cpSync(join(DIST, "a"), join(DIST, "b"), { recursive: true });
  appendFileSync(join(DIST, "b", "sw.js"), "\n// e2e: version b\n");
}
