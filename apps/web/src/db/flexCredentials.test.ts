import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./schema";
import { clearFlexCredentials, setFlexCredentials } from "./accounts";

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put({
    id: "beta",
    label: "Beta",
    ibAccountId: "U1234567",
    createdAt: "2026-09-01T00:00:00.000Z",
    warnedDroppedKinds: [],
  });
});

describe("setFlexCredentials", () => {
  it("stores the token and the query id on the account", async () => {
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "123" });
    expect(await db.accounts.get("beta")).toMatchObject({ flexToken: "tok", flexQueryId: "123" });
  });

  it("never stores a blank credential", async () => {
    await setFlexCredentials(db, "beta", { token: "  ", queryId: "" });
    const account = await db.accounts.get("beta");
    expect(account?.flexToken).toBeUndefined();
    expect(account?.flexQueryId).toBeUndefined();
  });

  // An empty field used to mean "clear". The form never shows a stored token, so someone
  // coming back to fix only the query id types nothing in the token box — and silently lost
  // their token. Blank now means "leave it as it is"; erasing is `clearFlexCredentials`.
  it("leaves a stored credential alone when its field is blank", async () => {
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "123" });
    await setFlexCredentials(db, "beta", { token: "", queryId: "456" });
    expect(await db.accounts.get("beta")).toMatchObject({ flexToken: "tok", flexQueryId: "456" });

    await setFlexCredentials(db, "beta", { token: "  ", queryId: "  " });
    expect(await db.accounts.get("beta")).toMatchObject({ flexToken: "tok", flexQueryId: "456" });
  });

  it("erases both only on the explicit clear", async () => {
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "123" });
    await clearFlexCredentials(db, "beta");
    const account = await db.accounts.get("beta");
    expect(account?.flexToken).toBeUndefined();
    expect(account?.flexQueryId).toBeUndefined();
  });

  it("leaves the sync state alone", async () => {
    await db.accounts.update("beta", { lastFlexSyncAt: "2026-09-03T00:00:00.000Z" });
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "1" });
    expect((await db.accounts.get("beta"))?.lastFlexSyncAt).toBe("2026-09-03T00:00:00.000Z");
  });
});
