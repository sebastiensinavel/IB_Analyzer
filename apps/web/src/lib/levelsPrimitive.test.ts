import { describe, expect, it, vi } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import {
  LevelsPrimitive,
  LevelsRenderer,
  CHART_MARGIN_DAYS,
  labelOffsets,
  timeExtent,
  type DrawnLevel,
  type Placed,
  type Scope,
} from "@/lib/levelsPrimitive";

const bar = (date: string) => ({ date, open: 1, high: 1, low: 1, close: 1, volume: 1 });

/** Un `target` de primitive qui enregistre les appels au lieu de dessiner : jsdom n'a pas de canevas. */
function fakeTarget() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    setLineDash: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    font: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
  };
  const target = {
    useBitmapCoordinateSpace: (cb: (scope: Scope) => void) =>
      cb({
        context: ctx as unknown as CanvasRenderingContext2D,
        bitmapSize: { width: 200, height: 100 },
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
      }),
  };
  return { ctx, target };
}

const drawn = (level: ChartLevel, over: Partial<DrawnLevel> = {}): DrawnLevel => ({
  level,
  color: "#112233",
  fill: "#11223366",
  price: null,
  label: null,
  ...over,
});

const placedItem = (over: Partial<Placed> & Pick<Placed, "drawn">): Placed => ({ y: null, xs: [], rect: [], ...over });

const put: ChartLevel = { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-25"] };
const condorLevel: ChartLevel = {
  kind: "condor",
  from: "2026-04-02",
  to: "2026-06-19",
  putStrikes: [8, 10],
  callStrikes: [16, 18],
  quantity: -1,
};

describe("timeExtent", () => {
  /** La marge de respiration attendue au bout de l'axe, jours ouvrés, après chaque date charnière. */
  const marginAfter: Record<string, string[]> = {
    "2026-09-22": ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"],
    "2026-09-24": ["2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"],
    "2026-09-25": ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"],
    "2026-09-26": ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"],
  };

  it("prolonge l'axe jusqu'à l'échéance la plus lointaine, jours ouvrés seulement", () => {
    const levels: ChartLevel[] = [
      { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-25"] },
      { kind: "shortCall", price: 22, quantity: -1, expiries: ["2026-09-23"] },
    ];

    const days = timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels);

    expect(days).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", ...marginAfter["2026-09-25"]]);
  });

  it("ne pose que la marge quand tout est déjà couvert par les barres", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-21"] }];

    // Le bord droit ne doit pas non plus coller à la dernière bougie : la marge est inconditionnelle.
    expect(timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels)).toEqual(marginAfter["2026-09-22"]);
  });

  it("laisse CHART_MARGIN_DAYS jours ouvrés au-delà de la dernière date dessinée", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-25"] }];

    const days = timeExtent([bar("2026-09-22")], levels);

    expect(days.indexOf("2026-09-25")).toBe(days.length - 1 - CHART_MARGIN_DAYS);
  });

  it("compte l'échéance d'un condor comme une date à couvrir", () => {
    const levels: ChartLevel[] = [
      { kind: "condor", from: "2026-04-02", to: "2026-09-24", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 },
    ];

    expect(timeExtent([bar("2026-09-22")], levels)).toEqual(["2026-09-23", "2026-09-24", ...marginAfter["2026-09-24"]]);
  });

  it("ne prolonge rien sans barre : il n'y a alors rien à dessiner", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-12-18"] }];

    expect(timeExtent([], levels)).toEqual([]);
  });

  it("place la date la plus lointaine même si elle tombe un week-end", () => {
    const levels: ChartLevel[] = [
      { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-26"] },
    ];

    // 2026-09-26 est un samedi : les jours intermédiaires restent ouvrés, mais la date
    // demandée doit exister, sinon rien ne peut la placer.
    expect(timeExtent([bar("2026-09-22")], levels)).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      ...marginAfter["2026-09-26"],
    ]);
  });
});

describe("LevelsRenderer", () => {
  it("peint une horizontale et ses verticales quand les coordonnées existent", () => {
    const placed: Placed[] = [placedItem({ drawn: drawn(put, { price: 17.5 }), y: 30, xs: [50] })];
    const { ctx, target } = fakeTarget();

    new LevelsRenderer(placed).draw(target);

    // Une horizontale (0 → largeur) puis une verticale (hauteur pleine), dans cet ordre.
    expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 0, 30.5);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 200, 30.5);
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 50.5, 0);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 50.5, 100);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it("n'écarte une horizontale que si son ordonnée manque, jamais les verticales des dates connues", () => {
    const placed: Placed[] = [placedItem({ drawn: drawn(put), xs: [null, 90] })];
    const { ctx, target } = fakeTarget();

    new LevelsRenderer(placed).draw(target);

    // Aucune horizontale : un seul moveTo/lineTo, pour la seule verticale non nulle.
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(90.5, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(90.5, 100);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it("n'écrit une étiquette de gauche que si l'horizontale existe", () => {
    const withLabel: Placed[] = [placedItem({ drawn: drawn(put, { price: 17.5, label: "17,5 Put: -4" }), y: 30 })];
    const withoutLabel: Placed[] = [placedItem({ drawn: drawn(put, { price: 17.5, label: "17,5 Put: -4" }) })];

    const labeled = fakeTarget();
    new LevelsRenderer(withLabel).draw(labeled.target);
    expect(labeled.ctx.fillText).toHaveBeenCalledWith("17,5 Put: -4", expect.any(Number), 30);

    const unlabeled = fakeTarget();
    new LevelsRenderer(withoutLabel).draw(unlabeled.target);
    expect(unlabeled.ctx.fillText).not.toHaveBeenCalled();
  });

  it("pose côte à côte deux étiquettes au même prix, chacune centrée sur sa ligne", () => {
    const call: ChartLevel = { kind: "shortCall", price: 13, quantity: -4, expiries: ["2026-09-25"] };
    const shares: ChartLevel = { kind: "shares", price: 13, quantity: 400 };
    const placed: Placed[] = [
      placedItem({ drawn: drawn(shares, { price: 13, label: "13 Long: 400" }), y: 30 }),
      placedItem({ drawn: drawn(call, { price: 13, label: "13 Call: -4" }), y: 31 }),
    ];
    const { ctx, target } = fakeTarget();

    new LevelsRenderer(placed).draw(target);

    // measureText rend 10 : chaque cadre fait 10 + 2 × 4 = 18 de large, plus 2 d'écart.
    expect(ctx.fillText).toHaveBeenCalledWith("13 Long: 400", 4, 30);
    expect(ctx.fillText).toHaveBeenCalledWith("13 Call: -4", 24, 31);
  });

  it("peint les deux rectangles d'un condor, puts et calls appariés séparément", () => {
    // long put 30, short put 20, short call 10, long call 5 : ordonnées croissantes vers le bas.
    const placed: Placed[] = [placedItem({ drawn: drawn(condorLevel), xs: [10, 100], rect: [30, 20, 10, 5] })];
    const { ctx, target } = fakeTarget();

    new LevelsRenderer(placed).draw(target);

    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    // Rectangle des puts : de shortPut (20) à longPut (30).
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, 10, 20, 90, 10);
    // Rectangle des calls : de longCall (5) à shortCall (10) — jamais mélangé avec les puts.
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 10, 5, 90, 5);
    // Le voile vient du niveau, jamais d'une opacité recodée ici : le thème seul en décide.
    expect(ctx.fillStyle).toBe("#11223366");
  });

  it("ne peint qu'un rectangle quand l'autre paire perd une ordonnée", () => {
    const placed: Placed[] = [placedItem({ drawn: drawn(condorLevel), xs: [10, 100], rect: [null, 20, 10, 5] })];
    const { ctx, target } = fakeTarget();

    new LevelsRenderer(placed).draw(target);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 5, 90, 5);
  });

  it("ne peint rien d'un condor dont une date manque", () => {
    const placed: Placed[] = [placedItem({ drawn: drawn(condorLevel), xs: [null, 100], rect: [30, 20, 10, 5] })];
    const { ctx, target } = fakeTarget();

    new LevelsRenderer(placed).draw(target);

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe("LevelsPrimitive.timeAxisViews", () => {
  function primitiveWith(atCoordinate: number | null) {
    const primitive = new LevelsPrimitive([drawn(put)]);
    const chart = { timeScale: () => ({ timeToCoordinate: () => atCoordinate }) };
    primitive.attached({ chart, series: {} } as never);
    return primitive;
  }

  it("étiquette invisible quand timeToCoordinate rend null (hors de la fenêtre chargée)", () => {
    const [view] = primitiveWith(null).timeAxisViews();

    expect(view.visible()).toBe(false);
    // `coordinate` n'est pas nullable côté bibliothèque : replié à 0, jamais lu tant qu'invisible.
    expect(view.coordinate()).toBe(0);
  });

  it("étiquette visible avec la coordonnée rendue quand la date est dans la fenêtre", () => {
    const [view] = primitiveWith(42).timeAxisViews();

    expect(view.visible()).toBe(true);
    expect(view.coordinate()).toBe(42);
  });
});

describe("LevelsPrimitive.updateAllViews", () => {
  it("place un niveau depuis un faux chart et une fausse série, puis le dessine", () => {
    const primitive = new LevelsPrimitive([drawn(put, { price: 17.5 })]);
    const chart = { timeScale: () => ({ timeToCoordinate: () => 50 }) };
    const series = { priceToCoordinate: () => 30 };
    primitive.attached({ chart, series } as never);

    primitive.updateAllViews();
    const { ctx, target } = fakeTarget();
    primitive.paneViews()[0].renderer().draw(target);

    expect(ctx.moveTo).toHaveBeenNthCalledWith(1, 0, 30.5);
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 50.5, 0);
  });

  it("ne place plus rien après `detached`", () => {
    const primitive = new LevelsPrimitive([drawn(put, { price: 17.5 })]);
    const chart = { timeScale: () => ({ timeToCoordinate: () => 50 }) };
    const series = { priceToCoordinate: () => 30 };
    primitive.attached({ chart, series } as never);
    primitive.updateAllViews();

    primitive.detached();
    primitive.updateAllViews();
    const { ctx, target } = fakeTarget();
    primitive.paneViews()[0].renderer().draw(target);

    expect(ctx.moveTo).not.toHaveBeenCalled();
  });
});

describe("labelOffsets", () => {
  it("laisse au bord gauche les étiquettes qui ne se touchent pas", () => {
    expect(labelOffsets([{ y: 10, width: 50 }, { y: 40, width: 50 }], 16, 2)).toEqual([0, 0]);
  });

  it("décale vers la droite une étiquette qui en chevaucherait une autre", () => {
    expect(labelOffsets([{ y: 10, width: 50 }, { y: 20, width: 30 }], 16, 2)).toEqual([0, 52]);
  });

  it("enchaîne trois étiquettes superposées, et reprend le bord gauche dès qu'il est libre", () => {
    const boxes = [
      { y: 10, width: 50 },
      { y: 12, width: 30 },
      { y: 14, width: 20 },
      { y: 60, width: 40 },
    ];
    expect(labelOffsets(boxes, 16, 2)).toEqual([0, 52, 84, 0]);
  });

  it("ne regarde que les étiquettes qui la touchent à sa hauteur", () => {
    const boxes = [
      { y: 10, width: 50 },
      { y: 30, width: 40 },
      { y: 30, width: 20 },
      { y: 20, width: 10 },
    ];
    // B reste à 0 : 20 d'écart avec A, plus que la hauteur 16. C, au même y que B, passe à 42.
    // La 4e (y 20) touche A (0-50), B (0-40) et C (42-62) : elle part à 64.
    expect(labelOffsets(boxes, 16, 2)).toEqual([0, 0, 42, 64]);
  });
});
