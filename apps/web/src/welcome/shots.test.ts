import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { SHOTS, SHOT_LANGUAGES, SHOT_THEMES, shotPath } from "@/welcome/shots";

// Not `new URL("../../public", import.meta.url)`: Vite rewrites that literal form for the browser,
// and under jsdom it resolves against http://localhost (see lib/chartColors.test.ts).
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public");

it("has every shot the welcome page shows, in every theme and language", () => {
  const missing = SHOTS.flatMap((s) => SHOT_THEMES.flatMap((theme) => SHOT_LANGUAGES.map((lang) => shotPath(s.id, theme, lang)))).filter((p) => !existsSync(`${PUBLIC}${p}`));
  expect(missing).toEqual([]);
});

// Never under /welcome/: nginx's `try_files $uri $uri/` would answer the SPA route /welcome with a
// 301 to the directory, then a 403 (final review of sub-project 41).
it("keeps the shots out of every SPA route", () => {
  expect(shotPath("dashboard", "light", "fr")).toBe("/shots/dashboard.light.fr.webp");
  expect(existsSync(`${PUBLIC}/welcome`)).toBe(false);
});
