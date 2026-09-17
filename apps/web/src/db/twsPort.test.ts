import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, setTwsPort } from "./accounts";
import { db } from "./schema";

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put({ id: "beta", label: "Beta", ibAccountId: "U1234567", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [] });
});

describe("setTwsPort", () => {
  it("stores the port", async () => {
    await setTwsPort(db, "beta", 7502);
    expect((await db.accounts.get("beta"))?.twsPort).toBe(7502);
  });

  it("clears it on null", async () => {
    await setTwsPort(db, "beta", 7502);
    await setTwsPort(db, "beta", null);
    expect((await db.accounts.get("beta"))?.twsPort).toBeUndefined();
  });

  it.each([0, 65536, 7502.5, Number.NaN])("refuses %s without touching the record", async (port) => {
    await setTwsPort(db, "beta", 7502);
    await expect(setTwsPort(db, "beta", port)).rejects.toBeInstanceOf(AccountError);
    await expect(setTwsPort(db, "beta", port)).rejects.toMatchObject({ code: "tws-port-invalid" });
    expect((await db.accounts.get("beta"))?.twsPort).toBe(7502);
  });

  it("leaves the Flex fields and the agent sync state alone", async () => {
    await db.accounts.update("beta", { flexToken: "tok", lastAgentSyncAt: "2026-09-06T13:00:00.000Z" });
    await setTwsPort(db, "beta", 7502);
    expect(await db.accounts.get("beta")).toMatchObject({ flexToken: "tok", lastAgentSyncAt: "2026-09-06T13:00:00.000Z" });
  });

  it("clears a stale failure badge when the port is cleared, so it does not sit forever with no port even configured any more", async () => {
    await db.accounts.update("beta", { twsPort: 7502, lastAgentSyncStatus: { at: "2026-09-06T13:00:00.000Z", ok: false, code: "tws-unreachable" } });
    await setTwsPort(db, "beta", null);
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus).toBeUndefined();
  });

  it("does not touch an existing failure badge when setting a new, valid port", async () => {
    await db.accounts.update("beta", { lastAgentSyncStatus: { at: "2026-09-06T13:00:00.000Z", ok: false, code: "tws-unreachable" } });
    await setTwsPort(db, "beta", 7503);
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus).toEqual({ at: "2026-09-06T13:00:00.000Z", ok: false, code: "tws-unreachable" });
  });
});
