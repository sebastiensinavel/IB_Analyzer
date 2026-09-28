import { sumByCurrency, type CurrencyTotal, type Position } from "@ib/ledger";

/**
 * What the account is worth, by currency: the snapshot's market values plus the current cash (§2.4).
 * `cash` is `undefined` while it is not known yet: each currency of the positions then counts its
 * cash as missing, so the value never looks final before it is.
 */
export function liquidationValue(
  positions: readonly Pick<Position, "currency" | "marketValue">[],
  cash: Readonly<Record<string, number | null>> | undefined,
): CurrencyTotal[] {
  type Part = { currency: string; value: number | null };
  const cashParts: Part[] = cash
    ? Object.entries(cash).map(([currency, value]) => ({ currency, value }))
    : [...new Set(positions.map((p) => p.currency))].map((currency) => ({ currency, value: null }));
  const parts: Part[] = [...positions.map((p) => ({ currency: p.currency, value: p.marketValue })), ...cashParts];
  return sumByCurrency(parts, (p) => p.currency, (p) => p.value);
}
