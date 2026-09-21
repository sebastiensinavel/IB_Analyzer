import { describe, expect, it, vi } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { LevelsPrimitive, LevelsRenderer, timeExtent, type DrawnLevel, type Placed } from "@/lib/levelsPrimitive";

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
    useBitmapCoordinateSpace: (cb: (scope: unknown) => void) =>
      cb({ context: ctx, bitmapSize: { width: 200, height: 100 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }),
  };
  return { ctx, target };
}

const drawn = (level: ChartLevel, over: Partial<DrawnLevel> = {}): DrawnLevel => ({
  level,
  color: "#112233",
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
  it("prolonge l'axe jusqu'à l'échéance la plus lointaine, jours ouvrés seulement", () => {
    const levels: ChartLevel[] = [
      { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-25"] },
      { kind: "shortCall", price: 22, quantity: -1, expiries: ["2026-09-23"] },
    ];

    const days = timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels);

    expect(days).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("ne prolonge rien quand tout est déjà couvert par les barres", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-21"] }];

    expect(timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels)).toEqual([]);
  });

  it("compte l'échéance d'un condor comme une date à couvrir", () => {
    const levels: ChartLevel[] = [
      { kind: "condor", from: "2026-04-02", to: "2026-09-24", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 },
    ];

    expect(timeExtent([bar("2026-09-22")], levels)).toEqual(["2026-09-23", "2026-09-24"]);
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
    expect(timeExtent([bar("2026-09-22")], levels)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]);
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
