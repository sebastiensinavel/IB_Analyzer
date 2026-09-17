import Dexie from "dexie";
import { AppDatabase, db } from "./schema";

/** The profile of whoever is not logged in. Also the one adoption consumes. */
export const DEFAULT_PROFILE_DB = "ib-analyzer";

export function profileDbName(userId: string | null): string {
  return userId === null ? DEFAULT_PROFILE_DB : `${DEFAULT_PROFILE_DB}-${userId}`;
}

const opened = new Map<string, AppDatabase>([[DEFAULT_PROFILE_DB, db]]);

export function profileDb(userId: string | null): AppDatabase {
  const name = profileDbName(userId);
  let instance = opened.get(name);
  if (!instance) {
    instance = new AppDatabase(name);
    opened.set(name, instance);
  }
  return instance;
}

/**
 * First login of a user who has no profile yet: the anonymous profile becomes
 * theirs, so nothing is lost by someone who started without an account. Runs
 * at most once per user; afterwards the default profile is a separate, intact
 * profile of its own.
 *
 * The two `Dexie.exists` checks below are not enough by themselves to make
 * this safe: they are a plain check-then-act, and nothing stops a second
 * caller — a second tab opened right after the same first login is the
 * realistic trigger, not just React StrictMode's double effect — from
 * passing both checks on the same stale snapshot of the default profile
 * before either has written anything. If that second caller were left free
 * to write later, on its own schedule, it could silently revert an edit the
 * first caller's (by then already adopted and in use) profile received in
 * between.
 *
 * The actual exclusion is `target`'s `populate` event: it fires inside the
 * version-change transaction IndexedDB runs exactly once, the first time a
 * database is created — and the spec serializes concurrent `open()` calls
 * for a database that does not exist yet, across every tab sharing the
 * origin, not just within this one. So at most one caller's `populate`
 * handler ever runs for a given target name, no matter how many races here
 * with the same stale rows: the loser's `open()` simply connects to the
 * database the winner already created, without ever re-triggering
 * `populate`, and its captured rows are discarded, never written.
 */
export async function adoptDefaultProfile(userId: string): Promise<boolean> {
  const targetName = profileDbName(userId);
  if (await Dexie.exists(targetName)) return false;
  if (!(await Dexie.exists(DEFAULT_PROFILE_DB))) return false;

  const source = profileDb(null);
  await source.open();
  const rows = await Promise.all(
    source.tables.map(async (table) => [table.name, await table.toArray()] as const),
  );

  let won = false;
  const target = new AppDatabase(targetName);
  target.on("populate", (trans) => {
    won = true;
    return Promise.all(
      rows.filter(([, items]) => items.length > 0).map(([name, items]) => trans.table(name).bulkPut(items)),
    );
  });
  await target.open();

  if (!won) {
    // Someone else's `populate` won the race (or the target was created,
    // possibly still empty, between our two checks above and here): nothing
    // below was written by us, so there is nothing here to undo.
    target.close();
    return false;
  }

  opened.set(targetName, target);

  source.close();
  opened.delete(DEFAULT_PROFILE_DB);
  await Dexie.delete(DEFAULT_PROFILE_DB);
  // `db` is the module singleton for the default profile: reopening it later
  // recreates an empty database, which is exactly what we want.
  opened.set(DEFAULT_PROFILE_DB, db);
  return true;
}
