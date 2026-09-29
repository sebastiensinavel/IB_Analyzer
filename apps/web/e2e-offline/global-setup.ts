import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DIST = join(dirname(fileURLToPath(import.meta.url)), ".dist");

/**
 * Construit une fois l'application (`vite build`, sans `tsc -b`) puis en dérive les versions
 * publiées ensuite. Un `sw.js` qui diffère d'un octet est une mise à jour pour le navigateur :
 * - « b » : la même application ;
 * - « broken » : une application qui ne démarre pas — son module principal n'existe pas —, mais
 *   dont `index.html` garde les scripts inline. Son `sw.js` précache ce nouvel `index.html` : la
 *   révision du manifeste de pré-cache change, sinon Workbox resservirait l'ancien ;
 * - « fixed » : le correctif publié après « broken », l'application d'origine.
 */
export default function globalSetup() {
  const web = join(DIST, "../..");
  rmSync(DIST, { recursive: true, force: true });
  execFileSync("npx", ["vite", "build", "--outDir", join(DIST, "a"), "--emptyOutDir"], { cwd: web, stdio: "inherit" });
  cpSync(join(DIST, "a"), join(DIST, "b"), { recursive: true });
  appendFileSync(join(DIST, "b", "sw.js"), "\n// e2e: version b\n");

  const broken = join(DIST, "broken");
  cpSync(join(DIST, "a"), broken, { recursive: true });
  const html = readFileSync(join(broken, "index.html"), "utf8");
  const brokenHtml = html
    .replace(/(<script type="module"[^>]* src=")[^"]+(")/, "$1/assets/absent.js$2")
    .replace("<head>", '<head>\n    <meta name="e2e-version" content="broken" />');
  if (brokenHtml === html || !brokenHtml.includes("absent.js")) throw new Error("index.html : module principal introuvable");
  writeFileSync(join(broken, "index.html"), brokenHtml);
  const md5 = (text: string) => createHash("md5").update(text).digest("hex");
  const sw = readFileSync(join(broken, "sw.js"), "utf8");
  const brokenSw = sw.replace(`{url:"index.html",revision:"${md5(html)}"}`, `{url:"index.html",revision:"${md5(brokenHtml)}"}`);
  if (brokenSw === sw) throw new Error("sw.js : révision d'index.html introuvable");
  writeFileSync(join(broken, "sw.js"), `${brokenSw}\n// e2e: version broken\n`);

  cpSync(join(DIST, "a"), join(DIST, "fixed"), { recursive: true });
  appendFileSync(join(DIST, "fixed", "sw.js"), "\n// e2e: version fixed\n");
}
