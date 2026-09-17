import { expiryOfPacked, isPackedOptionSymbol, optionTerms, respellPackedOption, tickerOf } from "./contract.ts";
import { withoutOldSuffix, type CorporateActionEvent } from "./corporate.ts";

/** One spelling of a contract, and the import periods that saw it. */
export interface IdentityAlias {
  ticker: string;
  /** YYYY-MM-DD of the earliest file that showed this spelling. */
  firstSeen: string;
  lastSeen: string;
  /**
   * `true` on an alias no source ever wrote — grafted by rule 8 or rule 9
   * from a corporate action's own triple, never from a Contract Information
   * cell. Optional so records already stored by `apps/web/src/db/contracts.ts`,
   * which predate this field, stay valid: an alias with no opinion here is
   * read as a real one, exactly as before.
   */
  grafted?: boolean;
}

/** One contract, as the stores and the parsers describe it. */
export interface IdentityInput {
  conid: string;
  secType: string;
  /** ISIN as the source reports it, `""` when it reports none. */
  isin: string;
  aliases: IdentityAlias[];
}

/** A ticker the rules left as it was, and why. */
export interface IdentityIssue {
  ticker: string;
  code: "ambiguous-unresolved" | "action-unpaired" | "merger-basis-unknown";
  detail: string;
}

/**
 * Resolves a ticker to the one name the whole ledger should use for its
 * contract. The `conid` behind it is an equivalence hint and never a contract
 * key: `contractId` still keys on the ticker, this only decides *which*
 * ticker (spec §3.1).
 */
export interface ContractIdentities {
  canonical(ticker: string, when: string): string;
  issues: IdentityIssue[];
}

/** No hint at all: every ticker is its own canonical, i.e. today's behaviour. */
export const NO_IDENTITIES: ContractIdentities = {
  canonical: (ticker) => ticker,
  issues: [],
};

/**
 * IB renames the pre-event contract "X.OLD"; that name is never a good
 * canonical.
 *
 * `withoutOldSuffix` (`corporate.ts`) reads the same IB convention from the
 * other end: it strips the suffix to find the contract a corporate action's
 * outgoing lots are actually filed under, while this one merely ranks the
 * alias last when electing a class's canonical name. Two questions, two
 * functions — but one convention, so they move together.
 */
function isOld(ticker: string): boolean {
  return ticker.endsWith(".OLD");
}

/**
 * The three tiers `canonicalOf` ranks an alias by, lowest wins: a spelling a
 * source actually wrote, then IB's own `.OLD`, then a graft nothing wrote at
 * all. Ranking is structural, never by date — `lastSeen` is a file's
 * *declared period*, not when it was written, so a statement whose window
 * closes on or before a graft's day would otherwise outrank it on `lastSeen`
 * alone and the whole ledger would flip onto a name no source ever gave the
 * class.
 */
function tierOf(alias: IdentityAlias): number {
  if (alias.grafted) return 2;
  return isOld(alias.ticker) ? 1 : 0;
}

/**
 * The name a class should wear: a spelling a source wrote, over `.OLD`, over
 * a graft (`tierOf`); latest sighting first within a tier. A class whose only
 * alias is `.OLD` keeps it — inventing the un-suffixed name would collide
 * with the contract that actually bears it.
 *
 * A tie on `lastSeen` is the common case, not the exception: one Contract
 * Information cell routinely lists several spellings ("ZXAB, ZXABQ"), and
 * `mergeContractRecords` stamps them all with that file's own window. It is
 * broken by rank, last alias first, on the assumption that IB writes the cell
 * chronologically — so the last spelling is the current name. Both builders
 * of the list preserve first-sighting order (`mergeIdentities` in the
 * parsers, `mergeContractRecords` in `apps/web/src/db/contracts.ts`), which
 * is what makes the rank meaningful. Alphabetical order would elect the dead
 * name for the commonest rename there is.
 */
function canonicalOf(aliases: readonly IdentityAlias[]): string {
  const ranked = aliases
    .map((alias, rank) => ({ alias, rank }))
    .sort((a, b) => {
      const tierDiff = tierOf(a.alias) - tierOf(b.alias);
      if (tierDiff !== 0) return tierDiff;
      if (a.alias.lastSeen !== b.alias.lastSeen) return a.alias.lastSeen < b.alias.lastSeen ? 1 : -1;
      return b.rank - a.rank;
    });
  return ranked[0].alias.ticker;
}

/** An ambiguous ticker, once an event has dated it: one name before, another from `when` on. */
interface DatedTicker {
  when: string;
  before: string;
  after: string;
}

/**
 * A ticker two contracts share is separated by the corporate action that
 * links them — but only when the action names at least one of them by a name
 * nothing else wears (typically IB's own "X.OLD"). One unambiguous leg is
 * enough: it pins its own class, and the other class is the remaining one.
 * Two ambiguous legs, or more than one linking event, and we refuse: an
 * arbitrary choice here silently merges two real positions.
 */
function dateAmbiguous(
  ticker: string,
  conids: readonly string[],
  claims: ReadonlyMap<string, string[]>,
  events: readonly CorporateActionEvent[],
  canonicalByConid: ReadonlyMap<string, string>,
): DatedTicker | null {
  const classOf = (name: string): string | null => {
    const owners = claims.get(name);
    return owners && owners.length === 1 ? owners[0] : null;
  };
  const candidates: DatedTicker[] = [];
  for (const event of events) {
    const isFrom = event.from.ticker === ticker;
    const isTo = event.to.ticker === ticker;
    if (isFrom === isTo) continue; // neither leg, or a self-referential event
    const other = classOf(isFrom ? event.to.ticker : event.from.ticker);
    if (other === null || !conids.includes(other)) continue;
    const mine = conids.find((conid) => conid !== other)!;
    // `from` is the class that exists before the event, `to` the one after.
    const beforeConid = isFrom ? mine : other;
    const afterConid = isFrom ? other : mine;
    candidates.push({
      when: event.when,
      before: canonicalByConid.get(beforeConid)!,
      after: canonicalByConid.get(afterConid)!,
    });
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * The contracts whose aliases really are spellings of themselves (rule 7).
 *
 * A stock's every alias qualifies. An option's does not: TWS names an option
 * by its underlying, so `agent.ts` files every option conid of one stock
 * under that stock's ticker — reading those as spellings would make twenty
 * conids claim "AAPL" and bury the stock that wears it under an ambiguity.
 * Only the packed OSI spelling names an option contract itself, and only Flex
 * writes it; an option known by no other name identifies nothing and is
 * dropped.
 */
function namedContracts(inputs: readonly IdentityInput[]): IdentityInput[] {
  const kept: IdentityInput[] = [];
  for (const input of inputs) {
    if (input.secType === "STK") {
      if (input.aliases.length > 0) kept.push(input);
      continue;
    }
    if (input.secType !== "OPT") continue;
    const aliases = input.aliases.filter((alias) => isPackedOptionSymbol(alias.ticker));
    if (aliases.length > 0) kept.push({ ...input, aliases });
  }
  return kept;
}

/**
 * Rule 8: the spelling a corporate action gave a leg, filed under the
 * contract that leg's ISIN names.
 *
 * IB routinely hands the new contract of a CUSIP change the very ticker the
 * old one wore, renaming the old one "X.OLD" — and then respells the new one
 * again, months later. By the time a statement is written, its Contract
 * Information lists only the *current* spellings: nothing left in it records
 * that the surviving contract was once called "X". The action's own triple is
 * the last witness, and only its ISIN says which contract that spelling meant.
 *
 * Without the graft the ticker belongs to exactly one class — the dead one —
 * so no ambiguity is detected, rule 3 answers with the dead canonical, and the
 * shares the action brings in are filed on a contract nobody holds. With it
 * the ticker becomes ambiguous, and rule 4 dates it by this very event.
 *
 * The alias is stamped with the event's own day, never a file's window: that
 * is the only day the spelling is known to have been true. It is also marked
 * `grafted`, which is what actually keeps it from outranking the class's
 * current name in `canonicalOf` — a file's `lastSeen` is its *declared
 * period*, not when it was written, so a statement whose window happens to
 * close on or before the event's day would otherwise win on date alone.
 */
function graftActionAliases(inputs: readonly IdentityInput[], events: readonly CorporateActionEvent[]): IdentityInput[] {
  const grafted = inputs.map((input) => ({ ...input, aliases: [...input.aliases] }));
  for (const event of events) {
    const day = event.when.slice(0, 10);
    for (const leg of [event.from, event.to]) {
      if (leg.isin === "") continue;
      for (const input of grafted) {
        if (input.isin !== leg.isin) continue;
        if (input.aliases.some((alias) => alias.ticker === leg.ticker)) continue;
        input.aliases.push({ ticker: leg.ticker, firstSeen: day, lastSeen: day, grafted: true });
      }
    }
  }
  return grafted;
}

/** Rules 1 to 6, applied to the classes rules 7 and 8 have settled. */
function resolve(contracts: readonly IdentityInput[], events: readonly CorporateActionEvent[]): ContractIdentities {
  /** ticker -> the conids that ever wore it. */
  const claims = new Map<string, string[]>();
  const canonicalByConid = new Map<string, string>();
  for (const input of contracts) {
    canonicalByConid.set(input.conid, canonicalOf(input.aliases));
    for (const alias of input.aliases) {
      const list = claims.get(alias.ticker);
      if (list) {
        if (!list.includes(input.conid)) list.push(input.conid);
      } else claims.set(alias.ticker, [input.conid]);
    }
  }

  const resolved = new Map<string, string>();
  const dated = new Map<string, DatedTicker>();
  const issues: IdentityIssue[] = [];
  for (const [ticker, conids] of claims) {
    if (conids.length === 1) {
      resolved.set(ticker, canonicalByConid.get(conids[0])!);
      continue;
    }
    const boundary = conids.length === 2 ? dateAmbiguous(ticker, conids, claims, events, canonicalByConid) : null;
    if (boundary) {
      dated.set(ticker, boundary);
      continue;
    }
    // Rule 6: nothing separates the contracts. Leaving the ticker alone is
    // today's behaviour; guessing would merge two real positions into one.
    issues.push({
      ticker,
      code: "ambiguous-unresolved",
      detail: `${ticker} names ${conids.length} contracts (${conids.join(", ")}) and no corporate action separates them`,
    });
  }
  issues.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  return {
    canonical: (ticker, when) => {
      const boundary = dated.get(ticker);
      if (boundary) return when < boundary.when ? boundary.before : boundary.after;
      return resolved.get(ticker) ?? ticker;
    },
    issues,
  };
}

/**
 * Rule 9: an option follows the 1-for-1 conversion of its underlying.
 *
 * When IB converts a stock share for share — a CUSIP change, a name change, a
 * merger paid entirely in shares — the OCC hands the option contract the new
 * ticker without touching its terms, and IB keeps the conid. But a statement
 * written after the event lists only the spelling of the day: unlike a stock,
 * whose action carries a `(TICKER, NAME, ISIN)` triple for rule 8 to read, an
 * option leaves no witness at all. The event is the only thing that says which
 * name the option wore before.
 *
 * So the graft is made on proof, never on inference: it requires a class that
 * already spells the option under the *new* ticker with these very terms, and
 * it refuses a spelling any other class claims — that file knows better, and
 * merging two real positions is worse than leaving one name unresolved
 * (rule 6). Ratio and cash are what make the terms trustworthy: a ratio other
 * than 1, or a merger that pays cash, adjusts the contract in ways no source
 * of ours reports.
 *
 * The alias is stamped with the event's own day, like rule 8's, and marked
 * `grafted` for the same reason: `lastSeen` is a file's *declared period*,
 * not when it was written, so a statement whose window closes on or before
 * the event's day would otherwise outrank the class's current name in
 * `canonicalOf` on date alone.
 *
 * A third refusal guards against a false positive the first two cannot
 * catch: a class that already spells the option under the *new* ticker with
 * these terms is not proof it is the renamed option — the acquirer's own,
 * pre-existing option at the same terms passes the same test. The OCC's own
 * tell is a suffixed root (`TSTC1` for an arrival `TSTC`): it gives the
 * *renamed* option a root that extends the arrival ticker with one or more
 * digits, precisely when its deliverable stops being standard. So when any
 * other class already carries these very terms under such a suffixed root,
 * that class is the option's real continuation, not the one under the bare
 * arrival ticker — the graft is refused, silently, like the other two.
 */
function followUnderlyingRenames(
  contracts: readonly IdentityInput[],
  events: readonly CorporateActionEvent[],
  resolved: ContractIdentities,
): readonly IdentityInput[] {
  const claimed = new Set<string>();
  // The packed arrival spelling of each option, and how many conids wear it:
  // rule 6's own caution — an arrival two classes both claim is exactly the
  // "nothing separates them" case, and grafting onto the first one found
  // would pick a class arbitrarily.
  const packedOwners = new Map<string, Set<string>>();
  for (const input of contracts) {
    for (const alias of input.aliases) {
      claimed.add(alias.ticker);
      if (input.secType !== "OPT" || !isPackedOptionSymbol(alias.ticker)) continue;
      const owners = packedOwners.get(alias.ticker) ?? new Set<string>();
      owners.add(input.conid);
      packedOwners.set(alias.ticker, owners);
    }
  }
  // The terms every packed OSI alias already carries, per class — built once
  // from `contracts`, before any rule-9 graft, so only a real witness (never
  // an inference from this same pass) can rule out a false-positive match.
  const termsOwners = new Map<string, { root: string; conid: string }[]>();
  for (const input of contracts) {
    if (input.secType !== "OPT") continue;
    for (const alias of input.aliases) {
      if (!isPackedOptionSymbol(alias.ticker)) continue;
      const terms = optionTerms(alias.ticker);
      const list = termsOwners.get(terms) ?? [];
      list.push({ root: tickerOf(alias.ticker), conid: input.conid });
      termsOwners.set(terms, list);
    }
  }
  // True when another class already spells these very terms under a
  // suffixed OCC root (`TSTC1` for an arrival root `TSTC`): the sign that the
  // renamed option went there, not to the class under the bare arrival
  // ticker, which may just as well be the acquirer's own, unrelated option.
  const hasSuffixedSibling = (arrivalRoot: string, terms: string, conid: string): boolean => {
    const suffixed = new RegExp(`^${arrivalRoot}\\d+$`);
    return (termsOwners.get(terms) ?? []).some((owner) => owner.conid !== conid && suffixed.test(owner.root));
  };
  const working = contracts.map((input) => ({ ...input, aliases: [...input.aliases] }));
  let grafted = false;
  // Newest event first: a ticker renamed twice (A -> B -> C) grafts B from the
  // later event, and the earlier one then finds B already there to graft A.
  const newestFirst = [...events].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  for (const event of newestFirst) {
    if (event.cash !== null) continue;
    if (event.from.quantity >= 0 || event.to.quantity !== -event.from.quantity) continue;
    const day = event.when.slice(0, 10);
    const arrivals = new Set([event.to.ticker, resolved.canonical(event.to.ticker, event.when)]);
    // The names the underlying wore before: what the trades of that time are
    // filed under. IB's own "X.OLD" is never one of them.
    const departures = new Set([withoutOldSuffix(event.from.ticker)]);
    for (const input of working) {
      if (!input.aliases.some((alias) => alias.ticker === event.from.ticker)) continue;
      for (const alias of input.aliases) if (!isOld(alias.ticker)) departures.add(alias.ticker);
    }
    for (const arrival of arrivals) departures.delete(arrival);
    if (departures.size === 0) continue;
    for (const input of working) {
      if (input.secType !== "OPT") continue;
      for (const alias of [...input.aliases]) {
        if (!isPackedOptionSymbol(alias.ticker)) continue;
        if (!arrivals.has(tickerOf(alias.ticker))) continue;
        if ((packedOwners.get(alias.ticker)?.size ?? 0) > 1) continue;
        const expiry = expiryOfPacked(alias.ticker);
        // An option already expired cannot have been renamed by this event.
        if (expiry === null || expiry < day) continue;
        // A suffixed sibling class at the same terms is where the renamed
        // option actually went; this class merely happens to pass the same
        // test (e.g. the acquirer's own, pre-existing option).
        if (hasSuffixedSibling(tickerOf(alias.ticker), optionTerms(alias.ticker), input.conid)) continue;
        for (const departure of departures) {
          const spelling = respellPackedOption(alias.ticker, departure);
          if (spelling === null || claimed.has(spelling)) continue;
          input.aliases.push({ ticker: spelling, firstSeen: day, lastSeen: day, grafted: true });
          claimed.add(spelling);
          grafted = true;
        }
      }
    }
  }
  return grafted ? working : contracts;
}

export function buildIdentities(inputs: readonly IdentityInput[], events: readonly CorporateActionEvent[] = []): ContractIdentities {
  const contracts = namedContracts(graftActionAliases(inputs, events));
  // Rule 9 needs the names the underlying wore, which rules 1 to 6 alone can
  // give; option classes share no spelling with stock classes, so resolving
  // twice is safe and the second pass only ever sees more aliases.
  const resolved = resolve(contracts, events);
  const followed = followUnderlyingRenames(contracts, events, resolved);
  return followed === contracts ? resolved : resolve(followed, events);
}
