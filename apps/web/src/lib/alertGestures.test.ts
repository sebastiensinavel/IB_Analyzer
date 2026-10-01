import { describe, expect, it } from "vitest";
import { ALERT_BELL_HIT_RADIUS_PX, ALERT_HIT_TOLERANCE_PX, baseAlertId, hitAlert, hitBell, priceAtY } from "@/lib/alertGestures";

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

  it("accepte une autre tolérance", () => {
    expect(hitAlert(109, [{ id: "a", y: 100 }], 10)).toBe("a");
  });
});

describe("hitBell", () => {
  const bell = { id: "a", x: 482, y: 100 };

  it("touche une pastille jusqu'à 10,5 px de son centre, en distance, pas au-delà", () => {
    expect(ALERT_BELL_HIT_RADIUS_PX).toBe(10.5);
    expect(hitBell({ x: 482, y: 110.5 }, [bell])).toBe("a");
    expect(hitBell({ x: 476, y: 92 }, [bell])).toBe("a");
    expect(hitBell({ x: 476, y: 91 }, [bell])).toBeNull();
    expect(hitBell({ x: 300, y: 100 }, [bell])).toBeNull();
  });

  it("rend la plus proche quand deux pastilles sont à portée", () => {
    expect(hitBell({ x: 482, y: 107 }, [bell, { id: "b", x: 482, y: 110 }])).toBe("b");
    expect(hitBell({ x: 482, y: 104 }, [bell, { id: "b", x: 482, y: 110 }])).toBe("a");
  });

  it("ignore une pastille hors de l'échelle visible (y null)", () => {
    expect(hitBell({ x: 482, y: 100 }, [{ ...bell, y: null }])).toBeNull();
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
