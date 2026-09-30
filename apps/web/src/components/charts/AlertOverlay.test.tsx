import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";
import i18n from "@/i18n";
import { AlertOverlay, type AlertEditHandlers } from "@/components/charts/AlertOverlay";
import type { DrawnAlertInput } from "@/lib/alertsPrimitive";

const PANE_WIDTH = 500;
const SCALE_WIDTH = 60;

/**
 * Un faux graphe : l'élément reçoit les événements du pointeur comme celui de Lightweight Charts,
 * les abonnements sont gardés pour être déclenchés à la main. L'échelle est linéaire :
 * y = 300 − prix, si bien qu'une ligne à 240 est à y = 60.
 */
function fakeChart() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const handlers: { move?: (p: MouseEventParams<Time>) => void; click?: (p: MouseEventParams<Time>) => void } = {};
  const chart = {
    chartElement: () => element,
    subscribeCrosshairMove: vi.fn((h) => (handlers.move = h)),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn((h) => (handlers.click = h)),
    unsubscribeClick: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: () => ({ width: () => PANE_WIDTH }),
    priceScale: () => ({ width: () => SCALE_WIDTH }),
  };
  const series = {
    coordinateToPrice: vi.fn((y: number) => 300 - y),
    priceToCoordinate: vi.fn((price: number) => 300 - price),
  };
  return {
    element,
    handlers,
    chart: chart as unknown as IChartApi,
    applyOptions: chart.applyOptions,
    series: series as unknown as ISeriesApi<"Candlestick">,
    seriesMock: series,
  };
}

function handlers(): AlertEditHandlers & { [K in keyof AlertEditHandlers]: ReturnType<typeof vi.fn> } {
  return {
    onCreateAlert: vi.fn(),
    onMoveAlert: vi.fn(),
    onEditAlert: vi.fn(),
    onDeleteAlert: vi.fn(),
    onReactivateAlert: vi.fn(),
    noteOf: vi.fn(() => "support"),
  } as never;
}

const MANUAL: DrawnAlertInput = { id: "manual:a#0", kind: "manual", price: 240, status: "active" };
const WHEEL: DrawnAlertInput = { id: "wheel:c#0", kind: "wheel", price: 240, status: "active" };

function setup(alerts: readonly DrawnAlertInput[] = []) {
  const fake = fakeChart();
  const h = handlers();
  render(
    <I18nextProvider i18n={i18n}>
      <AlertOverlay chart={fake.chart} series={fake.series} alerts={alerts} {...h} />
    </I18nextProvider>,
  );
  return { ...fake, h };
}

const move = (fake: ReturnType<typeof fakeChart>, point?: { x: number; y: number }) =>
  act(() => fake.handlers.move!({ point, time: undefined, seriesData: new Map() } as unknown as MouseEventParams<Time>));

beforeEach(async () => {
  await i18n.changeLanguage("fr");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("AlertOverlay : poser", () => {
  it("montre la cloche à la hauteur du réticule, sur l'axe des prix ; un clic pose l'alerte au cent", () => {
    const fake = setup();
    fake.seriesMock.coordinateToPrice.mockReturnValue(245.3049);
    expect(screen.queryByTestId("alert-create")).toBeNull();

    move(fake, { x: 100, y: 54.7 });
    const button = screen.getByTestId("alert-create");
    expect(button.style.left).toBe(`${PANE_WIDTH}px`);
    fireEvent.click(button);

    expect(fake.h.onCreateAlert).toHaveBeenCalledWith(245.3);
  });

  it("cache la cloche quand le pointeur quitte le graphe", () => {
    const fake = setup();
    move(fake, { x: 100, y: 50 });
    fireEvent.pointerLeave(fake.element, { relatedTarget: document.body });
    expect(screen.queryByTestId("alert-create")).toBeNull();
  });

  it("garde la cloche quand le pointeur passe du graphe au bouton", () => {
    const fake = setup();
    move(fake, { x: 100, y: 50 });
    move(fake, undefined);
    fireEvent.pointerLeave(fake.element, { relatedTarget: screen.getByTestId("alert-create") });
    expect(screen.getByTestId("alert-create")).toBeTruthy();
  });

  it("cache la cloche sur l'étiquette d'une manuelle : le clic y ouvre le réglage", () => {
    const fake = setup([MANUAL]);
    move(fake, { x: 100, y: 62 });
    expect(screen.queryByTestId("alert-create")).toBeNull();
  });

  it("Alt+clic pose l'alerte au prix du point ; un clic simple ne pose rien", () => {
    const fake = setup();
    fake.seriesMock.coordinateToPrice.mockReturnValue(245.3049);
    act(() => fake.handlers.click!({ point: { x: 10, y: 50 }, sourceEvent: { altKey: false } } as never));
    expect(fake.h.onCreateAlert).not.toHaveBeenCalled();

    act(() => fake.handlers.click!({ point: { x: 10, y: 50 }, sourceEvent: { altKey: true } } as never));
    expect(fake.h.onCreateAlert).toHaveBeenCalledWith(245.3);
  });

  it("un appui long au doigt pose l'alerte ; un appui court non", () => {
    vi.useFakeTimers();
    const fake = setup();
    fireEvent.pointerDown(fake.element, { pointerId: 3, pointerType: "touch", clientX: 100, clientY: 55 });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.pointerUp(fake.element, { pointerId: 3, pointerType: "touch", clientX: 100, clientY: 55 });
    act(() => vi.advanceTimersByTime(500));
    expect(fake.h.onCreateAlert).not.toHaveBeenCalled();

    fireEvent.pointerDown(fake.element, { pointerId: 4, pointerType: "touch", clientX: 100, clientY: 55 });
    act(() => vi.advanceTimersByTime(500));
    expect(fake.h.onCreateAlert).toHaveBeenCalledWith(245);
  });
});

describe("AlertOverlay : glisser", () => {
  it("suspend le défilement, suit le pointeur, écrit au relâchement et rétablit", () => {
    const fake = setup([MANUAL]);
    fireEvent.pointerDown(fake.element, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 62 });
    expect(fake.applyOptions).toHaveBeenLastCalledWith({ handleScroll: false, handleScale: false });

    fireEvent.pointerMove(fake.element, { pointerId: 1, clientX: 100, clientY: 80 });
    expect(screen.getByTestId("alert-ghost").style.top).toBe("80px");
    fireEvent.pointerUp(fake.element, { pointerId: 1, clientX: 100, clientY: 80 });

    expect(fake.h.onMoveAlert).toHaveBeenCalledWith("manual:a", 220);
    expect(fake.applyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true });
    expect(screen.queryByTestId("alert-ghost")).toBeNull();
  });

  it("ne montre pas la cloche pendant le glisser", () => {
    const fake = setup([MANUAL]);
    fireEvent.pointerDown(fake.element, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 60 });
    move(fake, { x: 100, y: 120 });
    expect(screen.queryByTestId("alert-create")).toBeNull();
  });

  it("un pointercancel rétablit le défilement sans rien écrire", () => {
    const fake = setup([MANUAL]);
    fireEvent.pointerDown(fake.element, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(fake.element, { pointerId: 1, clientX: 100, clientY: 80 });
    fireEvent.pointerCancel(fake.element, { pointerId: 1 });

    expect(fake.applyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true });
    expect(fake.h.onMoveAlert).not.toHaveBeenCalled();
  });

  it("une capture perdue rétablit aussi le défilement", () => {
    const fake = setup([MANUAL]);
    fireEvent.pointerDown(fake.element, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 60 });
    fireEvent(fake.element, new Event("lostpointercapture"));

    expect(fake.applyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true });
  });

  it("ignore la capture implicite qu'un enfant perd au doigt : le glisser continue", () => {
    const fake = setup([MANUAL]);
    const canvas = document.createElement("canvas");
    fake.element.appendChild(canvas);
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "touch", button: 0, clientX: 100, clientY: 62 });
    // La toile relâche sa capture implicite quand l'élément prend la sienne : l'événement remonte.
    fireEvent(canvas, new Event("lostpointercapture", { bubbles: true }));
    expect(fake.applyOptions).toHaveBeenLastCalledWith({ handleScroll: false, handleScale: false });

    fireEvent.pointerMove(fake.element, { pointerId: 1, clientX: 100, clientY: 80 });
    expect(screen.getByTestId("alert-ghost").style.top).toBe("80px");
    fireEvent.pointerUp(fake.element, { pointerId: 1, clientX: 100, clientY: 80 });
    expect(fake.h.onMoveAlert).toHaveBeenCalledWith("manual:a", 220);
  });

  it("ne glisse ni une automatique, ni une manuelle à plus de 4 px", () => {
    const wheel = setup([WHEEL]);
    fireEvent.pointerDown(wheel.element, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 60 });
    expect(wheel.applyOptions).not.toHaveBeenCalled();

    const manual = setup([MANUAL]);
    fireEvent.pointerDown(manual.element, { pointerId: 2, pointerType: "mouse", button: 0, clientX: 100, clientY: 65 });
    expect(manual.applyOptions).not.toHaveBeenCalled();
  });
});

describe("AlertOverlay : régler", () => {
  function openEditor(alerts: readonly DrawnAlertInput[] = [MANUAL]) {
    const fake = setup(alerts);
    fireEvent.click(fake.element, { clientX: PANE_WIDTH + 20, clientY: 63 });
    return fake;
  }

  it("un clic sur l'étiquette d'une manuelle ouvre le réglage : prix, note, supprimer", async () => {
    const fake = openEditor();
    const price = await screen.findByLabelText("Seuil");
    expect((price as HTMLInputElement).value).toBe("240");
    expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("support");
    expect(screen.queryByRole("button", { name: "Réactiver" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(fake.h.onDeleteAlert).toHaveBeenCalledWith("manual:a");
  });

  it("enregistre le prix au cent et la note, vide rendue à null", async () => {
    const fake = openEditor();
    fireEvent.change(await screen.findByLabelText("Seuil"), { target: { value: "241.456" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(fake.h.onEditAlert).toHaveBeenCalledWith("manual:a", { price: 241.46, note: null });
  });

  it("propose Réactiver sur une manuelle déclenchée", async () => {
    const fake = openEditor([{ ...MANUAL, status: "triggered" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Réactiver" }));
    expect(fake.h.onReactivateAlert).toHaveBeenCalledWith("manual:a");
  });

  it("n'ouvre rien sur l'étiquette d'une automatique", () => {
    openEditor([WHEEL]);
    expect(screen.queryByLabelText("Seuil")).toBeNull();
  });
});
