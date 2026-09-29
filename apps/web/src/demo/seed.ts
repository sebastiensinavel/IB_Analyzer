import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import type { AppDatabase } from "@/db/schema";
import { mergeSectorsInto, type SectorCsvRow } from "@/db/sectors";
import { DEMO_ACCOUNT_ID } from "@/demo/mode";
import { DEMO_IB_ACCOUNT, generateDemo } from "@/demo/generate";

/** The demo's sector table: every ticker of the scenario, with a category and a score (status left empty, "no status"). */
export const DEMO_SECTORS: readonly SectorCsvRow[] = [
  { ticker: "AAPL", name: "Apple", category: "Technologie", score: 8, status: "" },
  { ticker: "AMD", name: "Advanced Micro Devices", category: "Semi-conducteurs", score: 6, status: "" },
  { ticker: "KO", name: "Coca-Cola", category: "Consommation de base", score: 7, status: "" },
  { ticker: "MSFT", name: "Microsoft", category: "Technologie", score: 9, status: "" },
  { ticker: "NVDA", name: "NVIDIA", category: "Semi-conducteurs", score: 8, status: "" },
  { ticker: "JPM", name: "JPMorgan Chase", category: "Finance", score: 7, status: "" },
  { ticker: "DIS", name: "Walt Disney", category: "Communication", score: 5, status: "" },
  { ticker: "XSP", name: "Mini-SPX", category: "Indice", score: 7, status: "" },
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
