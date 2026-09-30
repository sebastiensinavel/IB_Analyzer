import type { ContractKey } from "@ib/ledger";

export type AlertKind = "manual" | "wheel" | "condor";
export type AlertDirection = "above" | "below";
export interface AlertThreshold { price: number; direction: AlertDirection }
export type AnchorSource = "live" | "vwap" | "close";
/** S₀ observé, jamais recalculé. `observedAt` : instant vrai UTC. */
export interface AlertAnchor { price: number; source: AnchorSource; observedAt: string }

/** L'état stocké d'une alerte ; une alerte sans état vaut `INITIAL_STATE`. */
export interface AlertState {
  alertId: string;
  triggeredAt: string | null;
  acknowledgedAt: string | null;
  /** Manuelle acquittée (usage unique). */
  disabled: boolean;
  /** Automatique : faux entre « Vu » et le retour du cours du bon côté. */
  armed: boolean;
  anchor: AlertAnchor | null;
  /** Fraction Wheel ou marge Condor propre à cette alerte. */
  override: number | null;
}
export const INITIAL_STATE: Omit<AlertState, "alertId"> = {
  triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null,
};

export interface ManualAlertDef { id: string; ticker: string; price: number; direction: AlertDirection; note: string | null; createdAt: string }
export interface AlertMargins { wheel: number; condor: number }

interface AlertBase { id: string; ticker: string; currency: string; /** `null` : pas encore de seuil (S₀ manquant). */ thresholds: AlertThreshold[] | null }
export interface ManualAlert extends AlertBase { kind: "manual"; note: string | null; createdAt: string }
export interface WheelAlert extends AlertBase {
  kind: "wheel"; contract: ContractKey; strike: number; expiry: string | null; quantity: number;
  averageAssignmentPrice: number; saleWhen: string; fraction: number; anchor: AlertAnchor | null;
}
export interface CondorAlert extends AlertBase {
  kind: "condor"; strikes: [number, number, number, number]; expiry: string | null; quantity: number; margin: number; offset: number;
}
export type AutoAlert = WheelAlert | CondorAlert;
export type Alert = ManualAlert | AutoAlert;
export type AlertStatus = "triggered" | "active" | "disabled";
