/** Flex only moves once a day: syncing more often burns IB's quota for nothing. */
export const FLEX_SYNC_STALE_MS = 12 * 60 * 60 * 1000;

export function isFlexSyncStale(lastAt: string | undefined, now: number): boolean {
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= FLEX_SYNC_STALE_MS;
}
