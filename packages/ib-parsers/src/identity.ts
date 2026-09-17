/**
 * One IB contract as a source describes it, and every ticker string it has
 * been seen under. The `conid` is the only thing a ticker change never
 * touches; it is an equivalence hint, never a contract key (spec §3.1).
 */
export interface ContractIdentity {
  /** IB's stable contract id. An entry without one identifies nothing. */
  conid: string;
  isin: string;
  /** "STK", "OPT"… as the source names it. */
  secType: string;
  currency: string;
  description: string;
  /** Every spelling of this contract, first seen first. */
  tickers: string[];
}

/**
 * Folds identities of several files into one list per conid: tickers are
 * unioned in order of first sighting, and a field left empty by the first
 * sighting is filled by a later one. Entries without a conid are dropped —
 * they carry no identity, only a name we already have.
 */
export function mergeIdentities(lists: readonly (readonly ContractIdentity[])[]): ContractIdentity[] {
  const byConid = new Map<string, ContractIdentity>();
  for (const list of lists) {
    for (const identity of list) {
      if (identity.conid === "") continue;
      const current = byConid.get(identity.conid);
      if (!current) {
        byConid.set(identity.conid, { ...identity, tickers: [...identity.tickers] });
        continue;
      }
      for (const ticker of identity.tickers) {
        if (!current.tickers.includes(ticker)) current.tickers.push(ticker);
      }
      current.isin ||= identity.isin;
      current.secType ||= identity.secType;
      current.currency ||= identity.currency;
      current.description ||= identity.description;
    }
  }
  return [...byConid.values()];
}
