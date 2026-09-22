import { describe, expect, it } from "vitest";
import { chartProxyOf } from "@/lib/chartProxies";

describe("chartProxyOf", () => {
  it("rend SPY pour XSP, qu'IB ne cote pas sans abonnement indice", () => {
    expect(chartProxyOf("XSP")).toBe("SPY");
  });

  it("rend null pour un ticker qu'IB sert tel quel", () => {
    expect(chartProxyOf("SPY")).toBeNull();
    expect(chartProxyOf("BTDR")).toBeNull();
  });

  it("ignore la casse : un ticker minuscule trouve quand même son substitut", () => {
    expect(chartProxyOf("xsp")).toBe("SPY");
  });
});
