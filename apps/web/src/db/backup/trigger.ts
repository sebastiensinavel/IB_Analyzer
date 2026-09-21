import type { AppDatabase } from "../schema";
import { BACKUP_TABLES } from "./payload";

/** Thirty seconds: long enough to fold an import's many writes into one deposit. */
export const BACKUP_DEBOUNCE_MS = 30_000;

/**
 * Every table of the payload except `snapshots`.
 *
 * The rule of spec §5.3 in one line: we back up what does not rebuild itself. The agent
 * writes a snapshot on every poll, a few seconds apart, and would push megabytes in a loop
 * all session long; its snapshot is rebuilt by the next poll anyway. Scoping by table
 * rather than by call site is deliberate — a future writer cannot forget to call us.
 */
export const TRIGGER_TABLES: readonly string[] = BACKUP_TABLES.filter((name) => name !== "snapshots");

let suppressed = 0;

/** A restore rewrites every table; it must not push what it has just pulled. */
export async function suppressBackupTrigger<T>(run: () => Promise<T>): Promise<T> {
  suppressed += 1;
  try {
    return await run();
  } finally {
    suppressed -= 1;
  }
}

export function installBackupTrigger(db: AppDatabase, onChange: () => void): () => void {
  const fire = () => {
    if (suppressed === 0) onChange();
  };
  const unsubscribes: (() => void)[] = [];
  for (const name of TRIGGER_TABLES) {
    const table = db.table(name);
    // Dexie's `hook` is overloaded per event name with a distinct subscriber signature for
    // each; a union-typed `event` cannot select one, so each event is registered by its own
    // literal call rather than looped over.
    table.hook("creating", fire);
    table.hook("updating", fire);
    table.hook("deleting", fire);
    for (const event of ["creating", "updating", "deleting"] as const) {
      unsubscribes.push(() => table.hook(event).unsubscribe(fire));
    }
  }
  return () => {
    for (const off of unsubscribes) off();
  };
}
