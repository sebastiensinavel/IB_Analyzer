/**
 * Poser, glisser et régler une alerte manuelle depuis un graphe (spec du sous-projet 42, §8.2),
 * à la manière de TradingView : une cloche « + » suit le réticule sur l'axe des prix, Alt+clic
 * ou un appui long au doigt posent une alerte, une ligne manuelle se saisit à 4 px et se glisse,
 * un clic sur sa pastille-cloche ouvre son réglage. Les automatiques ne se glissent ni ne se
 * règlent ici : leur seuil suit la marge de la page Alertes. Le survol d'une pastille, manuelle
 * ou automatique, en donne le seuil dans une infobulle.
 *
 * Un calque absolu au-dessus du graphe, transparent au pointeur sauf sur ses propres boutons :
 * les gestes sur le graphe s'écoutent sur l'élément de Lightweight Charts lui-même, et chaque
 * hauteur se relit à l'instant du geste (`priceToCoordinate`), jamais d'une position gardée,
 * que le zoom aurait rendue fausse.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Plus } from "lucide-react";
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";
import { roundToCent, type AlertStatus } from "@ib/alerts";
import { Button } from "@ib/ui/button";
import { Input } from "@ib/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ib/ui/popover";
import { baseAlertId, hitAlert, hitBell, priceAtY } from "@/lib/alertGestures";
import { ALERT_BELL_INSET_PX, ALERT_BELL_SIZE_PX, type DrawnAlertInput } from "@/lib/alertsPrimitive";
import { formatLocalePrice, formatPrice } from "@/lib/format";

/** Ce que le graphe fait des gestes : écrire en base est l'affaire de celui qui le monte. */
export interface AlertEditHandlers {
  /** Une alerte manuelle au prix donné, déjà arrondi au cent. */
  onCreateAlert: (price: number) => void;
  /** `id` est celui de l'alerte (`manual:<uuid>`), sans l'indice du seuil. */
  onMoveAlert: (id: string, price: number) => void;
  onEditAlert: (id: string, patch: { price: number; note: string | null }) => void;
  onDeleteAlert: (id: string) => void;
  onReactivateAlert: (id: string) => void;
  noteOf: (id: string) => string | null;
}

export interface AlertOverlayProps extends AlertEditHandlers {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  alerts: readonly DrawnAlertInput[];
}

/** La durée d'un appui long au doigt, et le déplacement qui en fait un défilement. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;
/** La demi-hauteur de la cloche (`size-5`). */
const BELL_HALF_PX = 10;

const SCROLL_OFF = { handleScroll: false, handleScale: false } as const;
const SCROLL_ON = { handleScroll: true, handleScale: true } as const;

interface Editing {
  id: string;
  y: number;
  price: number;
  status: AlertStatus;
}

/** La pastille sous le pointeur : `drawnId` est celui de la ligne dessinée. */
interface Hovered {
  drawnId: string;
  y: number;
}

export function AlertOverlay(props: AlertOverlayProps) {
  const { chart, series } = props;
  const { t, i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [bell, setBell] = useState<number | null>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Les écouteurs sont posés une fois par graphe : ils relisent les alertes et les rappels ici.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  /** Le réglage d'une manuelle, ouvert près de sa pastille. */
  const openEditor = useCallback((drawnId: string, y: number) => {
    const alert = latest.current.alerts.find((a) => a.id === drawnId);
    if (!alert || alert.kind !== "manual") return;
    setBell(null);
    setEditing({ id: baseAlertId(alert.id), y, price: alert.price, status: alert.status });
  }, []);

  useEffect(() => {
    const element = chart.chartElement();
    const paneWidth = () => chart.timeScale().width();
    const toPrice = (y: number) => priceAtY(y, (v) => series.coordinateToPrice(v) as number | null);
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    /** Les lignes, manuelles seulement ou toutes, à leur hauteur de cet instant. */
    const lines = (manualOnly: boolean) =>
      latest.current.alerts
        .filter((alert) => !manualOnly || alert.kind === "manual")
        .map((alert) => ({ id: alert.id, y: series.priceToCoordinate(alert.price) as number | null }));
    const manualLines = () => lines(true);
    /** Les pastilles, au centre où `AlertsPrimitive` les dessine. */
    const bells = (manualOnly: boolean) => lines(manualOnly).map((line) => ({ ...line, x: paneWidth() - ALERT_BELL_INSET_PX }));
    const create = (y: number) => {
      const price = toPrice(y);
      if (price !== null) latest.current.onCreateAlert(price);
    };

    let drag: { drawnId: string; pointerId: number; y: number } | null = null;
    const onCrosshair = (param: MouseEventParams<Time>) => {
      // Sans point, le pointeur a quitté le panneau — peut-être pour la cloche elle-même, sur
      // l'axe : c'est la sortie de l'élément qui la cache, pas celle du réticule.
      // Pendant un glisser, le réticule suit la ligne fantôme : la cloche n'a rien à y faire.
      if (!param.point || drag) return;
      setBell(param.point.y);
    };
    const onClick = (param: MouseEventParams<Time>) => {
      const source = param.sourceEvent as { altKey?: boolean } | undefined;
      if (source?.altKey && param.point) create(param.point.y);
    };
    chart.subscribeCrosshairMove(onCrosshair);
    chart.subscribeClick(onClick);

    let press: { pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const cancelPress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const endDrag = (commit: boolean) => {
      if (!drag) return;
      const ended = drag;
      drag = null;
      setGhost(null);
      // Rétabli dans tous les cas, avant l'écriture : un rappel qui échoue ne fige pas le graphe.
      chart.applyOptions(SCROLL_ON);
      if (element.hasPointerCapture?.(ended.pointerId)) element.releasePointerCapture(ended.pointerId);
      const alert = latest.current.alerts.find((a) => a.id === ended.drawnId);
      const price = toPrice(ended.y);
      if (commit && alert && price !== null && price !== alert.price) latest.current.onMoveAlert(baseAlertId(alert.id), price);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.altKey) return;
      const { x, y } = local(event);
      if (x > paneWidth()) return;
      // La pastille d'une manuelle s'ouvre au clic : l'appuyer n'entame ni glisser ni appui long.
      if (hitBell({ x, y }, bells(true)) !== null) return;
      const hit = hitAlert(y, manualLines());
      if (hit !== null) {
        drag = { drawnId: hit, pointerId: event.pointerId, y };
        chart.applyOptions(SCROLL_OFF);
        element.setPointerCapture?.(event.pointerId);
        setBell(null);
        setGhost(y);
        return;
      }
      if (event.pointerType === "touch") {
        cancelPress();
        const timer = setTimeout(() => {
          press = null;
          create(y);
        }, LONG_PRESS_MS);
        press = { pointerId: event.pointerId, x, y, timer };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const { x, y } = local(event);
      if (drag && event.pointerId === drag.pointerId) {
        drag.y = y;
        setGhost(y);
      } else if (!drag) {
        const all = bells(false);
        const hit = hitBell({ x, y }, all);
        const line = all.find((b) => b.id === hit);
        setHovered((current) =>
          !line || line.y === null
            ? null
            : current?.drawnId === line.id && current.y === line.y
              ? current
              : { drawnId: line.id, y: line.y },
        );
      }
      if (press && Math.hypot(x - press.x, y - press.y) > LONG_PRESS_SLOP_PX) cancelPress();
    };
    const onPointerUp = () => {
      cancelPress();
      endDrag(true);
    };
    const onPointerCancel = () => {
      cancelPress();
      endDrag(false);
    };
    /**
     * Seule la capture de l'élément compte : au doigt, la toile intérieure tient une capture
     * implicite que `setPointerCapture(element)` lui retire, et sa perte remonte jusqu'ici.
     */
    const onLostCapture = (event: PointerEvent) => {
      if (event.target !== element) return;
      onPointerCancel();
    };
    const onLeave = (event: PointerEvent) => {
      const to = event.relatedTarget;
      if (to instanceof Node && root.current?.contains(to)) return;
      setBell(null);
      setHovered(null);
    };
    /** Un clic sur la pastille d'une manuelle, dans le panneau, ouvre son réglage. */
    const onBellClick = (event: MouseEvent) => {
      const { x, y } = local(event);
      const manual = bells(true);
      const hit = hitBell({ x, y }, manual);
      const line = manual.find((b) => b.id === hit);
      if (!line || line.y === null) return;
      openEditor(line.id, line.y);
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
    element.addEventListener("lostpointercapture", onLostCapture);
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("click", onBellClick);
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.unsubscribeClick(onClick);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
      element.removeEventListener("lostpointercapture", onLostCapture);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("click", onBellClick);
      cancelPress();
      // Un graphe démonté en plein geste : s'il vit encore (seul le calque part), il défile à nouveau.
      if (drag) {
        try {
          chart.applyOptions(SCROLL_ON);
        } catch {
          // Graphe déjà détruit : plus rien à rétablir.
        }
      }
    };
  }, [chart, series, openEditor]);

  const paneWidth = chart.timeScale().width();
  const bellLeft = paneWidth - ALERT_BELL_INSET_PX - ALERT_BELL_SIZE_PX / 2;
  const hoveredAlert = hovered === null ? undefined : props.alerts.find((a) => a.id === hovered.drawnId);
  const bellPrice = bell === null ? null : priceAtY(bell, (v) => series.coordinateToPrice(v) as number | null);

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10">
      {bell !== null && bellPrice !== null && (
        <button
          type="button"
          data-testid="alert-create"
          aria-label={t("charts.alert.create", { price: formatPrice(bellPrice) })}
          title={t("charts.alert.createHint")}
          className="pointer-events-auto absolute flex size-5 items-center justify-center rounded-sm border border-warning bg-background text-warning"
          style={{ left: paneWidth, top: bell - BELL_HALF_PX }}
          onPointerLeave={(event) => {
            const to = event.relatedTarget;
            if (!(to instanceof Node && chart.chartElement().contains(to))) setBell(null);
          }}
          onClick={() => props.onCreateAlert(bellPrice)}
        >
          <Bell aria-hidden className="size-2.5" />
          <Plus aria-hidden className="-ml-0.5 size-2" />
        </button>
      )}
      {hovered !== null && hoveredAlert && (
        <span
          data-testid="alert-bell"
          title={t("alerts.bell", {
            arrow: hoveredAlert.direction === "above" ? "↑" : "↓",
            price: formatLocalePrice(hoveredAlert.price, i18n.language),
          })}
          className={`pointer-events-auto absolute rounded-full ${hoveredAlert.kind === "manual" ? "cursor-pointer" : ""}`}
          style={{ left: bellLeft, top: hovered.y - ALERT_BELL_SIZE_PX / 2, width: ALERT_BELL_SIZE_PX, height: ALERT_BELL_SIZE_PX }}
          onPointerLeave={(event) => {
            const to = event.relatedTarget;
            if (!(to instanceof Node && chart.chartElement().contains(to))) setHovered(null);
          }}
          onClick={() => openEditor(hovered.drawnId, hovered.y)}
        />
      )}
      {ghost !== null && (
        <div
          data-testid="alert-ghost"
          aria-hidden
          className="absolute left-0 border-t border-dashed border-warning"
          style={{ top: ghost, width: paneWidth }}
        />
      )}
      <Popover open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <PopoverTrigger
          nativeButton={false}
          render={
            <span
              aria-hidden
              className="absolute"
              style={{
                left: bellLeft,
                top: (editing?.y ?? 0) - ALERT_BELL_SIZE_PX / 2,
                width: ALERT_BELL_SIZE_PX,
                height: ALERT_BELL_SIZE_PX,
              }}
            />
          }
        />
        <PopoverContent side="left" className="pointer-events-auto w-60">
          {editing !== null && (
            <AlertEditor
              key={editing.id}
              editing={editing}
              note={props.noteOf(editing.id)}
              onSave={(patch) => {
                props.onEditAlert(editing.id, patch);
                setEditing(null);
              }}
              onDelete={() => {
                props.onDeleteAlert(editing.id);
                setEditing(null);
              }}
              onReactivate={() => {
                props.onReactivateAlert(editing.id);
                setEditing(null);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AlertEditor({
  editing,
  note,
  onSave,
  onDelete,
  onReactivate,
}: {
  editing: Editing;
  note: string | null;
  onSave: (patch: { price: number; note: string | null }) => void;
  onDelete: () => void;
  onReactivate: () => void;
}) {
  const { t } = useTranslation();
  const [priceText, setPriceText] = useState(String(editing.price));
  const [noteText, setNoteText] = useState(note ?? "");
  const parsed = Number.parseFloat(priceText.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSave({ price: roundToCent(parsed), note: noteText.trim() === "" ? null : noteText.trim() });
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("charts.alert.price")}
        <Input
          inputMode="decimal"
          value={priceText}
          aria-invalid={!valid}
          className="font-mono tabular-nums"
          onChange={(event) => setPriceText(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("charts.alert.note")}
        <Input value={noteText} onChange={(event) => setNoteText(event.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
          {t("charts.alert.delete")}
        </Button>
        <div className="flex gap-2">
          {editing.status !== "active" && (
            <Button type="button" size="sm" variant="outline" onClick={onReactivate}>
              {t("alerts.actions.reactivate")}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!valid}>
            {t("charts.alert.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
