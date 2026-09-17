import type { OpenPosition } from "./book.ts";
import { contractId, contractOf, formatContractLabel } from "./contract.ts";
import type { JournalSnapshot, Reconciliation, ReconciliationDifference } from "./types.ts";

/**
 * The lots open at the snapshot's boundary against its positions, in
 * quantity only (spec §4). Prices are never compared: the ledger has no
 * mark, and a cost basis is not what this check is about.
 */
export function reconcile(atBoundary: Map<string, OpenPosition>, snapshot: JournalSnapshot): Reconciliation {
  const expected = new Map<string, OpenPosition>();
  for (const position of snapshot.positions) {
    if (position.secType !== "STK" && position.secType !== "OPT") continue;
    const contract = contractOf(position);
    const id = contractId(contract);
    const current = expected.get(id);
    if (current) current.quantity += position.quantity;
    else expected.set(id, { contract, quantity: position.quantity });
  }
  const differences: ReconciliationDifference[] = [];
  for (const id of new Set([...atBoundary.keys(), ...expected.keys()])) {
    const ledgerQty = atBoundary.get(id)?.quantity ?? 0;
    const snapshotQty = expected.get(id)?.quantity ?? 0;
    if (ledgerQty === snapshotQty) continue;
    const contract = (atBoundary.get(id) ?? expected.get(id))!.contract;
    differences.push({ contract, label: formatContractLabel(contract), ledgerQty, snapshotQty });
  }
  differences.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { asOf: snapshot.asOf, differences, orphans: [] };
}
