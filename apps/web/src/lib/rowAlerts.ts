/**
 * La cloche des lignes de positions (suite du sous-projet 42) : quelles alertes **déclenchées**
 * concernent une ligne. Une manuelle, toute ligne de son ticker ; une Wheel, la ligne de son call
 * vendu ; un condor, sa ligne sur la page Condors et, ailleurs, les lignes de ses jambes. Les
 * contrats se comparent par `contractId`, la clé qui apparie déjà journal et snapshot.
 */
import type { AnalyzedPosition } from "@ib/coverage";
import { contractId, tickerOf, type ContractKey } from "@ib/ledger";
import type { AlertView } from "@/alerts/useAlertEngine";

export interface RowAlertTarget {
  /** Le sous-jacent pour une option. */
  ticker: string;
  /** Le contrat de la ligne ; absent pour une ligne qui n'en nomme aucun (une suggestion). */
  contract?: ContractKey | null;
  /** L'id de la ligne composite du journal, sur la ligne d'un condor seulement. */
  condorId?: string;
}

export function rowAlertMarks(views: readonly AlertView[], target: RowAlertTarget): AlertView[] {
  const ticker = target.ticker.toUpperCase();
  const id = target.contract ? contractId(target.contract) : null;
  return views.filter(({ alert, status }) => {
    if (status !== "triggered") return false;
    switch (alert.kind) {
      case "manual":
        return alert.ticker.toUpperCase() === ticker;
      case "wheel":
        return id !== null && contractId(alert.contract) === id;
      case "condor":
        if (target.condorId !== undefined) return alert.id === `condor:${target.condorId}`;
        return id !== null && alert.legs.some((leg) => contractId(leg) === id);
    }
  });
}

/** La clé de contrat d'une position analysée, dont le strike absent vaut 0 et l'échéance absente "". */
export function analyzedContract(position: AnalyzedPosition): ContractKey {
  return {
    ticker: tickerOf(position.symbol),
    secType: position.secType,
    right: position.right as ContractKey["right"],
    strike: position.strike === 0 ? null : position.strike,
    expiry: position.expiry === "" ? null : position.expiry,
    currency: position.currency,
  };
}
