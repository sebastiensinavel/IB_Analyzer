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
import { CHART_FONT } from "@/lib/chartColors";
import { labelInk } from "@/lib/chartLevels";

export interface DrawnLevel {
  level: ChartLevel;
  color: string;
  /** Le remplissage des rectangles d'un condor : la teinte voilée que donne `levelFill`. */
  fill: string;
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
/** L'écart entre deux étiquettes posées côte à côte. */
const LABEL_GAP = 2;

/**
 * L'abscisse de chaque étiquette de gauche, dans l'ordre reçu : le bord gauche, sauf si elle y
 * chevaucherait une étiquette déjà posée à moins d'une hauteur d'elle — elle passe alors à sa
 * droite, jusqu'à trouver la place. Chacune reste centrée sur sa ligne : deux niveaux au même
 * prix (`13 Long: 400`, `13 Call: -4`) se lisent l'un à côté de l'autre, jamais l'un sur l'autre.
 */
export function labelOffsets(boxes: readonly { y: number; width: number }[], height: number, gap: number): number[] {
  const placed: { y: number; x: number; width: number }[] = [];
  return boxes.map(({ y, width }) => {
    let x = 0;
    for (;;) {
      const blocking = placed.find(
        (other) => Math.abs(other.y - y) < height && other.x < x + width + gap && x < other.x + other.width + gap,
      );
      if (!blocking) break;
      x = blocking.x + blocking.width + gap;
    }
    placed.push({ y, x, width });
    return x;
  });
}

/** Le trait qui relie une date de l'axe du temps à sa verticale, puis la hauteur de son cadre. */
const AXIS_TICK = 4;
const AXIS_LABEL_HEIGHT = 18;
const AXIS_LABEL_PADDING = 4;

/**
 * Le centre de chaque étiquette de l'axe du temps, dans l'ordre reçu. Des étiquettes qui se
 * chevauchent (`x` le centre voulu) forment un groupe posé bord à bord, centré sur la moyenne de
 * leurs centres voulus, et un groupe qu'un écartement pousse contre un voisin fusionne avec lui,
 * jusqu'à ce que plus rien ne se touche. Aucun groupe ne sort de `[0, axisWidth]`. L'axe n'a la
 * hauteur que d'une étiquette : on ne peut écarter qu'en largeur.
 */
export function spreadLabels(labels: readonly { x: number; width: number }[], gap: number, axisWidth: number): number[] {
  type Group = { members: number[]; left: number; width: number };
  const order = labels.map((_, index) => index).sort((a, b) => labels[a].x - labels[b].x);
  const lay = (members: number[]): Group => {
    const width = members.reduce((sum, index) => sum + labels[index].width, 0) + gap * (members.length - 1);
    const center = members.reduce((sum, index) => sum + labels[index].x, 0) / members.length;
    const left = Math.min(Math.max(center - width / 2, 0), Math.max(axisWidth - width, 0));
    return { members, left, width };
  };
  let groups = order.map((index) => lay([index]));
  for (let merged = true; merged; ) {
    merged = false;
    const next: Group[] = [];
    for (const group of groups) {
      const previous = next[next.length - 1];
      if (previous && previous.left + previous.width + gap > group.left) {
        next[next.length - 1] = lay([...previous.members, ...group.members]);
        merged = true;
      } else next.push(group);
    }
    groups = next;
  }
  const centers: number[] = new Array(labels.length);
  for (const group of groups) {
    let left = group.left;
    for (const index of group.members) {
      centers[index] = left + labels[index].width / 2;
      left += labels[index].width + gap;
    }
  }
  return centers;
}

/**
 * Les dates des verticales, dessinées dans l'axe du temps. `timeAxisViews` de la bibliothèque
 * pose chaque étiquette à sa coordonnée sans jamais l'écarter d'une autre (seul l'axe des prix
 * le fait) : deux échéances proches s'y recouvraient. Ici un trait marque la date exacte et le
 * cadre s'écarte de ses voisins (`spreadLabels`).
 */
export class TimeAxisRenderer {
  private readonly placed: readonly Placed[];

  constructor(placed: readonly Placed[]) {
    this.placed = placed;
  }

  draw(target: { useBitmapCoordinateSpace: (cb: (scope: Scope) => void) => void }) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const labels = this.placed.flatMap((item) =>
        item.drawn.level.kind === "condor"
          ? []
          : datesOf(item.drawn.level).flatMap((day, index) => {
              const x = item.xs[index];
              return x === null || x === undefined ? [] : [{ text: day.slice(5), x: x * hr, color: item.drawn.color }];
            }),
      );
      if (labels.length === 0) return;
      ctx.save();
      ctx.font = `${12 * vr}px ${CHART_FONT}`;
      const widths = labels.map((label) => ctx.measureText(label.text).width + 2 * AXIS_LABEL_PADDING * hr);
      const centers = spreadLabels(
        labels.map((label, index) => ({ x: label.x, width: widths[index] })),
        LABEL_GAP * hr,
        scope.bitmapSize.width,
      );
      const top = AXIS_TICK * vr;
      const height = AXIS_LABEL_HEIGHT * vr;
      ctx.lineWidth = Math.max(1, Math.floor(hr));
      ctx.setLineDash([]);
      for (const label of labels) {
        ctx.strokeStyle = label.color;
        ctx.beginPath();
        ctx.moveTo(Math.round(label.x) + 0.5, 0);
        ctx.lineTo(Math.round(label.x) + 0.5, top);
        ctx.stroke();
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      labels.forEach((label, index) => {
        ctx.fillStyle = label.color;
        ctx.fillRect(centers[index] - widths[index] / 2, top, widths[index], height);
        ctx.fillStyle = labelInk(label.color);
        ctx.fillText(label.text, centers[index], top + height / 2);
      });
      ctx.restore();
    });
  }
}

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
      const labels: { text: string; y: number; color: string }[] = [];
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
          if (item.drawn.label !== null) labels.push({ text: item.drawn.label, y: item.y * vr, color });
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
      // Les étiquettes après toutes les lignes, pour qu'aucune ligne ne les barre.
      this.drawLabels(ctx, labels, hr, vr);
      ctx.restore();
    });
  }

  /** Deux rectangles translucides : les strikes de puts, ceux de calls, de l'ouverture à l'échéance. */
  private drawCondor(ctx: CanvasRenderingContext2D, item: Placed, hr: number, vr: number) {
    const [from, to] = item.xs;
    const [longPut, shortPut, shortCall, longCall] = item.rect;
    if (from === null || to === null) return;
    ctx.fillStyle = item.drawn.fill;
    for (const [top, bottom] of [
      [shortPut, longPut],
      [longCall, shortCall],
    ]) {
      if (top === null || bottom === null) continue;
      ctx.fillRect(from * hr, Math.min(top, bottom) * vr, (to - from) * hr, Math.abs(bottom - top) * vr);
    }
  }

  /** Les cadres de gauche, à la manière de l'étiquette de dernier cours, côte à côte s'ils se touchent. */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    labels: readonly { text: string; y: number; color: string }[],
    hr: number,
    vr: number,
  ) {
    ctx.font = `${11 * vr}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textBaseline = "middle";
    const height = LABEL_HEIGHT * vr;
    const widths = labels.map((label) => ctx.measureText(label.text).width + 2 * LABEL_PADDING * hr);
    const xs = labelOffsets(
      labels.map((label, index) => ({ y: label.y, width: widths[index] })),
      height,
      LABEL_GAP * hr,
    );
    labels.forEach((label, index) => {
      ctx.fillStyle = label.color;
      ctx.fillRect(xs[index], label.y - height / 2, widths[index], height);
      // Le blanc ne porte plus un contraste suffisant sur les teintes claires de la palette
      // (l'or, ~2) : `labelInk` choisit le blanc ou l'encre sombre selon le contraste WCAG réel.
      ctx.fillStyle = labelInk(label.color);
      ctx.fillText(label.text, xs[index] + LABEL_PADDING * hr, label.y);
    });
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

  /** Les dates des verticales, sous l'axe du temps : `TimeAxisRenderer`. */
  timeAxisPaneViews() {
    const placed = this.placed;
    return [{ renderer: () => new TimeAxisRenderer(placed), zOrder: () => "top" as const }];
  }
}
