import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import type { AppDatabase } from "@/db/schema";
import { mergeSectorsInto, type SectorCsvRow } from "@/db/sectors";
import { DEMO_ACCOUNT_ID } from "@/demo/mode";
import { DEMO_IB_ACCOUNT, generateDemo } from "@/demo/generate";

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

/** Writes the demo account on an empty demo base, once, in one transaction (sub-project 41, spec §4.2). */
export async function ensureDemoSeeded(db: AppDatabase, now = new Date()): Promise<void> {
  if (await db.accounts.get(DEMO_ACCOUNT_ID)) return;
  const world = generateDemo(now);
  const at = now.toISOString();
  await db.transaction("rw", [db.accounts, db.transactions, db.snapshots, db.cashPoints, db.sectors], async () => {
    // Two tabs opening the demo at once: the second finds the first one's work and stops.
    if (await db.accounts.get(DEMO_ACCOUNT_ID)) return;
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
    // Merged like a CSV import, never replaced: the sector table's one rule holds in the demo too.
    await mergeSectorsInto(db, DEMO_SECTORS, at);
  });
}
