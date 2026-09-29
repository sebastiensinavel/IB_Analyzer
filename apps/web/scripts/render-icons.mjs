// Les icônes de l'application installée (sous-projet 40), rendues depuis public/favicon.svg
// en thème clair. À relancer à la main quand le logo change : `node scripts/render-icons.mjs`
// depuis apps/web. Ni `pnpm build` ni `pnpm check` ne l'exécutent ; les PNG sont versionnés.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
const favicon = await readFile(join(publicDir, "favicon.svg"), "utf8");

// Plein cadre : le carré sans ses coins arrondis. Android découpe l'icône « maskable » dans
// sa propre forme, iOS arrondit l'apple-touch-icon lui-même — un coin transparent y
// deviendrait noir.
const fullBleed = favicon.replace('rx="8" ', "");
if (fullBleed === favicon) throw new Error('Failed to find rx="8" in favicon.svg');

// Maskable : le texte réduit à 70 % autour du centre, dans la zone sûre (cercle de 80 %).
const maskable = fullBleed.replace('<path class="text"', '<path class="text" transform="translate(14 14) scale(0.7) translate(-14 -14)"');
if (maskable === fullBleed) throw new Error('Failed to find <path class="text" in favicon.svg');

const icons = [
  { file: "pwa-192x192.png", svg: favicon, size: 192 },
  { file: "pwa-512x512.png", svg: favicon, size: 512 },
  { file: "pwa-maskable-512x512.png", svg: maskable, size: 512 },
  { file: "apple-touch-icon.png", svg: fullBleed, size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { file, svg, size } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, colorScheme: "light" });
    const sized = svg.replace('width="28" height="28"', `width="${size}" height="${size}"`);
    if (sized === svg) throw new Error(`Failed to find width="28" height="28" in favicon.svg for ${file}`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await writeFile(join(publicDir, file), await page.screenshot({ omitBackground: true }));
    await page.close();
  }
} finally {
  await browser.close();
}
