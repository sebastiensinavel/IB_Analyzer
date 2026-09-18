import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, clearFlexCredentials, createAccount, deleteAccount, setFlexRelay, slugify } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  window.localStorage.clear();
});

describe("slugify", () => {
  it("lowercases, strips accents and joins with dashes", () => {
    expect(slugify("Compte Élodie 2")).toBe("compte-elodie-2");
    expect(slugify("  beta ")).toBe("beta");
    expect(slugify("!!!")).toBe("");
  });
});

describe("createAccount", () => {
  it("stores the account under its slug with a normalized IB id", async () => {
    const account = await createAccount(db, { label: "Beta", ibAccountId: " u1234567 " });
    expect(account).toMatchObject({ id: "beta", label: "Beta", ibAccountId: "U1234567", warnedDroppedKinds: [] });
    expect(await db.accounts.get("beta")).toMatchObject({ label: "Beta" });
  });

  it("refuses an empty label", async () => {
    await expect(createAccount(db, { label: " ", ibAccountId: "U1234567" })).rejects.toMatchObject({ code: "label-empty" });
  });

  it("refuses an IB id that does not look like one", async () => {
    await expect(createAccount(db, { label: "x", ibAccountId: "hello" })).rejects.toMatchObject({ code: "ib-account-id-invalid" });
  });

  it("accepts a paper account id", async () => {
    await expect(createAccount(db, { label: "paper", ibAccountId: "DU1234567" })).resolves.toMatchObject({ ibAccountId: "DU1234567" });
  });

  it("refuses a second account with the same slug", async () => {
    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
    await expect(createAccount(db, { label: "beta", ibAccountId: "U7654321" })).rejects.toBeInstanceOf(AccountError);
    expect(await db.accounts.count()).toBe(1);
  });
});

describe("deleteAccount", () => {
  it("removes the account with its transactions and imports, and forgets it as last visited", async () => {
    await createAccount(db, { label: "a", ibAccountId: "U1111111" });
    await createAccount(db, { label: "b", ibAccountId: "U2222222" });
    await db.transactions.bulkAdd([
      { accountId: "a", externalId: "x" } as never,
      { accountId: "b", externalId: "y" } as never,
    ]);
    await db.imports.add({ accountId: "a", source: "flex", at: "", fileName: "", period: null, imported: 0, skipped: 0, dropped: [], issues: [] });
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "a" });
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "b" });
    const statement = { fileName: "s.htm", period: { start: "2025-01-01", end: "2025-12-31" }, importedAt: "", text: "<html/>", bytes: 7 };
    await db.statements.bulkPut([
      { ...statement, id: "a|2025-01-01|2025-12-31", accountId: "a" },
      { ...statement, id: "b|2025-01-01|2025-12-31", accountId: "b" },
    ]);
    const contract = { isin: "", secType: "STK", currency: "USD", description: "", aliases: [], updatedAt: "" };
    await db.contracts.bulkPut([
      { ...contract, accountId: "a", conid: "1" },
      { ...contract, accountId: "b", conid: "2" },
    ]);
    const cashPoint = { currency: "USD", kind: "end" as const, asOf: "2025-12-31", amount: 1, source: "flex" as const, importedAt: "" };
    await db.cashPoints.bulkPut([
      { ...cashPoint, accountId: "a" },
      { ...cashPoint, accountId: "b" },
    ]);
    setLastAccountId("a");

    await deleteAccount(db, "a");

    expect(await db.accounts.toArray()).toHaveLength(1);
    expect(await db.transactions.toArray()).toEqual([{ accountId: "b", externalId: "y" }]);
    expect(await db.imports.count()).toBe(0);
    expect((await db.snapshots.toArray()).map((s) => s.accountId)).toEqual(["b"]);
    expect((await db.statements.toArray()).map((s) => s.accountId)).toEqual(["b"]);
    expect((await db.contracts.toArray()).map((c) => c.accountId)).toEqual(["b"]);
    expect((await db.cashPoints.toArray()).map((p) => p.accountId)).toEqual(["b"]);
    expect(getLastAccountId()).toBeNull();
  });

  it("forgets the table views and page searches of the deleted account only", async () => {
    await createAccount(db, { label: "a", ibAccountId: "U1111111" });
    await createAccount(db, { label: "b", ibAccountId: "U2222222" });
    window.localStorage.setItem("ib2:tableView:a:history", JSON.stringify({ v: 1, sort: [], criteria: { amount: ">0" } }));
    window.localStorage.setItem("ib2:pageSearch:a:positions", JSON.stringify({ v: 1, text: "AAPL" }));
    window.localStorage.setItem("ib2:tableView:b:history", JSON.stringify({ v: 1, sort: [], criteria: { amount: ">0" } }));
    await deleteAccount(db, "a");
    expect(window.localStorage.getItem("ib2:tableView:a:history")).toBeNull();
    expect(window.localStorage.getItem("ib2:pageSearch:a:positions")).toBeNull();
    expect(window.localStorage.getItem("ib2:tableView:b:history")).not.toBeNull();
  });
});

describe("setFlexRelay", () => {
  it("stores the chosen relay, and clearing the credentials keeps it", async () => {
    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
    expect((await db.accounts.get("beta"))?.flexRelay).toBeUndefined();

    await setFlexRelay(db, "beta", "agent-and-server");
    expect((await db.accounts.get("beta"))?.flexRelay).toBe("agent-and-server");

    await setFlexRelay(db, "beta", "agent");
    expect((await db.accounts.get("beta"))?.flexRelay).toBe("agent");

    await setFlexRelay(db, "beta", "agent-and-server");
    await clearFlexCredentials(db, "beta");
    expect((await db.accounts.get("beta"))?.flexRelay).toBe("agent-and-server");
  });
});
