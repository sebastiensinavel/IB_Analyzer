import { ACTIVABLE_STRATEGIES, type ActivableStrategy } from "@ib/ledger";
import type { AccountRecord } from "@/db/schema";

/** What an account that never chose follows: the application's default, never the engine's. */
export const DEFAULT_ACTIVE_STRATEGIES: readonly ActivableStrategy[] = ["wheel"];

/**
 * The only reader of `AccountRecord.strategies` (spec of sub-project 30, §2): the canonical
 * order, no duplicate, and a value this browser does not know — written by a newer one, restored
 * from its backup — ignored, never an error.
 */
export function activeStrategies(account: Pick<AccountRecord, "strategies"> | null | undefined): ActivableStrategy[] {
  const chosen: readonly string[] = account?.strategies ?? DEFAULT_ACTIVE_STRATEGIES;
  return ACTIVABLE_STRATEGIES.filter((strategy) => chosen.includes(strategy));
}
