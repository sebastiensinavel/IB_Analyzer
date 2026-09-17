/**
 * The criterion grammar of a column filter (spec of sub-project 20, §2): `|` separates
 * alternatives (OR), spaces separate terms (AND), `!` negates a term, `—` or `-` alone stands for
 * an absent value. Every term other than the absent one is false on `null`.
 */

export type ColumnType = "text" | "number" | "date" | "enum";
export type CellValue = string | number | null;
export type CriterionError = "number" | "date" | "textOperator" | "syntax";
export type Predicate = (value: CellValue) => boolean;
/** `test: null` means the input filters nothing (blank). */
export type ParsedCriterion = { ok: true; test: Predicate | null } | { ok: false; error: CriterionError };

type Operator = "" | "=" | "!=" | "<" | "<=" | ">" | ">=";

interface Term {
  negate: boolean;
  op: Operator;
  body: string;
}

class CriterionFailure extends Error {
  readonly code: CriterionError;

  constructor(code: CriterionError) {
    super(code);
    this.code = code;
  }
}

const OPERATORS: readonly Operator[] = ["!=", "<=", ">=", "=", "<", ">"];

function readTerms(alternative: string): Term[] {
  const terms: Term[] = [];
  let rest = alternative.trim();
  while (rest.length > 0) {
    let negate = false;
    if (rest.startsWith("!") && !rest.startsWith("!=")) {
      negate = true;
      rest = rest.slice(1).trimStart();
    }
    let op: Operator = "";
    for (const candidate of OPERATORS) {
      if (rest.startsWith(candidate)) {
        op = candidate;
        rest = rest.slice(candidate.length).trimStart();
        break;
      }
    }
    const match = /^\S+/.exec(rest);
    if (!match) throw new CriterionFailure("syntax");
    terms.push({ negate, op, body: match[0] });
    rest = rest.slice(match[0].length).trimStart();
  }
  return terms;
}

const isAbsentBody = (body: string) => body === "—" || body === "-";

function parseNumber(text: string): number {
  const cleaned = text.replace("$", "").replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) throw new CriterionFailure("number");
  return Number(cleaned);
}

interface Period {
  start: string;
  end: string;
}

function parsePeriod(text: string): Period {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!match) throw new CriterionFailure("date");
  const [, year, month, day] = match;
  if (month === undefined) return { start: `${year}-01-01 00:00:00`, end: `${year}-12-31 23:59:59` };
  const monthIndex = Number(month);
  if (monthIndex < 1 || monthIndex > 12) throw new CriterionFailure("date");
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(Number(year), monthIndex, 0)).getUTCDate();
  if (day === undefined) {
    return { start: `${year}-${month}-01 00:00:00`, end: `${year}-${month}-${String(lastDay).padStart(2, "0")} 23:59:59` };
  }
  const dayIndex = Number(day);
  if (dayIndex < 1 || dayIndex > lastDay) throw new CriterionFailure("date");
  return { start: `${year}-${month}-${day} 00:00:00`, end: `${year}-${month}-${day} 23:59:59` };
}

/** Splits `a..b`; `null` when the body is not a range. Both bounds may not be empty. */
function splitRange(body: string): [string, string] | null {
  const index = body.indexOf("..");
  if (index < 0) return null;
  return [body.slice(0, index), body.slice(index + 2)];
}

function numberTerm(term: Term): (value: number) => boolean {
  const range = splitRange(term.body);
  if (range) {
    if (term.op !== "") throw new CriterionFailure("syntax");
    const [low, high] = range;
    if (low === "" && high === "") throw new CriterionFailure("number");
    const min = low === "" ? -Infinity : parseNumber(low);
    const max = high === "" ? Infinity : parseNumber(high);
    return (value) => value >= min && value <= max;
  }
  const target = parseNumber(term.body);
  switch (term.op) {
    case "":
    case "=":
      return (value) => value === target;
    case "!=":
      return (value) => value !== target;
    case "<":
      return (value) => value < target;
    case "<=":
      return (value) => value <= target;
    case ">":
      return (value) => value > target;
    case ">=":
      return (value) => value >= target;
  }
}

function dateTerm(term: Term): (value: string) => boolean {
  const range = splitRange(term.body);
  if (range) {
    if (term.op !== "") throw new CriterionFailure("syntax");
    const [low, high] = range;
    if (low === "" && high === "") throw new CriterionFailure("date");
    const start = low === "" ? "" : parsePeriod(low).start;
    const end = high === "" ? "￿" : parsePeriod(high).end;
    return (value) => value >= start && value <= end;
  }
  const period = parsePeriod(term.body);
  switch (term.op) {
    case "":
    case "=":
      return (value) => value >= period.start && value <= period.end;
    case "!=":
      return (value) => value < period.start || value > period.end;
    case "<":
      return (value) => value < period.start;
    case "<=":
      return (value) => value <= period.end;
    case ">":
      return (value) => value > period.end;
    case ">=":
      return (value) => value >= period.start;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function textTerm(term: Term): (value: string) => boolean {
  if (term.op === "<" || term.op === "<=" || term.op === ">" || term.op === ">=" || term.body.includes("..")) {
    throw new CriterionFailure("textOperator");
  }
  const needle = term.body.toLowerCase();
  if (term.op === "") return (value) => value.toLowerCase().includes(needle);
  const exact = term.body.includes("*") ? globToRegExp(term.body) : null;
  const equals = (value: string) => (exact ? exact.test(value) : value.toLowerCase() === needle);
  return term.op === "=" ? equals : (value) => !equals(value);
}

function termPredicate(term: Term, type: Exclude<ColumnType, "enum">): Predicate {
  if (isAbsentBody(term.body) && (term.op === "" || term.op === "=" || term.op === "!=")) {
    const wantsNull = (term.op !== "!=") !== term.negate;
    return (value) => (value === null) === wantsNull;
  }
  let base: (value: never) => boolean;
  if (type === "number") base = numberTerm(term) as (value: never) => boolean;
  else if (type === "date") base = dateTerm(term) as (value: never) => boolean;
  else base = textTerm(term) as (value: never) => boolean;
  return (value) => {
    if (value === null) return false;
    if (type === "number" ? typeof value !== "number" : typeof value !== "string") return false;
    const result = base(value as never);
    return term.negate ? !result : result;
  };
}

export function parseCriterion(text: string, type: Exclude<ColumnType, "enum">): ParsedCriterion {
  if (text.trim() === "") return { ok: true, test: null };
  try {
    const alternatives = text.split("|").map((alternative) => {
      if (alternative.trim() === "") throw new CriterionFailure("syntax");
      return readTerms(alternative).map((term) => termPredicate(term, type));
    });
    return {
      ok: true,
      test: (value) => alternatives.some((terms) => terms.every((predicate) => predicate(value))),
    };
  } catch (failure) {
    if (failure instanceof CriterionFailure) return { ok: false, error: failure.code };
    throw failure;
  }
}
