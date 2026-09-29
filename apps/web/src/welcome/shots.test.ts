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
