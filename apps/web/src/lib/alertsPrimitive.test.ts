import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Alert, AlertStatus, AlertThreshold } from "@ib/alerts";
import type { AlertView } from "@/alerts/useAlertEngine";
import {
  ALERT_BELL_INSET_PX,
  ALERT_BELL_SIZE_PX,
  AlertsPrimitive,
  AlertsRenderer,
  chartAlerts,
  drawnAlerts,
  type DrawnAlertInput,
} from "@/lib/alertsPrimitive";
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

    expect(chartAlerts(views, "btdr", ["wheel"])).toEqual([{ id: "m1#0", kind: "manual", price: 10, direction: "above", status: "active" }]);
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

    expect(chartAlerts(views, "BTDR", ["condors"]).map((a) => [a.price, a.direction])).toEqual([
      [8, "below"],
      [20, "above"],
    ]);
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
  const active: DrawnAlertInput = { id: "a", kind: "manual", price: 17.5, direction: "above", status: "active" };
  const triggered: DrawnAlertInput = { ...active, status: "triggered" };

  it("voile le trait et la pastille d'une alerte active, sur le fond du graphe, thème clair", () => {
    const [drawn] = drawnAlerts([active], false);

    expect(drawn.line).toBe("rgba(208, 138, 16, 0.55)");
    expect(drawn.bell).toEqual({
      backdrop: CHART_COLORS.light.surface,
      fill: "rgba(208, 138, 16, 0.18)",
      ink: CHART_COLORS.light.warning,
    });
  });

  it("peint une alerte déclenchée en plein, cloche du jeton dédié, thème sombre", () => {
    const [drawn] = drawnAlerts([triggered], true);

    expect(drawn.line).toBe(CHART_COLORS.dark.warning);
    expect(drawn.bell).toEqual({
      backdrop: null,
      fill: CHART_COLORS.dark.warning,
      ink: CHART_COLORS.dark.warningForeground,
    });
  });
});

describe("AlertsPrimitive", () => {
  const input: DrawnAlertInput = { id: "a", kind: "manual", price: 17.5, direction: "above", status: "active" };
  const series = { priceToCoordinate: (price: number) => price * 2 };

  class FakePath2D {
    readonly d: string;
    constructor(d: string) {
      this.d = d;
    }
  }
  beforeEach(() => vi.stubGlobal("Path2D", FakePath2D));
  afterEach(() => vi.unstubAllGlobals());

  function attached(inputs: DrawnAlertInput[] = [input]) {
    const primitive = new AlertsPrimitive(drawnAlerts(inputs, false));
    primitive.attached({ series: series as never });
    primitive.updateAllViews();
    return primitive;
  }

  /** Un contexte factice qui note les appels, et le style au moment de chaque remplissage. */
  function draw(primitive: AlertsPrimitive) {
    const calls: unknown[][] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, translate() {}, scale() {},
      setLineDash: (d: number[]) => calls.push(["dash", d]),
      moveTo: (x: number, y: number) => calls.push(["move", x, y]),
      lineTo: (x: number, y: number) => calls.push(["line", x, y]),
      arc: (x: number, y: number, r: number) => calls.push(["arc", x, y, r]),
      fill: () => calls.push(["fill", ctx.fillStyle]),
      stroke: (path?: unknown) => calls.push(path === undefined ? ["stroke"] : ["strokePath", (path as FakePath2D).d, ctx.strokeStyle]),
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      strokeStyle: "",
      fillStyle: "",
    };
    const [view] = primitive.paneViews();
    (view.renderer() as AlertsRenderer).draw({
      useBitmapCoordinateSpace: (cb) =>
        cb({ context: ctx as never, bitmapSize: { width: 800, height: 600 }, horizontalPixelRatio: 2, verticalPixelRatio: 2 }),
    });
    return { calls, ctx };
  }

  it("ne pose plus aucune étiquette sur l'axe des prix", () => {
    expect("priceAxisViews" in attached()).toBe(false);
  });

  it("trace un pointillé fin pleine largeur aux pixels bitmap", () => {
    const { calls } = draw(attached());

    expect(calls.slice(0, 3)).toEqual([["dash", [4, 6]], ["move", 0, 70.5], ["line", 800, 70.5]]);
  });

  it("pose la pastille sur la ligne, son centre à 18 px du bord droit, et y trace la cloche", () => {
    expect([ALERT_BELL_SIZE_PX, ALERT_BELL_INSET_PX]).toEqual([16, 18]);
    const { calls, ctx } = draw(attached());

    const arcs = calls.filter((c) => c[0] === "arc");
    expect(arcs).toEqual([
      ["arc", 800 - 18 * 2, 70.5, 16],
      ["arc", 800 - 18 * 2, 70.5, 16],
    ]);
    // Le fond du graphe d'abord, pour cacher le pointillé, puis le voile.
    expect(calls.filter((c) => c[0] === "fill")).toEqual([
      ["fill", CHART_COLORS.light.surface],
      ["fill", "rgba(208, 138, 16, 0.18)"],
    ]);
    const paths = calls.filter((c) => c[0] === "strokePath");
    expect(paths).toHaveLength(2);
    expect(paths.every((c) => c[2] === CHART_COLORS.light.warning)).toBe(true);
    expect(paths[0][1]).toBe("M10.268 21a2 2 0 0 0 3.464 0");
    expect([ctx.lineCap, ctx.lineJoin]).toEqual(["round", "round"]);
  });

  it("peint pleine la pastille d'une déclenchée, cloche du jeton dédié", () => {
    const { calls } = draw(attached([{ ...input, status: "triggered" }]));

    expect(calls.filter((c) => c[0] === "fill")).toEqual([["fill", CHART_COLORS.light.warning]]);
    expect(calls.filter((c) => c[0] === "strokePath").map((c) => c[2])).toEqual([
      CHART_COLORS.light.warningForeground,
      CHART_COLORS.light.warningForeground,
    ]);
  });

  it("une seule pastille pour deux alertes au même prix, la déclenchée l'emportant", () => {
    const { calls } = draw(attached([input, { ...input, id: "b", status: "triggered" }]));

    expect(calls.filter((c) => c[0] === "fill")).toEqual([["fill", CHART_COLORS.light.warning]]);
  });

  it("ne dessine rien pour un prix sans coordonnée", () => {
    const primitive = new AlertsPrimitive(drawnAlerts([input], false));
    primitive.attached({ series: { priceToCoordinate: () => null } as never });
    primitive.updateAllViews();

    expect(draw(primitive).calls.filter((c) => c[0] !== "dash")).toEqual([]);
  });
});
