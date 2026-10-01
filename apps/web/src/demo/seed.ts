import { roundToCent, type ManualAlertDef } from "@ib/alerts";
import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import type { AppDatabase } from "@/db/schema";
import { mergeSectorsInto, type SectorCsvRow } from "@/db/sectors";
import { DEMO_ACCOUNT_ID } from "@/demo/mode";
import { DEMO_IB_ACCOUNT, generateDemo } from "@/demo/generate";
import { setDemoSeedInstant } from "@/demo/agent";
import { referenceDay } from "@/demo/calendar";
import { closeAgo } from "@/demo/prices";

/**
 * The demo's sector table: every ticker of the scenario. Short English sectors, read alike in both
 * languages and narrow enough for the Sector column; every row "on", so the dashboard's position
 * suggestion has candidates (score ≥ MIN_SUGGESTION_SCORE, DIS below on purpose).
 */
export const DEMO_SECTORS: readonly SectorCsvRow[] = [
  { ticker: "AAPL", name: "Apple", category: "Tech", score: 8, status: "on" },
  { ticker: "AMD", name: "Advanced Micro Devices", category: "Semis", score: 6, status: "on" },
  { ticker: "KO", name: "Coca-Cola", category: "Staples", score: 7, status: "on" },
  { ticker: "MSFT", name: "Microsoft", category: "Tech", score: 9, status: "on" },
  { ticker: "NVDA", name: "NVIDIA", category: "Semis", score: 8, status: "on" },
  { ticker: "JPM", name: "JPMorgan Chase", category: "Financials", score: 7, status: "on" },
  { ticker: "DIS", name: "Walt Disney", category: "Media", score: 5, status: "on" },
  { ticker: "XSP", name: "Mini-SPX", category: "Index", score: 7, status: "on" },
];

/**
 * The demo's two manual alerts, computed from the day's close the demo agent serves, never hard-coded:
 * NVDA is already below its level (triggered at the first evaluation), MSFT still has 6 % to climb
 * (active). Stable ids: a seed rewritten on a new day replaces them, never duplicates them. Their notes
 * are codes (`demo:support`), shown in the interface's language by `alertNoteText`.
 */
export function demoAlerts(at: string): (ManualAlertDef & { accountId: string })[] {
  return [
    { id: "manual:demo-nvda", accountId: DEMO_ACCOUNT_ID, ticker: "NVDA", direction: "below", price: roundToCent(closeAgo("NVDA", 0) * 1.02), note: "demo:support", createdAt: at },
    { id: "manual:demo-msft", accountId: DEMO_ACCOUNT_ID, ticker: "MSFT", direction: "above", price: roundToCent(closeAgo("MSFT", 0) * 1.06), note: "demo:resistance", createdAt: at },
  ];
}

/** A demo account seeded on the reference day of `now`: kept as is. */
function seededFor(account: { createdAt: string } | undefined, now: Date): boolean {
  return account !== undefined && referenceDay(new Date(account.createdAt)) === referenceDay(now);
}

/**
 * Writes the demo account on an empty demo base, in one transaction (sub-project 41, spec §4.2).
 * Seeded on another visit day, the demo account is dropped and seeded again: the scenario ends on
 * the reference day, and the agent's world is the seed's (`setDemoSeedInstant`), never the clock's.
 */
export async function ensureDemoSeeded(db: AppDatabase, now = new Date()): Promise<void> {
  const existing = await db.accounts.get(DEMO_ACCOUNT_ID);
  if (existing && seededFor(existing, now)) {
    setDemoSeedInstant(new Date(existing.createdAt));
    return;
  }
  const world = generateDemo(now);
  const at = now.toISOString();
  let seededAt = at;
  await db.transaction("rw", [db.accounts, db.transactions, db.snapshots, db.cashPoints, db.contracts, db.sectors, db.alerts, db.alertStates], async () => {
    // Two tabs opening the demo at once: the second finds the first one's work and stops.
    const current = await db.accounts.get(DEMO_ACCOUNT_ID);
    if (current && seededFor(current, now)) {
      seededAt = current.createdAt;
      return;
    }
    for (const table of [db.transactions, db.snapshots, db.cashPoints, db.contracts, db.alerts, db.alertStates]) {
      await table.where("accountId").equals(DEMO_ACCOUNT_ID).delete();
    }
    await db.accounts.put({
      id: DEMO_ACCOUNT_ID,
      label: "Démo",
      ibAccountId: DEMO_IB_ACCOUNT,
      createdAt: at,
      warnedDroppedKinds: [],
      twsPort: 7496,
      strategies: [...ACTIVABLE_STRATEGIES],
    });
    await db.transactions.bulkPut(world.transactions);
    // A Flex snapshot on the reference day: the app never opens without one; the first pass
    // of the simulated agent replaces it (spec §6).
    await db.snapshots.put({
      accountId: DEMO_ACCOUNT_ID,
      source: "flex",
      asOf: world.reference,
      importedAt: at,
      positions: world.positions,
      cashAvailable: world.cashAvailable,
    });
    await db.cashPoints.bulkPut(world.cashPoints);
    await db.alerts.bulkPut(demoAlerts(at));
    // Merged like a CSV import, never replaced: the sector table's one rule holds in the demo too.
    await mergeSectorsInto(db, DEMO_SECTORS, at);
  });
  setDemoSeedInstant(new Date(seededAt));
}
