import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { DEMO_FLAG } from "@/demo/mode";
import { alertNoteText } from "./noteText";

describe("alertNoteText", () => {
  afterEach(async () => {
    window.sessionStorage.removeItem(DEMO_FLAG);
    await i18n.changeLanguage("fr");
  });

  it("rend telle quelle la note d'un vrai compte, même si elle ressemble à un code", () => {
    expect(alertNoteText("Support du 200 jours", i18n.t)).toBe("Support du 200 jours");
    expect(alertNoteText("demo:resistance", i18n.t)).toBe("demo:resistance");
    expect(alertNoteText(null, i18n.t)).toBeNull();
  });

  it("traduit en démonstration la note codée de la graine, dans la langue de l'interface", async () => {
    window.sessionStorage.setItem(DEMO_FLAG, "1");
    expect(alertNoteText("demo:resistance", i18n.t)).toBe("Résistance");
    await i18n.changeLanguage("en");
    expect(alertNoteText("demo:resistance", i18n.t)).toBe("Resistance");
    expect(alertNoteText("demo:support", i18n.t)).toBe("Support");
  });

  it("laisse en démonstration une note libre ou un code inconnu tels quels", () => {
    window.sessionStorage.setItem(DEMO_FLAG, "1");
    expect(alertNoteText("Ma note", i18n.t)).toBe("Ma note");
    expect(alertNoteText("demo:inconnu", i18n.t)).toBe("demo:inconnu");
  });
});
