import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase, db } from "./schema";
import { DEFAULT_PROFILE_DB, adoptDefaultProfile, profileDb, profileDbName } from "./profile";

const USER = "42";

async function seedDefault() {
  await db.open();
  await db.accounts.put({
    id: "beta",
    label: "Beta",
    ibAccountId: "U1234567",
    createdAt: "2026-09-01T00:00:00.000Z",
    warnedDroppedKinds: [],
  });
  await db.sectors.put({
    ticker: "AANZ",
    name: "EXAMPLE OPTICS",
    category: "Tech",
    score: 3,
    status: "core",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

beforeEach(async () => {
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

afterEach(async () => {
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

describe("profileDbName", () => {
  it("names the anonymous profile and one database per user", () => {
    expect(profileDbName(null)).toBe(DEFAULT_PROFILE_DB);
    expect(profileDbName(USER)).toBe(`${DEFAULT_PROFILE_DB}-${USER}`);
  });

  it("returns the same instance for the same profile", () => {
    expect(profileDb(USER)).toBe(profileDb(USER));
    expect(profileDb(USER)).not.toBe(profileDb(null));
  });
});

describe("adoptDefaultProfile", () => {
  it("moves every table into the user profile and removes the source", async () => {
    await seedDefault();

    expect(await adoptDefaultProfile(USER)).toBe(true);

    const adopted = new AppDatabase(profileDbName(USER));
    await adopted.open();
    expect(await adopted.accounts.get("beta")).toMatchObject({ label: "Beta" });
    expect(await adopted.sectors.get("AANZ")).toMatchObject({ category: "Tech" });
    expect(await Dexie.exists(DEFAULT_PROFILE_DB)).toBe(false);
  });

  it("adopts nothing a second time and leaves a regarnished default alone", async () => {
    await seedDefault();
    await adoptDefaultProfile(USER);

    const second = profileDb(null);
    await second.open();
    await second.accounts.put({
      id: "alpha",
      label: "Alpha",
      ibAccountId: "U7654321",
      createdAt: "2026-09-02T00:00:00.000Z",
      warnedDroppedKinds: [],
    });

    expect(await adoptDefaultProfile(USER)).toBe(false);

    const adopted = new AppDatabase(profileDbName(USER));
    await adopted.open();
    expect(await adopted.accounts.get("alpha")).toBeUndefined();
    expect(await second.accounts.get("alpha")).toMatchObject({ label: "Alpha" });
  });

  it("adopts nothing when there is no default profile at all", async () => {
    expect(await adoptDefaultProfile(USER)).toBe(false);
  });
});

describe("adoptDefaultProfile races", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets only one of two concurrent callers adopt", async () => {
    await seedDefault();

    const [a, b] = await Promise.all([adoptDefaultProfile(USER), adoptDefaultProfile(USER)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const adopted = new AppDatabase(profileDbName(USER));
    await adopted.open();
    expect(await adopted.accounts.get("beta")).toMatchObject({ label: "Beta" });
  });

  /**
   * Reproduces the trace a plain check-then-act would fall into: a second
   * caller reads its (soon to be stale) snapshot of the default profile
   * before either caller has written anything, then — instead of writing
   * back-to-back with the first — sits on that snapshot while the first
   * caller finishes adopting and the user edits a record in the
   * newly-adopted profile. Only once that edit has landed does the second
   * caller's own write attempt (gated below via `AppDatabase.prototype.open`,
   * standing in for "this tab was slower to reach IndexedDB", not for
   * StrictMode's same-tick double effect) get to run.
   *
   * A plain check-then-act reverts the edit here: this is the scenario the
   * `populate` gate in `adoptDefaultProfile` exists to close. Confirmed by
   * running this exact test against the pre-fix implementation (a manual
   * check made once and recorded in the task report, not repeated on every
   * run): the assertion below failed, the label came back as "Beta"
   * instead of "Beta (edited by A)".
   */
  it("does not let a slow second caller revert an edit made after the first caller adopted", async () => {
    await seedDefault();

    const targetName = profileDbName(USER);
    let bReachedGate = false;
    let releaseGate: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gatedOnce = false;
    const originalOpen = AppDatabase.prototype.open;
    vi.spyOn(AppDatabase.prototype, "open").mockImplementation(function (this: AppDatabase) {
      if (this.name === targetName && !gatedOnce) {
        gatedOnce = true;
        bReachedGate = true;
        return gate.then(() => originalOpen.apply(this)) as ReturnType<typeof originalOpen>;
      }
      return originalOpen.apply(this);
    });

    // B: starts first, so it captures the earliest (soon to be stale) read
    // of the default profile, then stalls right before writing to `target`.
    const bPromise = adoptDefaultProfile(USER);
    await vi.waitFor(() => expect(bReachedGate).toBe(true));

    // A: runs to completion on its own — the *first* real `open()` call
    // reaching IndexedDB for `targetName`, since B's is still gated.
    expect(await adoptDefaultProfile(USER)).toBe(true);

    // The user edits the freshly-adopted profile, in the window between A
    // finishing and B's stale write landing.
    const adopted = profileDb(USER);
    await adopted.accounts.update("beta", { label: "Beta (edited by A)" });

    // Let B's stale write proceed.
    releaseGate!();
    expect(await bPromise).toBe(false);

    expect(await adopted.accounts.get("beta")).toMatchObject({ label: "Beta (edited by A)" });
  });
});
