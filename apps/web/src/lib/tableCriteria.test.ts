import { describe, expect, it } from "vitest";
import { parseCriterion, type CellValue } from "@/lib/tableCriteria";

/** The values among `values` that the criterion keeps; throws on a parse error. */
function keep(text: string, type: "text" | "number" | "date", values: CellValue[]): CellValue[] {
  const parsed = parseCriterion(text, type);
  if (!parsed.ok) throw new Error(`unexpected error ${parsed.error}`);
  return parsed.test ? values.filter(parsed.test) : values;
}

function errorOf(text: string, type: "text" | "number" | "date") {
  const parsed = parseCriterion(text, type);
  return parsed.ok ? null : parsed.error;
}

const NUMBERS: CellValue[] = [-2000, -1, 0, 1.5, 100, 250, 500, 1000, null];

describe("parseCriterion — structure", () => {
  it("filters nothing on a blank input", () => {
    expect(parseCriterion("   ", "number")).toEqual({ ok: true, test: null });
    expect(parseCriterion("", "text")).toEqual({ ok: true, test: null });
  });

  it("reads | as OR and spaces as AND, AND binding tighter", () => {
    expect(keep("<0|>500", "number", NUMBERS)).toEqual([-2000, -1, 1000]);
    expect(keep(">0 <500", "number", NUMBERS)).toEqual([1.5, 100, 250]);
    expect(keep(">0 <200|>=1000", "number", NUMBERS)).toEqual([1.5, 100, 1000]);
  });

  it("tolerates spaces between an operator and its value", () => {
    expect(keep("> 500", "number", NUMBERS)).toEqual([1000]);
  });

  it("negates a term with !", () => {
    expect(keep("!0..500", "number", NUMBERS)).toEqual([-2000, -1, 1000]);
  });

  it("matches null only with — or -, and every other term is false on null", () => {
    expect(keep("—", "number", NUMBERS)).toEqual([null]);
    expect(keep("-", "text", ["a", null])).toEqual([null]);
    expect(keep("!—", "number", [1, null])).toEqual([1]);
    expect(keep("!-", "text", ["a", null])).toEqual(["a"]);
    expect(keep("!=0", "number", [0, 1, null])).toEqual([1]);
    expect(keep("!SPY", "text", ["SPY", "QQQ", null])).toEqual(["QQQ"]);
    expect(keep("<0|—", "number", NUMBERS)).toEqual([-2000, -1, null]);
  });

  it("rejects an empty alternative or a dangling operator", () => {
    expect(errorOf("1|", "number")).toBe("syntax");
    expect(errorOf(">", "number")).toBe("syntax");
    expect(errorOf("!", "text")).toBe("syntax");
  });
});

describe("parseCriterion — number", () => {
  it("supports every comparison operator, a bare number meaning =", () => {
    expect(keep("=100", "number", NUMBERS)).toEqual([100]);
    expect(keep("100", "number", NUMBERS)).toEqual([100]);
    expect(keep("!=0", "number", [0, 1])).toEqual([1]);
    expect(keep("<1", "number", NUMBERS)).toEqual([-2000, -1, 0]);
    expect(keep("<=1.5", "number", NUMBERS)).toEqual([-2000, -1, 0, 1.5]);
    expect(keep(">500", "number", NUMBERS)).toEqual([1000]);
    expect(keep(">=500", "number", NUMBERS)).toEqual([500, 1000]);
  });

  it("reads inclusive ranges with optional bounds", () => {
    expect(keep("100..500", "number", NUMBERS)).toEqual([100, 250, 500]);
    expect(keep("..0", "number", NUMBERS)).toEqual([-2000, -1, 0]);
    expect(keep("500..", "number", NUMBERS)).toEqual([500, 1000]);
  });

  it("accepts a comma decimal, a minus sign and a dollar sign", () => {
    expect(keep("1,5", "number", NUMBERS)).toEqual([1.5]);
    expect(keep("<-1000", "number", NUMBERS)).toEqual([-2000]);
    expect(keep("$100", "number", NUMBERS)).toEqual([100]);
  });

  it("compares the raw value, never a rounding", () => {
    expect(keep("=1.2346", "number", [1.23456])).toEqual([]);
    expect(keep("1.2345..1.2346", "number", [1.23456])).toEqual([1.23456]);
  });

  it("rejects what is not a number", () => {
    expect(errorOf(">abc", "number")).toBe("number");
    expect(errorOf("1.000,5", "number")).toBe("number");
    expect(errorOf("..", "number")).toBe("number");
    expect(errorOf("<1..2", "number")).toBe("syntax");
  });
});

describe("parseCriterion — date", () => {
  const WHENS: CellValue[] = [
    "2024-12-31 23:59:59",
    "2025-01-01 00:00:00",
    "2025-02-28 10:00:00",
    "2025-03-01 00:00:00",
    "2025-03-31 23:59:59",
    "2025-04-01 00:00:00",
    "2025-06-30 16:20:00",
    "2025-07-01 09:30:00",
    "2026-01-02 09:30:00",
    null,
  ];

  it("reads a partial date as its whole period", () => {
    expect(keep("2025-03", "date", WHENS)).toEqual(["2025-03-01 00:00:00", "2025-03-31 23:59:59"]);
    expect(keep("2025-02-28", "date", WHENS)).toEqual(["2025-02-28 10:00:00"]);
    expect(keep("2026", "date", WHENS)).toEqual(["2026-01-02 09:30:00"]);
  });

  it("places each operator on the right bound of the period", () => {
    expect(keep(">=2025-03", "date", WHENS)).toEqual(WHENS.slice(3, 9));
    expect(keep(">2025-03", "date", WHENS)).toEqual(WHENS.slice(5, 9));
    expect(keep("<2025", "date", WHENS)).toEqual(["2024-12-31 23:59:59"]);
    expect(keep("<=2025", "date", WHENS)).toEqual(WHENS.slice(0, 8));
    expect(keep("!=2025", "date", WHENS)).toEqual(["2024-12-31 23:59:59", "2026-01-02 09:30:00"]);
    expect(keep("!2025", "date", WHENS)).toEqual(["2024-12-31 23:59:59", "2026-01-02 09:30:00"]);
  });

  it("reads a range from the start of its first bound to the end of its last", () => {
    expect(keep("2024..2025-06", "date", WHENS)).toEqual(WHENS.slice(0, 7));
    expect(keep("2025-07..", "date", WHENS)).toEqual(WHENS.slice(7, 9));
  });

  it("rejects a month or a day that does not exist", () => {
    expect(errorOf("2025-13", "date")).toBe("date");
    expect(errorOf("2025-02-30", "date")).toBe("date");
    expect(errorOf("2025-2", "date")).toBe("date");
    expect(errorOf("hier", "date")).toBe("date");
  });
});

describe("parseCriterion — text", () => {
  const LABELS: CellValue[] = ["AAPL Jan16'26 150 Call", "AAPL", "MSFT", "ZXAL.OLD", "a*b", null];

  it("finds a case-insensitive substring by default", () => {
    expect(keep("aap", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call", "AAPL"]);
  });

  it("reads = as exact equality and != as its opposite", () => {
    expect(keep("=aapl", "text", LABELS)).toEqual(["AAPL"]);
    expect(keep("!=AAPL", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call", "MSFT", "ZXAL.OLD", "a*b"]);
  });

  it("treats * as a wildcard only after = or !=", () => {
    expect(keep("=AA*", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call", "AAPL"]);
    expect(keep("=*Call", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call"]);
    expect(keep("a*b", "text", LABELS)).toEqual(["a*b"]);
  });

  it("keeps the OR of tickers", () => {
    expect(keep("=AAPL|=MSFT", "text", LABELS)).toEqual(["AAPL", "MSFT"]);
  });

  it("rejects comparison operators and ranges on text", () => {
    expect(errorOf("<AAPL", "text")).toBe("textOperator");
    expect(errorOf(">=B", "text")).toBe("textOperator");
    expect(errorOf("A..B", "text")).toBe("textOperator");
  });
});
