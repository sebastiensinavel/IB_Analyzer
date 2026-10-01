import { describe, expect, it } from "vitest";
import type { Alert, AlertStatus } from "@ib/alerts";
import type { AnalyzedPosition } from "@ib/coverage";
import type { ContractKey } from "@ib/ledger";
import type { AlertView } from "@/alerts/useAlertEngine";
import { analyzedContract, rowAlertMarks } from "@/lib/rowAlerts";

const STATE = { alertId: "", triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null };

function view(alert: Partial<Alert> & { id: string; kind: Alert["kind"]; ticker: string }, status: AlertStatus = "triggered"): AlertView {
  const base = { currency: "USD", thresholds: [{ price: 10, direction: "above" }], ...alert };
  return { alert: base as unknown as Alert, state: { ...STATE, alertId: alert.id }, status, price: null, distance: null };
}

const option = (ticker: string, right: "C" | "P", strike: number, expiry = "2026-10-16"): ContractKey => ({
  ticker, secType: "OPT", right, strike, expiry, currency: "USD",
});
const stock = (ticker: string): ContractKey => ({ ticker, secType: "STK", right: "", strike: null, expiry: null, currency: "USD" });
const ids = (views: AlertView[]) => views.map((v) => v.alert.id);

describe("rowAlertMarks", () => {
  it("une manuelle déclenchée marque l'action et toute option du ticker, comparé en majuscules, pas un autre ticker", () => {
    const views = [view({ id: "m", kind: "manual", ticker: "NVDA" })];
    expect(ids(rowAlertMarks(views, { ticker: "nvda", contract: stock("NVDA") }))).toEqual(["m"]);
    expect(ids(rowAlertMarks(views, { ticker: "NVDA", contract: option("NVDA", "P", 150) }))).toEqual(["m"]);
    expect(ids(rowAlertMarks(views, { ticker: "NVDA" }))).toEqual(["m"]);
    expect(rowAlertMarks(views, { ticker: "AAPL", contract: stock("AAPL") })).toEqual([]);
  });

  it("une alerte active ou désactivée ne marque rien", () => {
    const views = [view({ id: "a", kind: "manual", ticker: "NVDA" }, "active"), view({ id: "d", kind: "manual", ticker: "NVDA" }, "disabled")];
    expect(rowAlertMarks(views, { ticker: "NVDA", contract: stock("NVDA") })).toEqual([]);
  });

  it("une alerte Wheel ne marque que la ligne du call de même contrat", () => {
    const call = option("ABC", "C", 40);
    const views = [view({ id: "wheel:1", kind: "wheel", ticker: "ABC", contract: call } as Partial<Alert> & { id: string; kind: "wheel"; ticker: string })];
    expect(ids(rowAlertMarks(views, { ticker: "ABC", contract: option("ABC", "C", 40) }))).toEqual(["wheel:1"]);
    expect(rowAlertMarks(views, { ticker: "ABC", contract: option("ABC", "C", 45) })).toEqual([]);
    expect(rowAlertMarks(views, { ticker: "ABC", contract: stock("ABC") })).toEqual([]);
    expect(rowAlertMarks(views, { ticker: "ABC" })).toEqual([]);
  });

  it("une alerte Condors marque la ligne du condor par son id, et ailleurs les lignes de ses jambes seulement", () => {
    const legs = [option("XSP", "P", 740), option("XSP", "P", 750), option("XSP", "C", 790), option("XSP", "C", 800)];
    const views = [view({ id: "condor:k1", kind: "condor", ticker: "XSP", legs } as Partial<Alert> & { id: string; kind: "condor"; ticker: string })];
    expect(ids(rowAlertMarks(views, { ticker: "XSP", condorId: "k1" }))).toEqual(["condor:k1"]);
    expect(rowAlertMarks(views, { ticker: "XSP", condorId: "k2" })).toEqual([]);
    expect(ids(rowAlertMarks(views, { ticker: "XSP", contract: option("XSP", "C", 790) }))).toEqual(["condor:k1"]);
    expect(rowAlertMarks(views, { ticker: "XSP", contract: option("XSP", "C", 795) })).toEqual([]);
    expect(rowAlertMarks(views, { ticker: "XSP", contract: option("XSP", "C", 790, "2026-11-20") })).toEqual([]);
  });
});

describe("analyzedContract", () => {
  it("rend la clé de contrat d'une position analysée : strike 0 et échéance vide valent null", () => {
    const base = { symbol: "NVDA", secType: "STK", right: "", strike: 0, expiry: "", currency: "USD" } as AnalyzedPosition;
    expect(analyzedContract(base)).toEqual(stock("NVDA"));
    expect(analyzedContract({ ...base, secType: "OPT", right: "P", strike: 150, expiry: "2026-10-16" })).toEqual(option("NVDA", "P", 150));
  });
});
