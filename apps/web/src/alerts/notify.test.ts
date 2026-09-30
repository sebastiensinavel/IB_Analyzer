import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Alert } from "@ib/alerts";
import i18n from "@/i18n";
import { DEMO_FLAG } from "@/demo/mode";
import { notificationPermission, notifyTriggered } from "./notify";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static created: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  title: string;
  options: NotificationOptions;
  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    FakeNotification.created.push(this);
  }
}

const MANUAL: Alert = { id: "manual:1", kind: "manual", ticker: "AAPL", currency: "USD", thresholds: [{ price: 245, direction: "below" }], note: "Support", createdAt: "" };
const WHEEL: Alert = {
  id: "wheel:x", kind: "wheel", ticker: "ZXAB", currency: "USD", contract: { symbol: "ZXAB", secType: "OPT", right: "C", strike: 40, expiry: "2026-10-16", multiplier: 100, currency: "USD" } as never,
  strike: 40, expiry: "2026-10-16", quantity: -1, averageAssignmentPrice: 45, saleWhen: "", fraction: 0.7, anchor: null,
  thresholds: [{ price: 38.2, direction: "above" }],
};
const CONDOR: Alert = {
  id: "condor:1", kind: "condor", ticker: "SPY", currency: "USD", strikes: [740, 750, 790, 800], expiry: null, quantity: 1, margin: 0.15, offset: 6,
  thresholds: [{ price: 756, direction: "below" }, { price: 784, direction: "above" }],
};

const t = i18n.getFixedT("fr");

beforeEach(() => {
  FakeNotification.permission = "granted";
  FakeNotification.created = [];
  vi.stubGlobal("Notification", FakeNotification);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("notifyTriggered", () => {
  it("sends one notification titled by the ticker, the direction and the threshold, the body by the kind", () => {
    notifyTriggered(WHEEL, () => {}, t, "fr");
    notifyTriggered(CONDOR, () => {}, t, "fr");
    notifyTriggered(CONDOR, () => {}, t, "fr", 790);
    notifyTriggered(MANUAL, () => {}, t, "fr");
    expect(FakeNotification.created.map((n) => [n.title, n.options.body])).toEqual([
      ["ZXAB ↑ 38,20", "Wheel — call 40"],
      ["SPY ↓ 756,00", "Condor 750/790"],
      ["SPY ↑ 784,00", "Condor 750/790"],
      ["AAPL ↓ 245,00", "Support"],
    ]);
  });

  it("writes the threshold with the separators of the language", () => {
    notifyTriggered({ ...MANUAL, thresholds: [{ price: 1245.5, direction: "below" }] }, () => {}, i18n.getFixedT("en"), "en");
    expect(FakeNotification.created.map((n) => n.title)).toEqual(["AAPL ↓ 1,245.50"]);
  });

  it("focuses the tab and opens the alerts on a click", () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const onOpen = vi.fn();
    notifyTriggered(MANUAL, onOpen, t, "fr");
    FakeNotification.created[0].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("sends nothing when the permission is denied", () => {
    FakeNotification.permission = "denied";
    notifyTriggered(MANUAL, () => {}, t, "fr");
    expect(FakeNotification.created).toHaveLength(0);
  });

  it("sends nothing in the demonstration", () => {
    window.sessionStorage.setItem(DEMO_FLAG, "1");
    notifyTriggered(MANUAL, () => {}, t, "fr");
    expect(FakeNotification.created).toHaveLength(0);
  });

  it("sends nothing, and never throws, without the API", () => {
    vi.stubGlobal("Notification", undefined);
    expect(() => notifyTriggered(MANUAL, () => {}, t, "fr")).not.toThrow();
    expect(notificationPermission()).toBe("unsupported");
  });
});
