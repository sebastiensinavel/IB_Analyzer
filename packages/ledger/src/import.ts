import { dayOf, marketDayOf } from "./filter.ts";
import { TRANSACTION_KINDS, type Transaction, type TransactionKind, type TransactionSource } from "./types.ts";

export interface ImportBatch {
  source: TransactionSource;
  transactions: readonly Transaction[];
  /** Period the file declares (Flex from/to, statement header), YYYY-MM-DD inclusive. */
  period: { start: string; end: string } | null;
}

export interface DroppedCount {
  kind: TransactionKind;
  count: number;
}

export interface ImportPlan {
  /** externalIds to remove before writing. */
  delete: string[];
  upsert: Transaction[];
  /** Rows of *other* sources retired by Flex to own its range, by kind. */
  dropped: DroppedCount[];
  /** Rows of the batch left out: another source owns their day, or they fall before the window the batch declares. */
  skipped: number;
}

export class UnsupportedSourceError extends Error {
  constructor(source: string) {
    super(`Import from source "${source}" is not supported yet`);
    this.name = "UnsupportedSourceError";
  }
}

/**
 * Range ownership. Sources cannot recognise each other's rows (IB ids, hashes,
 * execIds) and twin rows on one day are legitimate, so nothing is ever
 * compared by content: a source owns a range of time and writes all of it.
 */
export function planImport(existing: readonly Transaction[], batch: ImportBatch): ImportPlan {
  switch (batch.source) {
    case "flex":
      return planFlex(existing, batch.transactions, batch.period);
    case "statement_html":
      return planStatement(existing, batch.transactions, batch.period);
    case "agent":
      return planAgent(existing, batch.transactions);
    default:
      throw new UnsupportedSourceError(batch.source);
  }
}

function countByKind(transactions: readonly Transaction[]): DroppedCount[] {
  const counts = new Map<TransactionKind, number>();
  for (const tx of transactions) counts.set(tx.kind, (counts.get(tx.kind) ?? 0) + 1);
  return TRANSACTION_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind)!,
  }));
}

/**
 * Flex owns the real range of what it reports, read from the data — but never
 * a day before the window the response itself declares (`fromDate`), and it
 * writes nothing there either: the sections of one response do not share one
 * coverage. A late cash adjustment (a withholding-tax reversal, a re-reported
 * dividend) carries the date of the transaction it corrects, months before
 * the window, while the trades of those months are long out of it. Read as
 * the floor, that single row would hand Flex a range it has nothing to fill,
 * and every statement row in between would be deleted with no replacement —
 * months of history gone on one dividend. Kept as a row, it would then be the
 * oldest Flex row in the ledger, and `planStatement` below would stop the
 * statements from writing those same months for good.
 *
 * So a row dated before the declared window is left out, and counted in
 * `skipped`: that day belongs to the statements, which report it in full. A
 * batch declaring no period at all keeps the old, purely data-driven rule.
 *
 * Rows already in the ledger are never touched by this: one that slid out of
 * the 365-day window is history Flex once vouched for, and it stays.
 *
 * Both bounds are whole days. If Flex's oldest row is at 14:30, its query covered that
 * whole day. And a response always runs to the previous close, so its newest **market**
 * day is complete too — the night that follows it comprised, where IB books an
 * expiration's assignments, and the weekend that follows a Friday. The hours do not match
 * across sources — Flex dates an assignment 16:20, TWS at the hour IB actually processed
 * it, sometimes past midnight — so an instant bound would keep both. The upper bound is
 * not clamped to `toDate`: a row beyond the declared end has never been observed, while
 * the floor is dragged back by an ordinary late adjustment. Clamping it would also silently
 * hide such a row, where the asymmetry leaves it visible.
 *
 * `minDay` and `maxDay` are both read with `dayOf`, never `marketDayOf`, and only the
 * per-row `upper` below switches to `marketDayOf` for an agent row. Reading `minDay` in
 * market days would recede it a day whenever Flex's oldest kept row is a no-time,
 * midnight-stamped cash line, and doom an agent row the day before that Flex never
 * actually reported. That asymmetry — a civil floor, a market-day ceiling for the agent
 * alone — is deliberate, the same reason as the ceiling one above: it never claims a day
 * Flex did not write.
 */
function planFlex(
  existing: readonly Transaction[],
  incoming: readonly Transaction[],
  period: ImportBatch["period"],
): ImportPlan {
  // A fresh array either way, not the caller's own `batch.transactions`: the
  // caller must stay free to reuse or mutate what it passed in after this call.
  const kept = period === null ? [...incoming] : incoming.filter((tx) => dayOf(tx.when) >= period.start);
  const skipped = incoming.length - kept.length;
  if (kept.length === 0) return { delete: [], upsert: [], dropped: [], skipped };
  let min = kept[0].when;
  let max = kept[0].when;
  for (const tx of kept) {
    if (tx.when < min) min = tx.when;
    if (tx.when > max) max = tx.when;
  }
  const minDay = dayOf(min);
  const maxDay = dayOf(max);
  const doomed = existing.filter((tx) => {
    if (tx.source === "flex") return false;
    const day = dayOf(tx.when);
    // Only the agent stamps the hour IB *booked* something, and IB books an expiration's
    // assignments in the night that follows it. Flex stamps 16:20 and a statement stamps the
    // transaction's own hour, or midnight when it gives none: shifting those would retire a
    // statement row dated the day after Flex's last one, which Flex will never replace.
    const upper = tx.source === "agent" ? marketDayOf(tx.when) : day;
    return day >= minDay && upper <= maxDay;
  });
  return {
    delete: doomed.map((tx) => tx.externalId),
    upsert: kept,
    dropped: countByKind(doomed),
    skipped,
  };
}

/**
 * A statement backfills the deep history *before* Flex: whole days, because
 * if Flex's oldest row is at 14:30 its query covered that day entirely. Over
 * its own declared period it replaces the statement rows already there, so
 * importing the same or an overlapping statement twice never duplicates —
 * but only inside the window it may actually write: the declared period
 * intersected with the region before the Flex cutoff day (the whole period
 * when there is no Flex row at all). A row outside that window may have
 * survived an earlier import for a reason the current batch cannot see, so
 * it is not the statement's to delete.
 */
function planStatement(
  existing: readonly Transaction[],
  incoming: readonly Transaction[],
  period: ImportBatch["period"],
): ImportPlan {
  if (period === null) throw new Error("A statement batch needs its declared period");

  let cutoffDay: string | null = null;
  for (const tx of existing) {
    if (tx.source !== "flex") continue;
    const day = dayOf(tx.when);
    if (cutoffDay === null || day < cutoffDay) cutoffDay = day;
  }

  // A fresh array either way, not the caller's own `batch.transactions`.
  const kept = cutoffDay === null ? [...incoming] : incoming.filter((tx) => dayOf(tx.when) < cutoffDay);
  const keptIds = new Set(kept.map((tx) => tx.externalId));
  const replaced = existing.filter((tx) => {
    if (tx.source !== "statement_html" || keptIds.has(tx.externalId)) return false;
    const day = dayOf(tx.when);
    if (day < period.start || day > period.end) return false;
    return cutoffDay === null || day < cutoffDay;
  });

  return {
    delete: replaced.map((tx) => tx.externalId),
    upsert: kept,
    dropped: [],
    skipped: incoming.length - kept.length,
  };
}

/**
 * The agent writes only the **market** days after Flex's newest day, strictly: Flex owns
 * its days whole (`planFlex`), and an execution TWS reports for a day Flex already covers
 * — an assignment IB processed at 22:13 on a Friday, or at 01:02 the following Saturday
 * night, both of a Friday expiry that Flex dates 16:20 — is Flex's row under another hour.
 * It never deletes: a TWS restarted mid-day no longer reports the morning's fills, and
 * erasing them would lose true information. The next Flex sync replaces the whole day
 * anyway (spec fondateur §6.2). Upserting by externalId makes a five-minute cadence
 * idempotent, and lets a later pass fill in a commission that IB reported after the fill.
 */
function planAgent(existing: readonly Transaction[], incoming: readonly Transaction[]): ImportPlan {
  let flexMax: string | null = null;
  for (const tx of existing) {
    if (tx.source === "flex" && (flexMax === null || tx.when > flexMax)) flexMax = tx.when;
  }
  const flexDay = flexMax === null ? null : dayOf(flexMax);
  const kept = flexDay === null ? [...incoming] : incoming.filter((tx) => marketDayOf(tx.when) > flexDay);
  return { delete: [], upsert: kept, dropped: [], skipped: incoming.length - kept.length };
}
