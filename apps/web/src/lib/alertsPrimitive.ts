/**
 * Les alertes de prix dessinées sur le graphe : un pointillé fin pleine largeur et, sur
 * l'échelle de droite, l'étiquette du prix. Une seconde primitive de série, à côté de celle des
 * niveaux (`levelsPrimitive.ts`) : les alertes n'ont ni date, ni rectangle, ni étiquette de
 * gauche, et l'étiquette d'axe est ce que Lightweight Charts sait poser lui-même
 * (`priceAxisViews`). Spec du sous-projet 42, §8.1.
 */
import type { ISeriesApi } from "lightweight-charts";
import type { AlertKind, AlertStatus } from "@ib/alerts";
import type { Strategy } from "@ib/ledger";
import type { AlertView } from "@/alerts/useAlertEngine";
import { chartColors } from "@/lib/chartColors";
import { formatLevelValue } from "@/lib/chartLevels";

/** Une alerte à dessiner, un seuil par entrée : un condor en donne deux. */
export interface DrawnAlertInput {
  id: string;
  kind: AlertKind;
  price: number;
  status: AlertStatus;
}

export interface DrawnAlert {
  id: string;
  price: number;
  /** La couleur du trait : voilée tant que l'alerte est active, pleine une fois déclenchée. */
  line: string;
  label: { text: string; fill: string; ink: string };
}

const ACTIVE_LINE_ALPHA = 0.55;
const ACTIVE_FILL_ALPHA = 0.18;

/**
 * Les alertes que le graphe d'un ticker montre : ses manuelles toujours, les automatiques des
 * seules stratégies de la portée du graphe. Les désactivées, et les automatiques sans seuil
 * (S₀ manquant), ne se dessinent pas.
 */
export function chartAlerts(
  views: readonly AlertView[],
  ticker: string,
  strategies: readonly Strategy[],
): DrawnAlertInput[] {
  const wanted = ticker.toUpperCase();
  const inputs: DrawnAlertInput[] = [];
  for (const { alert, status } of views) {
    if (status === "disabled" || alert.thresholds === null) continue;
    if (alert.ticker.toUpperCase() !== wanted) continue;
    if (alert.kind === "wheel" && !strategies.includes("wheel")) continue;
    if (alert.kind === "condor" && !strategies.includes("condors")) continue;
    alert.thresholds.forEach((threshold, index) =>
      inputs.push({ id: `${alert.id}#${index}`, kind: alert.kind, price: threshold.price, status }),
    );
  }
  return inputs;
}

/** `#rrggbb` voilé à `alpha`. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Couleurs et texte de chaque alerte : le thème et la langue, sans rien de la géométrie. */
export function drawnAlerts(inputs: readonly DrawnAlertInput[], isDark: boolean, locale: string): DrawnAlert[] {
  const colors = chartColors(isDark);
  return inputs.map((input) => {
    const triggered = input.status === "triggered";
    return {
      id: input.id,
      price: input.price,
      line: triggered ? colors.warning : withAlpha(colors.warning, ACTIVE_LINE_ALPHA),
      label: {
        text: formatLevelValue(input.price, locale),
        fill: triggered ? colors.warning : withAlpha(colors.warning, ACTIVE_FILL_ALPHA),
        ink: triggered ? colors.warningForeground : colors.foreground,
      },
    };
  });
}

interface Placed {
  drawn: DrawnAlert;
  y: number | null;
}

interface Scope {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}

export class AlertsRenderer {
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
      ctx.lineWidth = 1 * hr;
      ctx.setLineDash([2 * hr, 3 * hr]);
      for (const item of this.placed) {
        if (item.y === null) continue;
        const y = Math.round(item.y * vr) + 0.5;
        ctx.strokeStyle = item.drawn.line;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(scope.bitmapSize.width, y);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

export class AlertsPrimitive {
  private readonly drawn: readonly DrawnAlert[];
  private series: ISeriesApi<"Candlestick"> | null = null;
  private placed: Placed[] = [];

  constructor(drawn: readonly DrawnAlert[]) {
    this.drawn = drawn;
  }

  attached(param: { series: ISeriesApi<"Candlestick"> }) {
    this.series = param.series;
  }

  detached() {
    this.series = null;
  }

  updateAllViews() {
    const series = this.series;
    this.placed = this.drawn.map((drawn) => ({
      drawn,
      y: series ? (series.priceToCoordinate(drawn.price) as number | null) : null,
    }));
  }

  paneViews() {
    const placed = this.placed;
    return [{ renderer: () => new AlertsRenderer(placed), zOrder: () => "top" as const }];
  }

  /** Les étiquettes du prix sur l'échelle de droite. */
  priceAxisViews() {
    return this.placed.map(({ drawn, y }) => ({
      coordinate: () => y ?? 0,
      text: () => drawn.label.text,
      textColor: () => drawn.label.ink,
      backColor: () => drawn.label.fill,
      visible: () => y !== null,
      tickVisible: () => false,
    }));
  }
}

