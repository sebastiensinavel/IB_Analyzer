import { describe, expect, it } from "vitest";
import { ROW_NOTE_CODES } from "@ib/ledger";
import i18n from "@/i18n";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

const RESOURCES = { fr, en } as const;

/**
 * Every leaf path of a resource tree, array indices included: several blocks — the welcome
 * benefits, the first steps, the Flex sections, the help items — are arrays of strings, and a
 * translation that lost one of them would otherwise pass unnoticed.
 */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe("i18n", () => {
  /**
   * `fallbackLng: "en"` makes a missing French key render English silently, and a missing
   * English key render the raw key: neither breaks a test that only reads the other file.
   * This is the guarantee that the two files carry exactly the same keys.
   */
  it("carries exactly the same keys in French and in English", () => {
    const frPaths = leafPaths(fr);
    const enPaths = leafPaths(en);
    expect(frPaths.length).toBeGreaterThan(0);
    const frOnly = frPaths.filter((path) => !enPaths.includes(path));
    const enOnly = enPaths.filter((path) => !frPaths.includes(path));
    expect({ missingFromEnglish: frOnly, missingFromFrench: enOnly }).toEqual({
      missingFromEnglish: [],
      missingFromFrench: [],
    });
  });

  it("defaults to French and knows the dashboard nav key", () => {
    expect(i18n.language).toBe("fr");
    expect(i18n.t("nav.dashboard")).toBe("Tableau de bord");
  });

  it("can switch to English", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.dashboard")).toBe("Dashboard");
    await i18n.changeLanguage("fr");
  });

  it("translates every RowNoteCode in both languages, with contracts interpolated", async () => {
    const contract = "NVDA Aug21'26 150 Call";
    for (const language of ["fr", "en"] as const) {
      await i18n.changeLanguage(language);
      for (const code of ROW_NOTE_CODES) {
        const key = `journal.notes.${code}`;
        const template: string = RESOURCES[language].journal.notes[code];
        const rendered = i18n.t(key, { contract });
        expect(rendered).not.toBe(key);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered).not.toContain("{{");
        // Only a code whose own template names the contract needs to interpolate it.
        if (template.includes("{{contract}}")) {
          expect(rendered).toContain(contract);
        }
      }
    }
    await i18n.changeLanguage("fr");
  });
});
