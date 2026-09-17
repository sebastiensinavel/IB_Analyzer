import { describe, expect, it } from "vitest";
import type { Transaction } from "../types.ts";
import { pairCorporateActions } from "./corporate.ts";
import { NO_IDENTITIES, buildIdentities, type IdentityInput } from "./identities.ts";

const WHEN = "2023-06-01T20:25:00.000Z";

function input(conid: string, tickers: [string, string, string][], secType = "STK", isin = ""): IdentityInput {
  return { conid, secType, isin, aliases: tickers.map(([ticker, firstSeen, lastSeen]) => ({ ticker, firstSeen, lastSeen })) };
}

describe("NO_IDENTITIES", () => {
  it("is the identity function: a ledger with no hint behaves as it always did", () => {
    expect(NO_IDENTITIES.canonical("ZXAA", WHEN)).toBe("ZXAA");
    expect(NO_IDENTITIES.issues).toEqual([]);
  });
});

describe("buildIdentities", () => {
  it("resolves every alias of one conid to its canonical (rules 1 and 3)", () => {
    const identities = buildIdentities([input("1", [["ZXAB", "2022-01-01", "2022-12-31"], ["ZXABQ", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAB", WHEN)).toBe("ZXABQ");
    expect(identities.canonical("ZXABQ", WHEN)).toBe("ZXABQ");
    expect(identities.issues).toEqual([]);
  });

  it("prefers the alias without a .OLD suffix, whatever the dates (rule 2)", () => {
    const identities = buildIdentities([input("1", [["ZXAA", "2022-01-01", "2022-12-31"], ["ZXAA.OLD", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAA.OLD", WHEN)).toBe("ZXAA");
  });

  it("keeps a .OLD alias when it is the only one there is (rule 2)", () => {
    const identities = buildIdentities([input("1", [["ZXAD.OLD", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAD.OLD", WHEN)).toBe("ZXAD.OLD");
  });

  it("picks the latest-seen alias when several have no suffix (rule 2)", () => {
    const identities = buildIdentities([input("1", [["ZXAN", "2022-01-01", "2022-12-31"], ["ZXANQ", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAN", WHEN)).toBe("ZXANQ");
  });

  it("breaks a tie on lastSeen by the alias's rank, the current name last (rule 2)", () => {
    // One Contract Information cell, "ZXAB, ZXABQ": `mergeContractRecords`
    // stamps both spellings with the same file window, so `lastSeen` cannot
    // separate them. IB lists the cell chronologically, so the last alias is
    // the current name; alphabetical order would elect the dead one.
    const identities = buildIdentities([input("1", [["ZXAB", "2022-01-01", "2022-12-31"], ["ZXABQ", "2022-01-01", "2022-12-31"]])]);
    expect(identities.canonical("ZXAB", WHEN)).toBe("ZXABQ");
    expect(identities.canonical("ZXABQ", WHEN)).toBe("ZXABQ");
  });

  it("leaves a ticker no conid ever claimed alone (rule 5)", () => {
    const identities = buildIdentities([input("1", [["ZXAB", "2022-01-01", "2022-12-31"]])]);
    expect(identities.canonical("MQZA", WHEN)).toBe("MQZA");
  });

  it("leaves an ambiguous ticker alone and says so (rule 6, until task 6 dates it)", () => {
    const identities = buildIdentities([
      input("1", [["ZXAA", "2022-01-01", "2023-06-22"]]),
      input("2", [["ZXAA", "2023-06-23", "2023-12-31"], ["ZXAAQ", "2024-01-01", "2024-12-31"]]),
    ]);
    expect(identities.canonical("ZXAA", WHEN)).toBe("ZXAA");
    expect(identities.issues).toEqual([
      { ticker: "ZXAA", code: "ambiguous-unresolved", detail: "ZXAA names 2 contracts (1, 2) and no corporate action separates them" },
    ]);
  });

  it("ignores an option alias that is its underlying's name, not its own (rule 7)", () => {
    // TWS names an option by its underlying, so `agent.ts` files every option
    // conid of one stock under that stock's ticker. Reading those as spellings
    // of a contract would make twenty conids claim "TESTX" and bury the stock
    // that really wears it under an ambiguity.
    const identities = buildIdentities([
      input("1", [["TESTX", "2022-01-01", "2022-12-31"]], "OPT"),
      input("2", [["TESTX", "2023-01-01", "2023-12-31"]], "OPT"),
    ]);
    expect(identities.canonical("TESTX", WHEN)).toBe("TESTX");
    expect(identities.issues).toEqual([]);
  });

  it("resolves both packed spellings of one option conid to the latest (rule 7)", () => {
    // The real case: IB renamed ZXAG to ZXAF without ever touching the option
    // contract, which kept conid 900000109 and merely changed its spelling.
    const identities = buildIdentities([
      input("900000109", [["ZXAG  270115C00002500", "2025-09-09", "2026-09-09"], ["ZXAF  270115C00002500", "2025-09-09", "2026-09-09"]], "OPT"),
    ]);
    expect(identities.canonical("ZXAG  270115C00002500", WHEN)).toBe("ZXAF  270115C00002500");
    expect(identities.canonical("ZXAF  270115C00002500", WHEN)).toBe("ZXAF  270115C00002500");
    expect(identities.issues).toEqual([]);
  });

  it("never lets an option spelling answer for the stock it is written on (rule 7)", () => {
    const identities = buildIdentities([
      input("1", [["ZXAG", "2025-01-01", "2026-04-02"]], "STK"),
      input("900000109", [["ZXAG  270115C00002500", "2025-09-09", "2026-09-09"], ["ZXAF  270115C00002500", "2025-09-09", "2026-09-09"]], "OPT"),
    ]);
    expect(identities.canonical("ZXAG", WHEN)).toBe("ZXAG");
    expect(identities.issues).toEqual([]);
  });
});

describe("buildIdentities with corporate actions (rule 4)", () => {
  // In the 2023 statement, "ZXAA" names conid 1 before the split and conid 2
  // after it; only the event's `.OLD` leg says which is which.
  const inputs = [
    input("1", [["ZXAA", "2022-01-01", "2023-12-31"], ["ZXAA.OLD", "2023-01-01", "2023-12-31"]]),
    input("2", [["ZXAA", "2023-01-01", "2023-12-31"], ["ZXAAQ", "2024-01-01", "2024-12-31"]]),
  ];
  const events = [
    { when: "2023-06-22T20:25:00.000Z", from: { ticker: "ZXAA.OLD", isin: "", quantity: -2600 }, to: { ticker: "ZXAA", isin: "", quantity: 325 }, cash: null, ids: [] },
  ];

  it("resolves the ambiguous ticker to the old class before the event", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAA", "2023-02-01T15:17:26.000Z")).toBe("ZXAA");
  });

  it("resolves it to the new class from the event's instant onward, bounds included", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAA", "2023-06-22T20:25:00.000Z")).toBe("ZXAAQ");
    expect(identities.canonical("ZXAA", "2024-10-17T15:32:54.000Z")).toBe("ZXAAQ");
  });

  it("still resolves the unambiguous aliases of both classes", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAA.OLD", "2022-06-01T00:00:00.000Z")).toBe("ZXAA");
    expect(identities.canonical("ZXAAQ", "2024-06-01T00:00:00.000Z")).toBe("ZXAAQ");
    expect(identities.issues).toEqual([]);
  });

  it("gives up when three classes share the ticker (rule 6)", () => {
    const three = [...inputs, input("3", [["ZXAA", "2025-01-01", "2025-12-31"]])];
    const identities = buildIdentities(three, events);
    expect(identities.canonical("ZXAA", "2024-01-01T00:00:00.000Z")).toBe("ZXAA");
    expect(identities.issues.map((i) => i.code)).toEqual(["ambiguous-unresolved"]);
  });

  it("gives up when both legs of the linking event are themselves ambiguous (rule 6)", () => {
    const bothAmbiguous = [
      input("1", [["AAA", "2022-01-01", "2023-12-31"], ["BBB", "2022-01-01", "2023-12-31"]]),
      input("2", [["AAA", "2023-01-01", "2024-12-31"], ["BBB", "2023-01-01", "2024-12-31"]]),
    ];
    const identities = buildIdentities(bothAmbiguous, [
      { when: "2023-06-22T20:25:00.000Z", from: { ticker: "AAA", isin: "", quantity: -10 }, to: { ticker: "BBB", isin: "", quantity: 1 }, cash: null, ids: [] },
    ]);
    expect(identities.canonical("AAA", "2024-01-01T00:00:00.000Z")).toBe("AAA");
    expect(identities.issues.map((i) => i.ticker).sort()).toEqual(["AAA", "BBB"]);
  });

  it("feeds straight from pairCorporateActions", () => {
    const { events: paired } = pairCorporateActions([]);
    expect(buildIdentities(inputs, paired).issues.map((i) => i.code)).toEqual(["ambiguous-unresolved"]);
  });
});

describe("buildIdentities on a ticker an action handed to a new contract (rule 8)", () => {
  // ZXAL, 2025-03-05: IB gave the new contract the ticker the old one wore,
  // renaming the old one ZXAL.OLD, then respelled the new one ZXAM. By the
  // time the 2025 statement was written, no Contract Information cell said
  // the new conid had ever been called ZXAL — the action's own triple is the
  // only witness left, and its ISIN is what names the contract.
  const OLD = "CA25381D2068";
  const NEW = "CA25380B1022";
  const CHANGE = `ZXAL(${OLD}) CUSIP/ISIN Change to (${NEW})`;
  const inputs = [
    input("900000104", [["ZXAL", "2023-01-01", "2024-12-31"], ["ZXAL.OLD", "2025-01-01", "2025-12-31"]], "STK", OLD),
    input("900000110", [["ZXAM", "2025-01-01", "2026-09-02"]], "STK", NEW),
  ];
  const events = [
    {
      when: "2025-03-05T20:25:00.000Z",
      from: { ticker: "ZXAL.OLD", isin: OLD, quantity: -505 },
      to: { ticker: "ZXAL", isin: NEW, quantity: 505 },
      cash: null,
      ids: [],
    },
  ];

  it("resolves the reused ticker to the new class from the event's instant on", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAL", "2025-03-05T20:25:00.000Z")).toBe("ZXAM");
    expect(identities.canonical("ZXAL", "2026-09-02T00:00:00.000Z")).toBe("ZXAM");
    expect(identities.issues).toEqual([]);
  });

  it("still resolves it to the old class before the event", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAL", "2023-01-18T14:55:24.000Z")).toBe("ZXAL");
    expect(identities.canonical("ZXAL.OLD", "2025-03-05T20:25:00.000Z")).toBe("ZXAL");
  });

  it("does not let the grafted spelling become the class's canonical name", () => {
    // The graft is dated at the event's day; ZXAM was seen a year later and
    // must stay the name the whole ledger wears.
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAM", "2026-09-02T00:00:00.000Z")).toBe("ZXAM");
  });

  it("leaves a leg alone when no contract declares its ISIN", () => {
    const unknown = [input("900000104", [["ZXAL", "2023-01-01", "2024-12-31"], ["ZXAL.OLD", "2025-01-01", "2025-12-31"]], "STK", OLD)];
    const identities = buildIdentities(unknown, events);
    expect(identities.canonical("ZXAL", "2025-03-05T20:25:00.000Z")).toBe("ZXAL");
    expect(identities.issues).toEqual([]);
  });

  it("keeps a real .OLD alias canonical over a rule-8 graft bringing the bare name (rule 2 tier, not dates)", () => {
    // Rule 8's graft is tier 2, ranked after every spelling a source really
    // wrote — including IB's own ".OLD" (tier 1). A class whose only real
    // alias is "X.OLD" must keep it even once a corporate action grafts the
    // bare "X" onto the same class.
    const ISIN = "US0000000099";
    const inputs = [input("1", [["X.OLD", "2023-01-01", "2023-12-31"]], "STK", ISIN)];
    const events = [
      {
        when: "2023-06-01T00:00:00.000Z",
        from: { ticker: "Y.OLD", isin: "US0000000098", quantity: -10 },
        to: { ticker: "X", isin: ISIN, quantity: 10 },
        cash: null,
        ids: [],
      },
    ];
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("X.OLD", "2023-06-01T00:00:00.000Z")).toBe("X.OLD");
    expect(identities.canonical("X", "2023-06-01T00:00:00.000Z")).toBe("X.OLD");
  });

  it("feeds straight from pairCorporateActions", () => {
    const ca = (symbol: string, quantity: number, leg: string): Transaction => ({
      accountId: "test",
      externalId: `html:${symbol}${quantity}`,
      source: "statement_html",
      kind: "corporate_action",
      symbol,
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      quantity,
      price: null,
      amount: 0,
      commission: null,
      currency: "USD",
      when: "2025-03-05T20:25:00.000Z",
      description: `${CHANGE} ${leg}`,
    });
    const { events: paired } = pairCorporateActions([
      ca("ZXAL", 505, `(ZXAL, EXAMPLE POWER INC, ${NEW})`),
      ca("ZXAL.OLD", -505, `(ZXAL.OLD, EXAMPLE HOST TECHNOLOGY INC, ${OLD})`),
    ]);
    expect(buildIdentities(inputs, paired).canonical("ZXAL", "2025-03-05T20:25:00.000Z")).toBe("ZXAM");
  });
});

describe("buildIdentities on an option whose underlying was converted 1 for 1 (rule 9)", () => {
  // TSTB became TSTC on 2026-04-03, a pure 1-for-1 merger. The option kept its
  // conid and merely changed spelling — but the statement was written after the
  // event, so its Contract Information knows only the new name. Nothing but the
  // event says the option was ever called TSTB.
  const OLD_ISIN = "US0000000012";
  const NEW_ISIN = "US0000000013";
  const WHEN_9 = "2026-04-03T20:25:00.000Z";
  const OPTION_OLD = "TSTB  270115C00002500";
  const OPTION_NEW = "TSTC  270115C00002500";

  const stocks = [
    input("700000021", [["TSTB", "2026-01-01", "2026-12-31"], ["TSTB.OLD", "2026-01-01", "2026-12-31"]], "STK", OLD_ISIN),
    input("700000022", [["TSTC", "2026-01-01", "2026-12-31"]], "STK", NEW_ISIN),
  ];
  const option = input("700000023", [[OPTION_NEW, "2026-01-01", "2026-12-31"]], "OPT");
  const event = {
    when: WHEN_9,
    from: { ticker: "TSTB.OLD", isin: OLD_ISIN, quantity: -975 },
    to: { ticker: "TSTC", isin: NEW_ISIN, quantity: 975 },
    cash: null,
    ids: [],
  };

  it("grafts the old spelling onto the option's class, and resolves it", () => {
    const identities = buildIdentities([...stocks, option], [event]);
    expect(identities.canonical(OPTION_OLD, "2026-03-04T13:06:53.000Z")).toBe(OPTION_NEW);
    expect(identities.canonical(OPTION_NEW, "2026-05-21T12:07:48.000Z")).toBe(OPTION_NEW);
    expect(identities.issues).toEqual([]);
  });

  it("does nothing at all without the event: the graft is what links them", () => {
    const identities = buildIdentities([...stocks, option]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses a merger that pays cash: the new contract is not the old one continued", () => {
    const identities = buildIdentities([...stocks, option], [{ ...event, cash: { amount: 1290.40, realizedPnl: 180.40 } }]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses a ratio that is not 1: the option's terms would have been adjusted", () => {
    const identities = buildIdentities([...stocks, option], [{ ...event, to: { ...event.to, quantity: 100 } }]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses an option already expired when the event happened", () => {
    const expired = input("700000024", [["TSTC  260101C00002500", "2026-01-01", "2026-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, expired], [event]);
    expect(identities.canonical("TSTB  260101C00002500", WHEN_9)).toBe("TSTB  260101C00002500");
  });

  it("refuses a spelling another class already claims: the file knows better", () => {
    const other = input("700000025", [[OPTION_OLD, "2025-01-01", "2025-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, option, other], [event]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
    expect(identities.issues).toEqual([]);
  });

  it("refuses a departure root that has no OSI spelling", () => {
    const longStocks = [
      input("700000021", [["TOOLONGX", "2026-01-01", "2026-12-31"]], "STK", OLD_ISIN),
      input("700000022", [["TSTC", "2026-01-01", "2026-12-31"]], "STK", NEW_ISIN),
    ];
    const identities = buildIdentities([...longStocks, option], [{ ...event, from: { ...event.from, ticker: "TOOLONGX" } }]);
    expect(identities.canonical(OPTION_NEW, WHEN_9)).toBe(OPTION_NEW);
    expect(identities.issues).toEqual([]);
  });

  it("does not let the grafted spelling become the class's canonical name", () => {
    const identities = buildIdentities([...stocks, option], [event]);
    expect(identities.canonical(OPTION_NEW, "2026-12-31T00:00:00.000Z")).toBe(OPTION_NEW);
  });

  // `lastSeen` is a file's *declared period*, not when it was written: a
  // statement whose window closes on or before the event's own day would
  // outrank the graft on date alone if `canonicalOf` still sorted by date
  // first. These two exercise exactly that, unlike the test above (whose
  // window runs to 2026-12-31 and would pass even without the fix).
  it("keeps the class's own name canonical when its alias window closes before the event", () => {
    const closesBefore = input("700000023", [[OPTION_NEW, "2026-01-01", "2026-04-02"]], "OPT");
    const identities = buildIdentities([...stocks, closesBefore], [event]);
    expect(identities.canonical(OPTION_NEW, "2026-04-02T00:00:00.000Z")).toBe(OPTION_NEW);
  });

  it("keeps the class's own name canonical when its alias window closes the same day as the event", () => {
    const closesSameDay = input("700000023", [[OPTION_NEW, "2026-01-01", "2026-04-03"]], "OPT");
    const identities = buildIdentities([...stocks, closesSameDay], [event]);
    expect(identities.canonical(OPTION_NEW, "2026-04-03T00:00:00.000Z")).toBe(OPTION_NEW);
  });

  it("skips the graft when the arrival spelling is claimed by more than one class", () => {
    // Two conids both wear OPTION_NEW: rule 6's own refusal applies to the
    // graft too, since nothing here says which of the two is the class the
    // event actually renamed.
    const rival = input("700000026", [[OPTION_NEW, "2025-01-01", "2025-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, option, rival], [event]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses the graft when a suffixed OCC root already wears these very terms: that class is where the renamed option went", () => {
    // TSTC already has its own option at these terms (`option`, above) — an
    // acquirer's pre-existing class, unrelated to the merger. The OCC gave
    // the acquired company's option, OPTION_OLD's real continuation, a
    // suffixed root (TSTC1) because its deliverable stopped being standard.
    // `option`'s class passes every other guard, but it is not proof: the
    // suffixed sibling is where the renamed option actually went, so the
    // graft onto `option` must be refused, silently.
    const suffixed = input("700000027", [["TSTC1 270115C00002500", "2026-01-01", "2026-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, option, suffixed], [event]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
    expect(identities.issues).toEqual([]);
  });

  it("still grafts normally when a suffixed root exists but at different terms", () => {
    // The suffixed sibling only rules out the graft when it wears the exact
    // same terms; a different strike proves nothing and must not close off
    // the ordinary case.
    const suffixed = input("700000027", [["TSTC1 270115C00003000", "2026-01-01", "2026-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, option, suffixed], [event]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_NEW);
  });
});

describe("buildIdentities chains two successive rule-9 renames (AAA -> BBB -> CCC)", () => {
  // A ticker renamed twice: the option is known only under its final
  // spelling, CCC, yet must resolve back from both AAA and BBB. The newest
  // event grafts BBB onto the option's class first; the older event then
  // finds BBB already there and grafts AAA from it.
  const AAA_ISIN = "US0000000021";
  const BBB_ISIN = "US0000000022";
  const CCC_ISIN = "US0000000023";
  const AAA_OPT = "AAA   270115C00002500";
  const BBB_OPT = "BBB   270115C00002500";
  const CCC_OPT = "CCC   270115C00002500";

  const stocks = [
    input("700000041", [["AAA", "2026-01-01", "2026-02-27"], ["AAA.OLD", "2026-02-28", "2026-02-28"]], "STK", AAA_ISIN),
    input("700000042", [["BBB", "2026-03-01", "2026-03-30"], ["BBB.OLD", "2026-03-31", "2026-03-31"]], "STK", BBB_ISIN),
    input("700000043", [["CCC", "2026-04-01", "2026-12-31"]], "STK", CCC_ISIN),
  ];
  const option = input("700000044", [[CCC_OPT, "2026-01-01", "2026-12-31"]], "OPT");
  const events = [
    { when: "2026-02-28T20:25:00.000Z", from: { ticker: "AAA.OLD", isin: AAA_ISIN, quantity: -1000 }, to: { ticker: "BBB", isin: BBB_ISIN, quantity: 1000 }, cash: null, ids: [] },
    { when: "2026-03-31T20:25:00.000Z", from: { ticker: "BBB.OLD", isin: BBB_ISIN, quantity: -1000 }, to: { ticker: "CCC", isin: CCC_ISIN, quantity: 1000 }, cash: null, ids: [] },
  ];

  it("resolves both the first and the second spelling to the final one", () => {
    const identities = buildIdentities([...stocks, option], events);
    expect(identities.canonical(AAA_OPT, "2026-01-15T00:00:00.000Z")).toBe(CCC_OPT);
    expect(identities.canonical(BBB_OPT, "2026-03-10T00:00:00.000Z")).toBe(CCC_OPT);
    expect(identities.issues).toEqual([]);
  });
});
