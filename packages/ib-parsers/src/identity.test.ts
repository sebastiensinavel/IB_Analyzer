import { describe, expect, it } from "vitest";
import { mergeIdentities, type ContractIdentity } from "./identity.ts";

const base = { isin: "", secType: "STK", currency: "USD", description: "" };

describe("mergeIdentities", () => {
  it("unions the tickers of one conid seen in two files", () => {
    const a: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAB"] };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZXABQ"] };
    expect(mergeIdentities([[a], [b]])).toEqual([{ ...base, conid: "1", tickers: ["ZXAB", "ZXABQ"] }]);
  });

  it("keeps distinct conids apart and preserves first-seen order", () => {
    const a: ContractIdentity = { ...base, conid: "2", tickers: ["ZXAA"] };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAA"] };
    expect(mergeIdentities([[a], [b]]).map((i) => i.conid)).toEqual(["2", "1"]);
  });

  it("never repeats a ticker already known for that conid", () => {
    const a: ContractIdentity = { ...base, conid: "1", tickers: ["ZQA", "ZQA.OLD"] };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZQA"] };
    expect(mergeIdentities([[a], [b]])[0].tickers).toEqual(["ZQA", "ZQA.OLD"]);
  });

  it("fills a field left empty by the first sighting from a later one", () => {
    const a: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAI"], isin: "" };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAI"], isin: "US00653A1079", description: "EXAMPLE" };
    const [merged] = mergeIdentities([[a], [b]]);
    expect(merged.isin).toBe("US00653A1079");
    expect(merged.description).toBe("EXAMPLE");
  });

  it("drops an entry without a conid: it identifies nothing", () => {
    const a: ContractIdentity = { ...base, conid: "", tickers: ["EUR.USD"] };
    expect(mergeIdentities([[a]])).toEqual([]);
  });
});
