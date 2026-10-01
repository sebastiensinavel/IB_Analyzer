/**
 * Les alertes de prix dessinées sur le graphe : un pointillé fin pleine largeur et, dans le
 * panneau, juste à gauche de l'échelle des prix, une pastille ronde portant une cloche. Une
 * seconde primitive de série, à côté de celle des niveaux (`levelsPrimitive.ts`) : les alertes
 * n'ont ni date, ni rectangle, ni étiquette ; leur seuil se lit dans l'infobulle de la pastille
 * (`AlertOverlay`). Spec du sous-projet 42, §8.1.
 */
import type { ISeriesApi } from "lightweight-charts";
import type { AlertKind, AlertStatus, AlertThreshold } from "@ib/alerts";
import type { Strategy } from "@ib/ledger";
import type { AlertView } from "@/alerts/useAlertEngine";
import { chartColors } from "@/lib/chartColors";

/** Le diamètre de la pastille d'une alerte, en pixels CSS. */
export const ALERT_BELL_SIZE_PX = 16;
/** La distance du centre de la pastille au bord droit du panneau, en pixels CSS. */
export const ALERT_BELL_INSET_PX = 18;
/** La cloche dans sa pastille, en pixels CSS. */
const BELL_ICON_PX = 10;
/** Les deux tracés de l'icône lucide `Bell`, dans sa boîte de 24, et l'épaisseur de son trait. */
const BELL_PATHS = [
  "M10.268 21a2 2 0 0 0 3.464 0",
  "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
] as const;
const BELL_VIEWBOX = 24;
const BELL_STROKE = 2;

/** Une alerte à dessiner, un seuil par entrée : un condor en donne deux. */
export interface DrawnAlertInput {
  id: string;
  kind: AlertKind;
  price: number;
  /** Le sens du seuil : la flèche de l'infobulle de la pastille. */
  direction: AlertThreshold["direction"];
  status: AlertStatus;
}

export interface DrawnAlert {
  id: string;
  price: number;
  /** La couleur du trait : voilée tant que l'alerte est active, pleine une fois déclenchée. */
  line: string;
  /**
   * La pastille : `backdrop` d'abord (le fond du graphe, pour qu'un voile cache le pointillé),
   * puis `fill`, puis la cloche en trait `ink`.
   */
  bell: { backdrop: string | null; fill: string; ink: string };
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
      inputs.push({
        id: `${alert.id}#${index}`,
        kind: alert.kind,
        price: threshold.price,
        direction: threshold.direction,
        status,
      }),
    );
  }
  return inputs;
}

/** `#rrggbb` voilé à `alpha`. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Les couleurs de chaque alerte selon le thème, sans rien de la géométrie. */
export function drawnAlerts(inputs: readonly DrawnAlertInput[], isDark: boolean): DrawnAlert[] {
  const colors = chartColors(isDark);
  return inputs.map((input) => {
    const triggered = input.status === "triggered";
    return {
      id: input.id,
      price: input.price,
      line: triggered ? colors.warning : withAlpha(colors.warning, ACTIVE_LINE_ALPHA),
      bell: triggered
        ? { backdrop: null, fill: colors.warning, ink: colors.warningForeground }
        : { backdrop: colors.surface, fill: withAlpha(colors.warning, ACTIVE_FILL_ALPHA), ink: colors.warning },
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

/** Les tracés de la cloche, construits au premier dessin : `Path2D` n'existe que dans un navigateur. */
let bellPaths: Path2D[] | null = null;
function bellIcon(): Path2D[] {
  bellPaths ??= BELL_PATHS.map((d) => new Path2D(d));
  return bellPaths;
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
      // Une pastille par hauteur : deux alertes au même prix n'en montrent qu'une, la déclenchée
      // l'emportant.
      const bells = new Map<number, DrawnAlert>();
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
        const seen = bells.get(y);
        if (!seen || (seen.bell.backdrop !== null && item.drawn.bell.backdrop === null)) bells.set(y, item.drawn);
      }
      ctx.restore();

      // Les pastilles par-dessus les traits : le pointillé passe derrière.
      const cx = scope.bitmapSize.width - ALERT_BELL_INSET_PX * hr;
      const radius = (ALERT_BELL_SIZE_PX / 2) * hr;
      const scale = (BELL_ICON_PX / BELL_VIEWBOX) * hr;
      for (const [cy, drawn] of bells) {
        ctx.save();
        for (const fill of [drawn.bell.backdrop, drawn.bell.fill]) {
          if (fill === null) continue;
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.translate(cx - (BELL_ICON_PX / 2) * hr, cy - (BELL_ICON_PX / 2) * hr);
        ctx.scale(scale, scale);
        ctx.setLineDash([]);
        ctx.lineWidth = BELL_STROKE;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = drawn.bell.ink;
        for (const path of bellIcon()) ctx.stroke(path);
        ctx.restore();
      }
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
}
