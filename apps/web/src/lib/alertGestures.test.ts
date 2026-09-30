import { describe, expect, it } from "vitest";
import { ALERT_HIT_TOLERANCE_PX, baseAlertId, hitAlert, priceAtY } from "@/lib/alertGestures";

describe("hitAlert", () => {
  it("touche une ligne jusqu'à 4 px, pas au-delà", () => {
    expect(ALERT_HIT_TOLERANCE_PX).toBe(4);
    expect(hitAlert(104, [{ id: "a", y: 100 }])).toBe("a");
    expect(hitAlert(96, [{ id: "a", y: 100 }])).toBe("a");
    expect(hitAlert(104.5, [{ id: "a", y: 100 }])).toBeNull();
  });

  it("rend la plus proche quand deux lignes sont à portée", () => {
    const alerts = [
      { id: "far", y: 97 },
      { id: "near", y: 101 },
    ];
    expect(hitAlert(100, alerts)).toBe("near");
  });

  it("ignore une ligne hors de l'échelle visible (y null) et une liste vide", () => {
    expect(hitAlert(100, [{ id: "a", y: null }])).toBeNull();
    expect(hitAlert(100, [])).toBeNull();
  });

  it("accepte une autre tolérance, celle de l'étiquette", () => {
    expect(hitAlert(109, [{ id: "a", y: 100 }], 10)).toBe("a");
  });
});

describe("priceAtY", () => {
  it("arrondit au cent le prix de la hauteur", () => {
    expect(priceAtY(50, () => 245.3049)).toBe(245.3);
    expect(priceAtY(50, () => 245.305)).toBe(245.31);
  });

  it("rend null hors de l'échelle", () => {
    expect(priceAtY(50, () => null)).toBeNull();
  });
});

describe("baseAlertId", () => {
  it("retire l'indice du seuil", () => {
    expect(baseAlertId("manual:abc#0")).toBe("manual:abc");
    expect(baseAlertId("condor:r1#1")).toBe("condor:r1");
  });
});
