import { describe, expect, it } from "vitest";
import { ROW_NOTE_CODES } from "@ib/ledger";
import i18n from "@/i18n";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

const RESOURCES = { fr, en } as const;

describe("i18n", () => {
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
