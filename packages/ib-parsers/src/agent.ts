import type { Position, Transaction } from "@ib/ledger";
import { isPackedOptionSymbol } from "@ib/ledger";
import { NormalizationError, flexDateToIsoDay, toReportTime } from "./common.ts";
import { mergeIdentities, type ContractIdentity } from "./identity.ts";
import { warning, type ParseIssue } from "./issues.ts";

/** The wire shape of `GET /snapshot` of apps/tws-agent, field names being ib_async's own. */
export interface AgentContract {
  conId: number;
  symbol: string;
  localSymbol: string;
  secType: string;
  right: string;
  strike: number;
  /** "20261218", or "" */
  lastTradeDateOrContractMonth: string;
  /** "100", or "" */
  multiplier: string;
  currency: string;
}

export interface AgentPosition extends AgentContract {
  position: number;
  /** Per contract for an option, multiplier included: TWS's convention, converted below. */
  averageCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPNL: number;
  /**
   * One `PnLSingle` message: the day's P&L and the position's value at the same instant, so
   * their ratio is coherent. Absent from an older agent, `null` when TWS said nothing in time.
   */
  pnl?: { dailyPnL: number | null; value: number | null } | null;
}

export interface AgentExecution {
  execId: string;
  time: string;
  acctNumber: string;
  side: string;
  shares: number;
  price: number;
  cumQty: number;
  avgPrice: number;
  orderRef: string;
  contract: AgentContract;
  /** Positive, as CommissionReport gives it; `null` until IB sends the report. */
  commission: number | null;
  commissionCurrency: string | null;
}

export interface AgentSnapshotPayload {
  accounts: string[];
  fetchedAt: string;
  cashAvailable: number | null;
  positions: AgentPosition[];
  executions: AgentExecution[];
}

export interface AgentSnapshot {
  accounts: string[];
  /** New York's wall clock stamped UTC (see common.ts' `toReportTime`), not the payload's true UTC. */
  fetchedAt: string;
  cashAvailable: number | null;
  positions: Position[];
  transactions: Transaction[];
  /** Contract identities of this pass, from `conId`; TWS gives no ISIN. */
  identities: ContractIdentity[];
  issues: ParseIssue[];
}

type Obj = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new NormalizationError(`Agent payload: ${path} should be ${expected}`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as Obj;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") fail(`${path}.${key}`, "a string");
  return v;
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${key}`, "a number");
  return v;
}

function numOrNull(o: Obj, key: string, path: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${key}`, "a number or null");
  return v;
}

function list(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`${path}.${key}`, "an array");
  return v;
}

function instant(o: Obj, key: string, path: string): string {
  const date = new Date(str(o, key, path));
  if (Number.isNaN(date.getTime())) fail(`${path}.${key}`, "an ISO 8601 date");
  return date.toISOString();
}

function readContract(value: unknown, path: string): AgentContract {
  const o = obj(value, path);
  return {
    conId: num(o, "conId", path),
    symbol: str(o, "symbol", path),
    localSymbol: str(o, "localSymbol", path),
    secType: str(o, "secType", path),
    right: str(o, "right", path),
    strike: num(o, "strike", path),
    lastTradeDateOrContractMonth: str(o, "lastTradeDateOrContractMonth", path),
    multiplier: str(o, "multiplier", path),
    currency: str(o, "currency", path),
  };
}

const OPTION_TYPES = new Set(["OPT", "FOP"]);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface ContractFields {
  symbol: string;
  localSymbol: string;
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  expiry: string | null;
}

/**
 * IB's own description format for an option ("SYMB 20MAR26 20 P"). `Position.description` is
 * a required field and must carry something sensible; this is also the text a
 * `multiplier-missing` warning names its leg by. Nothing in the UI renders this string
 * otherwise: `PositionsPage` shows `@ib/coverage`'s own `describeContract` (a different
 * function, different signature - hence the "Agent" in this one's name), and `HistoryPage`
 * shows `symbol`, never this fallback. TWS gives no company name, so anything else is its
 * local symbol.
 */
export function describeAgentContract(c: ContractFields): string {
  if (OPTION_TYPES.has(c.secType) && c.expiry !== null && c.strike !== null) {
    const [year, month, day] = c.expiry.split("-");
    return `${c.symbol} ${day}${MONTHS[Number(month) - 1]}${year.slice(2)} ${c.strike} ${c.right}`;
  }
  return c.localSymbol || c.symbol;
}

/**
 * TWS always gives a conId and never an ISIN. The ticker is the spelling that
 * names *this* contract: for an option, the packed OSI form TWS puts in
 * `localSymbol` — the only spelling rule 7 accepts, since `symbol` is the
 * underlying and would make every option of one stock claim its ticker. A
 * market that does not spell options in OSI leaves the underlying there, which
 * rule 7 drops, exactly as it did before this rule existed.
 */
function identityOf(contract: AgentContract, fields: ContractFields): ContractIdentity | null {
  const conid = String(contract.conId);
  if (conid === "0") return null;
  const ticker =
    OPTION_TYPES.has(fields.secType) && isPackedOptionSymbol(fields.localSymbol)
      ? fields.localSymbol
      : fields.symbol;
  if (ticker === "") return null;
  return {
    conid,
    isin: "",
    secType: fields.secType,
    currency: contract.currency,
    description: describeAgentContract(fields),
    tickers: [ticker],
  };
}

/** What `readPosition` and `readExecution` gather along the way: issues, and every identity seen. */
interface Collected {
  issues: ParseIssue[];
  identities: ContractIdentity[];
}

function readFields(c: AgentContract, what: string): ContractFields & { multiplier: number | null } {
  let multiplier: number | null = null;
  if (c.multiplier !== "") {
    multiplier = Number(c.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new NormalizationError(`Unreadable multiplier "${c.multiplier}" for ${what}`);
    }
  }
  return {
    // A currency pair comes as symbol "EUR" / localSymbol "EUR.USD"; the ledger recognises the
    // pair by its dotted form (spec fondateur §3.5).
    symbol: c.secType === "CASH" ? c.localSymbol : c.symbol,
    localSymbol: c.localSymbol,
    secType: c.secType,
    right: c.right === "C" || c.right === "P" ? c.right : "",
    strike: c.strike === 0 ? null : c.strike,
    expiry: flexDateToIsoDay(c.lastTradeDateOrContractMonth),
    multiplier,
  };
}

/**
 * The one rule for an option whose multiplier is unknown, shared by a position's `avgPrice`
 * and an execution's `amount`: both need the multiplier to turn a per-contract TWS figure into
 * a per-unit one, and both must refuse to guess. Not an option: the multiplier is 1, a no-op
 * for whichever formula calls this. An option without one: a `multiplier-missing` warning and
 * `null`, never a silent fallback to 1 - that fallback once made `readExecution`'s `amount` a
 * hundredfold too small without so much as a warning, the same case `readPosition` already
 * handled correctly.
 */
function optionMultiplier(
  fields: { secType: string; multiplier: number | null },
  description: string,
  issues: ParseIssue[],
): number | null {
  if (!OPTION_TYPES.has(fields.secType)) return 1;
  if (fields.multiplier === null) {
    issues.push(warning("multiplier-missing", description));
    return null;
  }
  return fields.multiplier;
}

/**
 * Today's move of the mark price, from one PnLSingle message: `value − dailyPnL` is what the
 * position was worth at yesterday's close, so the ratio is `(price − close) / close` — right for
 * a long and for a short alike. `null` when either value is missing, when the position was worth
 * nothing at the close, or when the contract traded today: the day's P&L then starts from the
 * execution price, not from the close, and no ratio recovers the move. That repairs itself
 * tomorrow.
 */
function dayChangeOf(dailyPnL: number | null, value: number | null, tradedToday: boolean): number | null {
  if (tradedToday || dailyPnL === null || value === null) return null;
  const previous = value - dailyPnL;
  return previous === 0 ? null : dailyPnL / previous;
}

function readPosition(value: unknown, path: string, collected: Collected, tradedToday: ReadonlySet<number>): Position {
  const o = obj(value, path);
  const contract = readContract(o, path);
  const fields = readFields(contract, path);
  const description = describeAgentContract(fields);
  const averageCost = num(o, "averageCost", path);
  // TWS's averageCost of an option is per contract, multiplier included; Position wants per unit.
  const multiplier = optionMultiplier(fields, description, collected.issues);
  const avgPrice = multiplier === null ? null : averageCost / multiplier;
  const identity = identityOf(contract, fields);
  if (identity) collected.identities.push(identity);
  const pnl = o["pnl"] === undefined || o["pnl"] === null ? null : obj(o["pnl"], `${path}.pnl`);
  const dailyPnl = pnl === null ? null : numOrNull(pnl, "dailyPnL", `${path}.pnl`);
  const pnlValue = pnl === null ? null : numOrNull(pnl, "value", `${path}.pnl`);
  return {
    symbol: fields.symbol,
    secType: fields.secType,
    right: fields.right,
    strike: fields.strike,
    expiry: fields.expiry,
    multiplier: fields.multiplier,
    quantity: num(o, "position", path),
    avgPrice,
    marketPrice: num(o, "marketPrice", path),
    marketValue: num(o, "marketValue", path),
    unrealizedPnl: num(o, "unrealizedPNL", path),
    dailyPnl,
    dayChange: dayChangeOf(dailyPnl, pnlValue, tradedToday.has(contract.conId)),
    currency: contract.currency,
    conid: String(contract.conId),
    description,
  };
}

function readExecution(value: unknown, path: string, accountId: string, collected: Collected): Transaction {
  const o = obj(value, path);
  const execId = str(o, "execId", path);
  if (execId === "") fail(`${path}.execId`, "non-empty: it is the dedup key");
  const side = str(o, "side", path);
  if (side !== "BOT" && side !== "SLD") fail(`${path}.side`, '"BOT" or "SLD"');
  const contract = readContract(o["contract"], `${path}.contract`);
  const fields = readFields(contract, `${path}.contract`);
  const description = describeAgentContract(fields);
  const multiplier = optionMultiplier(fields, description, collected.issues);
  const identity = identityOf(contract, fields);
  if (identity) collected.identities.push(identity);
  const shares = num(o, "shares", path);
  const price = num(o, "price", path);
  const quantity = side === "BOT" ? shares : -shares;
  const commission = numOrNull(o, "commission", path);
  return {
    accountId,
    externalId: `agent:${execId}`,
    source: "agent",
    kind: "trade",
    symbol: fields.symbol,
    secType: fields.secType,
    right: fields.right,
    strike: fields.strike,
    expiry: fields.expiry,
    quantity,
    price,
    // Gross proceeds, commission apart: the same convention as a Flex Trade's `proceeds`. An
    // unknown multiplier stays `null`, never a wrong number silently a hundredfold too small.
    amount: multiplier === null ? null : -quantity * price * multiplier,
    // A commission is a cost; `null` stays `null`, the next pass may bring it.
    commission: commission === null ? null : -commission,
    currency: contract.currency,
    when: toReportTime(instant(o, "time", path)),
    description,
  };
}

/** Anything that is not the shape of §3.4 of the sub-project 4 spec is a `NormalizationError` naming the path. */
export function parseAgentSnapshot(payload: unknown, accountId: string): AgentSnapshot {
  const root = obj(payload, "payload");
  const collected: Collected = { issues: [], identities: [] };
  const accounts = list(root, "accounts", "payload").map((v, i) =>
    typeof v === "string" ? v : fail(`payload.accounts[${i}]`, "a string"),
  );
  const fetchedAt = toReportTime(instant(root, "fetchedAt", "payload"));
  const cashAvailable = numOrNull(root, "cashAvailable", "payload");
  const rawExecutions = list(root, "executions", "payload");
  // Which contracts moved today, read off the same response. A conId this loop cannot read is
  // left alone: readExecution below raises on it, at its own path.
  const tradedToday = new Set<number>(
    rawExecutions.flatMap((e) => {
      const contract = (e as Obj | null)?.["contract"];
      const conId = contract && typeof contract === "object" ? (contract as Obj)["conId"] : undefined;
      return typeof conId === "number" ? [conId] : [];
    }),
  );
  const positions = list(root, "positions", "payload").map((v, i) =>
    readPosition(v, `payload.positions[${i}]`, collected, tradedToday),
  );
  const transactions = rawExecutions.map((v, i) => readExecution(v, `payload.executions[${i}]`, accountId, collected));
  const identities = mergeIdentities([collected.identities]);
  return { accounts, fetchedAt, cashAvailable, positions, transactions, identities, issues: collected.issues };
}
