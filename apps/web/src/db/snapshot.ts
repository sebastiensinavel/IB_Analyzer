import { dayOf } from "@ib/ledger";
import type { SnapshotRecord } from "./schema";

/**
 * An agent snapshot always replaces the current one: it is live by definition. A file
 * (Flex, statement) replaces if its day reaches the *day* of the current one, so that the
 * morning Flex sync, as of yesterday's close, replaces yesterday's agent snapshot, and the
 * first agent pass of the day replaces it back. Comparing the raw strings would let a
 * "2026-09-05" file lose against "2026-09-05T15:00Z" for ever.
 */
export function shouldReplaceSnapshot(
  current: SnapshotRecord | undefined,
  incoming: Pick<SnapshotRecord, "source" | "asOf">,
): boolean {
  if (!current) return true;
  if (incoming.source === "agent") return true;
  return incoming.asOf >= dayOf(current.asOf);
}
