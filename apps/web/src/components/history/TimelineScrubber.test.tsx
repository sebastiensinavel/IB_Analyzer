import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineScrubber, type TimelineScrubberProps } from "@/components/history/TimelineScrubber";
import { buildTimeline } from "@/lib/historyTimeline";

// Newest first, as the history table shows its rows. Months: 2026-03 (rows 0-1), 2026-02 (2),
// 2025-11 (3-4), 2025-02 (5), 2024-12 (6).
const WHENS = [
  "2026-03-31T23:30:00.000Z",
  "2026-03-02T10:00:00.000Z",
  "2026-02-15T10:00:00.000Z",
  "2025-11-20T10:00:00.000Z",
  "2025-11-03T10:00:00.000Z",
  "2025-02-10T10:00:00.000Z",
  "2024-12-01T10:00:00.000Z",
];

function renderScrubber(overrides: Partial<TimelineScrubberProps> = {}) {
  const props: TimelineScrubberProps = {
    timeline: buildTimeline(WHENS),
    total: WHENS.length,
    firstVisible: 0,
    visibleCount: 2,
    height: 700,
    scrolling: false,
    onSeek: vi.fn(),
    ...overrides,
  };
  const view = render(<TimelineScrubber {...props} />);
  return { props, view, slider: screen.getByRole("slider", { name: "Frise chronologique" }) };
}

// jsdom lays nothing out: the track is given a 700 px box starting 100 px down the page.
function layTrack(slider: HTMLElement) {
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
    top: 100, bottom: 800, height: 700, left: 0, right: 48, width: 48, x: 0, y: 100, toJSON: () => ({}),
  } as DOMRect);
}

// The shared `@/i18n` singleton defaults to French.
describe("TimelineScrubber", () => {
  it("says which month is at the top of the table", () => {
    const { props, view, slider } = renderScrubber({ firstVisible: 1 });
    expect(slider).toHaveAttribute("aria-valuetext", "mars 2026");
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "6");
    view.rerender(<TimelineScrubber {...props} firstVisible={5} />);
    expect(slider).toHaveAttribute("aria-valuetext", "février 2025");
  });

  it("writes the years along the track", () => {
    renderScrubber();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("steps through months and years from the keyboard", () => {
    const onSeek = vi.fn();
    const { slider } = renderScrubber({ firstVisible: 1, onSeek });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onSeek).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(onSeek).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    onSeek.mockClear();
    fireEvent.keyDown(slider, { key: "a" });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("seeks the row under the pointer, and follows it while dragging only", () => {
    const onSeek = vi.fn();
    const { slider } = renderScrubber({ onSeek });
    layTrack(slider);
    // 625 px is 75 % down a track from 100 to 800: row ⌊0.75 × 7⌋ = 5, in February 2025.
    fireEvent.pointerDown(slider, { clientY: 625, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(5);
    expect(screen.getByText("février 2025")).toBeInTheDocument();
    fireEvent.pointerMove(slider, { clientY: 100, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(slider, { pointerId: 1 });
    onSeek.mockClear();
    fireEvent.pointerMove(slider, { clientY: 625, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("ignores a right-click", () => {
    const onSeek = vi.fn();
    const { slider } = renderScrubber({ onSeek });
    layTrack(slider);
    fireEvent.pointerDown(slider, { clientY: 625, pointerId: 1, button: 2 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("shows a hover label from a pointer move alone, and hides it on leave", () => {
    const onSeek = vi.fn();
    const { slider } = renderScrubber({ onSeek });
    layTrack(slider);
    fireEvent.pointerMove(slider, { clientY: 625, pointerId: 1 });
    expect(screen.getByText("février 2025")).toBeInTheDocument();
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.pointerLeave(slider, { pointerId: 1 });
    expect(screen.queryByText("février 2025")).not.toBeInTheDocument();
  });

  it("shows the floating month while the table scrolls, and hides it at rest", () => {
    const { props, view } = renderScrubber({ firstVisible: 3 });
    expect(screen.queryByText("novembre 2025")).not.toBeInTheDocument();
    view.rerender(<TimelineScrubber {...props} scrolling />);
    expect(screen.getByText("novembre 2025")).toBeInTheDocument();
  });
});
