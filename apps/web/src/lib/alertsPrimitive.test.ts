import { describe, expect, it } from "vitest";
import type { Alert, AlertStatus, AlertThreshold } from "@ib/alerts";
import type { AlertView } from "@/alerts/useAlertEngine";
import { AlertsPrimitive, AlertsRenderer, chartAlerts, drawnAlerts } from "@/lib/alertsPrimitive";
import { CHART_COLORS } from "@/lib/chartColors";

const STATE = { alertId: "", triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null };

function view(alert: Partial<Alert> & { id: string; kind: Alert["kind"]; ticker: string }, status: AlertStatus = "active"): AlertView {
  const base = { currency: "USD", thresholds: [{ price: 10, direction: "above" }] as AlertThreshold[] | null, ...alert };
  return { alert: base as unknown as Alert, state: { ...STATE, alertId: alert.id }, status, price: null, distance: null };
}

const THRESHOLDS: AlertThreshold[] = [
  { price: 8, direction: "below" },
  { price: 20, direction: "above" },
];

describe("chartAlerts", () => {
  it("garde les manuelles du ticker, comparé en majuscules, et écarte celles d'un autre", () => {
    const views = [view({ id: "m1", kind: "manual", ticker: "BTDR" }), view({ id: "m2", kind: "manual", ticker: "AAPL" })];

    expect(chartAlerts(views, "btdr", ["wheel"])).toEqual([{ id: "m1#0", kind: "manual", price: 10, status: "active" }]);
  });

  it("ne montre les alertes Wheel et Condors qu'aux graphes de ces stratégies", () => {
    const views = [
      view({ id: "w", kind: "wheel", ticker: "BTDR" }),
      view({ id: "c", kind: "condor", ticker: "BTDR", thresholds: THRESHOLDS }),
    ];

    expect(chartAlerts(views, "BTDR", ["wheel"]).map((a) => a.kind)).toEqual(["wheel"]);
    expect(chartAlerts(views, "BTDR", ["condors"]).map((a) => a.kind)).toEqual(["condor", "condor"]);
    expect(chartAlerts(views, "BTDR", ["leaps"])).toEqual([]);
  });

  it("donne une entrée par seuil d'un condor", () => {
    const views = [view({ id: "c", kind: "condor", ticker: "BTDR", thresholds: THRESHOLDS })];

    expect(chartAlerts(views, "BTDR", ["condors"]).map((a) => a.price)).toEqual([8, 20]);
  });

  it("écarte une alerte désactivée et une automatique sans seuil", () => {
    const views = [
      view({ id: "m", kind: "manual", ticker: "BTDR" }, "disabled"),
      view({ id: "w", kind: "wheel", ticker: "BTDR", thresholds: null }),
    ];

    expect(chartAlerts(views, "BTDR", ["wheel"])).toEqual([]);
  });

  it("garde une alerte déclenchée, avec son statut", () => {
    const views = [view({ id: "m", kind: "manual", ticker: "BTDR" }, "triggered")];

    expect(chartAlerts(views, "BTDR", [])[0].status).toBe("triggered");
  });
});

describe("drawnAlerts", () => {
  const active = { id: "a", kind: "manual", price: 17.5, status: "active" } as const;
  const triggered = { ...active, status: "triggered" } as const;

  it("voile le trait et l'étiquette d'une alerte active, teintes du thème clair", () => {
    const [drawn] = drawnAlerts([active], false, "fr");

    expect(drawn.line).toBe("rgba(208, 138, 16, 0.55)");
    expect(drawn.label).toEqual({
      text: "17,5",
      fill: "rgba(208, 138, 16, 0.18)",
      ink: CHART_COLORS.light.foreground,
    });
  });

  it("peint une alerte déclenchée en plein, encre du jeton dédié, thème sombre", () => {
    const [drawn] = drawnAlerts([triggered], true, "en");

    expect(drawn.line).toBe(CHART_COLORS.dark.warning);
    expect(drawn.label).toEqual({
      text: "17.5",
      fill: CHART_COLORS.dark.warning,
      ink: CHART_COLORS.dark.warningForeground,
    });
  });
});

describe("AlertsPrimitive", () => {
  const [drawn] = drawnAlerts([{ id: "a", kind: "manual", price: 17.5, status: "active" }], false, "fr");
  const series = { priceToCoordinate: (price: number) => price * 2 };

  function attached() {
    const primitive = new AlertsPrimitive([drawn]);
    primitive.attached({ series: series as never });
    primitive.updateAllViews();
    return primitive;
  }

  it("pose l'étiquette sur l'axe des prix, à la coordonnée du prix", () => {
    const [axis] = attached().priceAxisViews();

    expect(axis.coordinate()).toBe(35);
    expect(axis.text()).toBe("17,5");
    expect(axis.textColor()).toBe(drawn.label.ink);
    expect(axis.backColor()).toBe(drawn.label.fill);
    expect(axis.visible()).toBe(true);
  });

  it("masque l'étiquette d'un prix sans coordonnée", () => {
    const primitive = new AlertsPrimitive([drawn]);
    primitive.attached({ series: { priceToCoordinate: () => null } as never });
    primitive.updateAllViews();

    expect(primitive.priceAxisViews()[0].visible()).toBe(false);
  });

  it("trace un pointillé fin pleine largeur aux pixels bitmap", () => {
    const calls: unknown[][] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, stroke() {},
      setLineDash: (d: number[]) => calls.push(["dash", d]),
      moveTo: (x: number, y: number) => calls.push(["move", x, y]),
      lineTo: (x: number, y: number) => calls.push(["line", x, y]),
      lineWidth: 0,
      strokeStyle: "",
    };
    const [view] = attached().paneViews();
    (view.renderer() as AlertsRenderer).draw({
      useBitmapCoordinateSpace: (cb) =>
        cb({ context: ctx as never, bitmapSize: { width: 800, height: 600 }, horizontalPixelRatio: 2, verticalPixelRatio: 2 }),
    });

    expect(ctx.lineWidth).toBe(2);
    expect(ctx.strokeStyle).toBe(drawn.line);
    expect(calls).toEqual([["dash", [4, 6]], ["move", 0, 70.5], ["line", 800, 70.5]]);
  });
});
