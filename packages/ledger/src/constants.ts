/**
 * Shares per option contract when nothing observed says otherwise.
 *
 * Lives here, in the lowest layer, rather than in `@ib/coverage` with the other
 * business constants: the journals engine needs it to convert a call count into
 * a share count, and `coverage` already depends on `ledger`, so importing it the
 * other way round would be a cycle. `coverage` re-exports it, and it is still
 * defined exactly once.
 *
 * A lot delivered by an assignment carries the ratio the delivery itself showed
 * (`Lot.ratio`); a lot bought on the market has no delivery to read.
 */
export const DEFAULT_MULTIPLIER = 100;
