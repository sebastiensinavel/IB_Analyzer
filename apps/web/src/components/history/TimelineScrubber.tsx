import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatMonth } from "@/lib/format";
import {
  monthIndexAt,
  rowAtFraction,
  stepTarget,
  yearMarks,
  type TimelineMonth,
  type TimelineStep,
} from "@/lib/historyTimeline";

/** A year label closer than this to the one above it is left out rather than overlapped. */
const YEAR_LABEL_MIN_GAP_PX = 16;

const KEY_STEPS: Partial<Record<string, TimelineStep>> = {
  ArrowDown: "nextMonth",
  ArrowUp: "previousMonth",
  PageDown: "nextYear",
  PageUp: "previousYear",
  Home: "first",
  End: "last",
};

export interface TimelineScrubberProps {
  timeline: readonly TimelineMonth[];
  /** Number of rows in the table. */
  total: number;
  /** Index of the first row in view. */
  firstVisible: number;
  visibleCount: number;
  /** Height of the track in px: the scroll container's own. */
  height: number;
  /** The table is scrolling, or stopped less than SCRUB_LABEL_LINGER_MS ago. */
  scrolling: boolean;
  /** Brings this row to the top of the table. */
  onSeek(rowIndex: number): void;
}

/** A row index as a CSS share of the track: the bar's single coordinate. */
function share(rowIndex: number, total: number): string {
  return `${(rowIndex / Math.max(1, total)) * 100}%`;
}

/**
 * The timeline along the history table: years written at their first month, a tick per month,
 * the rows in view as a block. Pointer and keyboard both end in `onSeek`; the table scrolls and
 * hands the new first row back through `firstVisible`.
 */
export function TimelineScrubber({ timeline, total, firstVisible, visibleCount, height, scrolling, onSeek }: TimelineScrubberProps) {
  const { t, i18n } = useTranslation();
  const [pointerRow, setPointerRow] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const monthOf = (rowIndex: number) => {
    const month = timeline[monthIndexAt(timeline, rowIndex)];
    return month ? formatMonth(month.month, i18n.language) : "";
  };

  const rowAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return rowAtFraction(total, rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    onSeek(stepTarget(timeline, total, firstVisible, step));
  };

  const labelRow = pointerRow ?? firstVisible;
  const showLabel = dragging || pointerRow !== null || scrolling;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("history.timeline")}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, total - 1)}
      aria-valuenow={firstVisible}
      aria-valuetext={monthOf(firstVisible)}
      className="relative w-12 shrink-0 cursor-ns-resize touch-none rounded-md outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        // Only the primary button seeks: a right-click should just open its context menu.
        if (event.button !== 0) return;
        // jsdom has no pointer capture; a browser keeps sending moves here once the pointer leaves.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
        const row = rowAt(event);
        setPointerRow(row);
        onSeek(row);
      }}
      onPointerMove={(event) => {
        const row = rowAt(event);
        setPointerRow(row);
        if (dragging) onSeek(row);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => {
        if (!dragging) setPointerRow(null);
      }}
    >
      {timeline.map((month) => (
        <span
          key={`${month.month}-${month.start}`}
          aria-hidden="true"
          className="absolute right-1 h-px w-1.5 bg-border"
          style={{ top: share(month.start, total) }}
        />
      ))}
      {yearMarks(timeline, total, height, YEAR_LABEL_MIN_GAP_PX).map((mark) => (
        <span
          key={`${mark.year}-${mark.start}`}
          aria-hidden="true"
          className="absolute left-0.5 font-mono text-[0.65rem] leading-none text-muted-foreground"
          style={{ top: share(mark.start, total) }}
        >
          {mark.year}
        </span>
      ))}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 min-h-1 rounded-sm bg-primary/15 ring-1 ring-primary/40"
        style={{ top: share(firstVisible, total), height: share(Math.min(visibleCount, total - firstVisible), total) }}
      />
      {showLabel && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-full z-20 mr-2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10"
          style={{ top: `min(${share(labelRow, total)}, calc(100% - 1.75rem))` }}
        >
          {monthOf(labelRow)}
        </span>
      )}
    </div>
  );
}
