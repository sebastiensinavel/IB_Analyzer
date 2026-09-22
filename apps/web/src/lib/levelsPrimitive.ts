/**
 * Le dessin des niveaux sur le graphe : horizontales, verticales, rectangles de condors et
 * étiquettes de gauche.
 *
 * Lightweight Charts v5 ne sait poser qu'une ligne de prix horizontale, dont l'étiquette va sur
 * l'échelle de droite. Tout le reste - une date, un rectangle, une étiquette à gauche - se
 * peint donc nous-mêmes, dans une primitive de série, à chaque redessin du panneau.
 */
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { ChartLevel } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";

export interface DrawnLevel {
  level: ChartLevel;
  color: string;
  /** `null` pour un condor, et pour un achat LEAPS dont le jour n'a pas de barre. */
  price: number | null;
  /** `null` quand le niveau n'en porte pas : les condors. */
  label: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Les dates que le dessin réclame : les échéances, les jours d'achat, les fins de condors. */
function datesOf(level: ChartLevel): string[] {
  switch (level.kind) {
    case "shortPut":
    case "shortCall":
      return level.expiries;
    case "leapsBuy":
      return [level.when];
    case "condor":
      return [level.from, level.to];
    default:
      return [];
  }
}

/**
 * Jours ouvrés de respiration à chaque bout de l'axe, au-delà du dernier jour qu'il doit
 * porter : une verticale collée au bord est illisible, et la dernière bougie mérite la même
 * marge. `visibleRange` (`components/PriceChart.tsx`) la reprend telle quelle à gauche.
 */
export const CHART_MARGIN_DAYS = 15;

/** Le jour ouvré suivant `time`, en millisecondes : les week-ends sont sautés. */
function nextTradingTime(time: number): number {
  let next = time + MS_PER_DAY;
  for (;;) {
    const weekday = new Date(next).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return next;
    next += MS_PER_DAY;
  }
}

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Les jours vides à ajouter après la dernière barre pour qu'une échéance future ait une
 * coordonnée : sans eux, `timeToCoordinate` rend `null` et la verticale n'est pas tracée. Les
 * week-ends sont sautés, comme les barres elles-mêmes. L'axe va toujours `CHART_MARGIN_DAYS`
 * jours ouvrés au-delà du plus lointain des deux, dernière barre ou date dessinée : sans cette
 * marge, le bord droit colle à la dernière verticale, ou à la dernière bougie quand aucune date
 * dessinée ne la dépasse. Sans barre, rien n'est prolongé : il n'y a alors aucun graphe.
 */
export function timeExtent(bars: readonly PriceBar[], levels: readonly ChartLevel[]): string[] {
  if (bars.length === 0) return [];
  const last = bars[bars.length - 1].date;
  const furthest = levels.flatMap(datesOf).reduce((max, date) => (date > max ? date : max), last);
  const days: string[] = [];
  const end = Date.parse(`${furthest}T00:00:00Z`);
  for (let time = Date.parse(`${last}T00:00:00Z`) + MS_PER_DAY; time <= end; time += MS_PER_DAY) {
    const day = new Date(time);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push(dayOf(time));
  }
  // La date la plus lointaine doit toujours avoir une coordonnée, même un week-end : sinon
  // rien ne peut la placer. Les jours intermédiaires restent des jours ouvrés.
  if (furthest > last && days[days.length - 1] !== furthest) days.push(furthest);
  let time = Date.parse(`${days[days.length - 1] ?? last}T00:00:00Z`);
  for (let added = 0; added < CHART_MARGIN_DAYS; added += 1) {
    time = nextTradingTime(time);
    days.push(dayOf(time));
  }
  return days;
}

export interface Scope {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}

export interface Placed {
  drawn: DrawnLevel;
  y: number | null;
  /** Coordonnées des dates du niveau, dans l'ordre de `datesOf`. */
  xs: (number | null)[];
  /** Pour un condor : les quatre ordonnées, long put, short put, short call, long call. */
  rect: (number | null)[];
}

const LABEL_PADDING = 4;
const LABEL_HEIGHT = 16;

export class LevelsRenderer {
  private readonly placed: readonly Placed[];

  constructor(placed: readonly Placed[]) {
    this.placed = placed;
  }

  draw(target: { useBitmapCoordinateSpace: (cb: (scope: Scope) => void) => void }) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      for (const item of this.placed) {
        const color = item.drawn.color;
        if (item.drawn.level.kind === "condor") {
          this.drawCondor(ctx, item, hr, vr);
          continue;
        }
        if (item.y !== null) {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, Math.floor(vr));
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(0, Math.round(item.y * vr) + 0.5);
          ctx.lineTo(scope.bitmapSize.width, Math.round(item.y * vr) + 0.5);
          ctx.stroke();
          if (item.drawn.label !== null) this.drawLabel(ctx, item.drawn.label, item.y * vr, color, hr, vr);
        }
        for (const x of item.xs) {
          if (x === null) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, Math.floor(hr));
          ctx.setLineDash([6 * vr, 4 * vr]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x * hr) + 0.5, 0);
          ctx.lineTo(Math.round(x * hr) + 0.5, scope.bitmapSize.height);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }

  /** Deux rectangles translucides : les strikes de puts, ceux de calls, de l'ouverture à l'échéance. */
  private drawCondor(ctx: CanvasRenderingContext2D, item: Placed, hr: number, vr: number) {
    const [from, to] = item.xs;
    const [longPut, shortPut, shortCall, longCall] = item.rect;
    if (from === null || to === null) return;
    ctx.fillStyle = `${item.drawn.color}33`;
    for (const [top, bottom] of [
      [shortPut, longPut],
      [longCall, shortCall],
    ]) {
      if (top === null || bottom === null) continue;
      ctx.fillRect(from * hr, Math.min(top, bottom) * vr, (to - from) * hr, Math.abs(bottom - top) * vr);
    }
  }

  /** Le cadre de gauche, à la manière de l'étiquette de dernier cours. */
  private drawLabel(ctx: CanvasRenderingContext2D, text: string, y: number, color: string, hr: number, vr: number) {
    ctx.font = `${11 * vr}px ui-monospace, SFMono-Regular, monospace`;

    const width = ctx.measureText(text).width + 2 * LABEL_PADDING * hr;
    const height = LABEL_HEIGHT * vr;
    ctx.fillStyle = color;
    ctx.fillRect(0, y - height / 2, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, LABEL_PADDING * hr, y);
  }
}

export class LevelsPrimitive {
  private readonly drawn: readonly DrawnLevel[];
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private placed: Placed[] = [];

  constructor(drawn: readonly DrawnLevel[]) {
    this.drawn = drawn;
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<"Candlestick"> }) {
    this.chart = param.chart;
    this.series = param.series;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) {
      this.placed = [];
      return;
    }
    const x = (day: string) => chart.timeScale().timeToCoordinate(day as Time) as number | null;
    const y = (price: number | null) => (price === null ? null : (series.priceToCoordinate(price) as number | null));
    this.placed = this.drawn.map((drawn) => ({
      drawn,
      y: y(drawn.price),
      xs: datesOf(drawn.level).map(x),
      rect:
        drawn.level.kind === "condor"
          ? [drawn.level.putStrikes[0], drawn.level.putStrikes[1], drawn.level.callStrikes[0], drawn.level.callStrikes[1]].map(y)
          : [],
    }));
  }

  paneViews() {
    const placed = this.placed;
    return [{ renderer: () => new LevelsRenderer(placed), zOrder: () => "top" as const }];
  }

  /** Les dates des verticales, sous l'axe du temps, dans la couleur de leur ligne. */
  timeAxisViews() {
    return this.drawn.flatMap((drawn) =>
      datesOf(drawn.level)
        .filter(() => drawn.level.kind !== "condor")
        .map((day) => {
          const at = () => (this.chart ? (this.chart.timeScale().timeToCoordinate(day as Time) as number | null) : null);
          return {
            coordinate: () => at() ?? 0,
            // Une date hors de la fenêtre chargée n'a pas de coordonnée : l'étiquette ne
            // s'affiche pas du tout. `coordinate` n'étant pas nullable, la bibliothèque
            // replacerait sinon l'étiquette au bord, et une date absente s'afficherait.
            visible: () => at() !== null,
            text: () => day.slice(5),
            textColor: () => "#ffffff",
            backColor: () => drawn.color,
            tickVisible: () => true,
          };
        }),
    );
  }
}
