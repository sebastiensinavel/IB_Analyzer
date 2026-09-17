/// <reference types="node" />
// The real files of alpha, on the author's machine only: every yearly statement of the
// account, then the Flex response, imported through `importFile` exactly as the browser does and
// reconciled the way `useJournals` and the History do. This account's statements reach back to
// its opening, so the cash owes a Starting Cash of zero.
//
// No file is named here: the Flex response is the one that sits beside statements of its own
// account (`privateFiles.ts`), the statements are found by reading `private/` and keeping those
// that carry the Flex's own IB account id, and
// ordered by the period each one declares, exactly as `replayStatements` does. No ticker and no
// amount is written either: writing them down would commit the account's holdings.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { anchoredBalances, buildIdentities, buildJournals, CASH_CHECK_TOLERANCE, DEFAULT_MULTIPLIER, dayOf, isCashCheckOk, pairCorporateActions, runningBalances, type JournalRow } from "@ib/ledger";
import { parseActivityStatement } from "@ib/ib-parsers";
import { readIdentityInputs } from "@/db/contracts";
import { importFile } from "@/db/importFile";
import { AppDatabase, type AccountRecord } from "@/db/schema";
import { alphaFlex, PRIVATE_DIR } from "../../../../packages/ib-parsers/src/privateFiles.ts";

const FLEX = alphaFlex();

// Names only, no content: vitest runs a skipped describe's factory body, so
// anything heavier belongs inside the it() itself.
const present = FLEX !== null;

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`alpha-${crypto.randomUUID()}`);
});

const asFile = (name: string, text: string) => new File([text], name, { type: "text/plain" });

/** The account, created from the Flex's own IB account id. */
async function openAccount(): Promise<{ account: AccountRecord; flex: string }> {
  const flex = readFileSync(FLEX!.path, "utf8");
  const ibAccountId = /accountId="([^"]+)"/.exec(flex)?.[1] ?? "";
  expect(ibAccountId).not.toBe("");
  const account: AccountRecord = { id: "alpha", label: "Alpha", ibAccountId, createdAt: "", warnedDroppedKinds: [] };
  await db.accounts.put(account);
  return { account, flex };
}

/** Every statement of the account, oldest declared period first. */
function statementsOf(ibAccountId: string) {
  const statements = readdirSync(PRIVATE_DIR)
    .filter((name) => name.endsWith(".htm"))
    .map((name) => ({ name, text: readFileSync(path.join(PRIVATE_DIR, name), "utf8") }))
    .filter(({ text }) => text.includes(ibAccountId))
    // The parser is the only judge of a statement's period, hence of the
    // order the files must be replayed in (`db/replayStatements.ts`).
    .map((file) => ({ ...file, statement: parseActivityStatement(file.text, { accountId: "alpha", ibAccountId }).statement }))
    .sort((a, b) => (a.statement!.periodStart < b.statement!.periodStart ? -1 : 1));
  expect(statements.length).toBeGreaterThan(1);
  return statements;
}

/** The journals report `useJournals` would build, and the identity table it rests on. */
async function journals() {
  const ledger = await db.transactions.where("accountId").equals("alpha").toArray();
  const snapshot = await db.snapshots.get("alpha");
  const { events } = pairCorporateActions(ledger);
  const identities = buildIdentities(await readIdentityInputs(db, "alpha"), events);
  return { snapshot, identities, report: buildJournals(ledger, snapshot && { asOf: snapshot.asOf, positions: snapshot.positions }, identities) };
}

/** The anchored rows and cash checks the History would show. */
async function cashChecks() {
  const ledger = await db.transactions.where("accountId").equals("alpha").toArray();
  const points = await db.cashPoints.where("accountId").equals("alpha").toArray();
  return anchoredBalances(ledger, ["USD", "EUR"], points);
}

/**
 * Instants where a covered call took shares over although the Wheel already held
 * enough free ones (sub-project 17, §3). Counted, never named: naming them would
 * commit the account's holdings. Rebuilt from the rows alone, at the call's instant:
 * a Wheel share row counts if it opened before and was still open, a Wheel call row
 * if it opened before and was not bought back at that very instant — option closes
 * of an instant run before its openings.
 */
function needlessTakeovers(rows: readonly JournalRow[]): number {
  const takeovers = new Map<string, { ticker: string; when: string; shares: number }>();
  for (const row of rows) {
    if (row.event !== "integrated" || row.endWhen === null) continue;
    const key = `${row.ticker}@${row.endWhen}`;
    const entry = takeovers.get(key) ?? { ticker: row.ticker, when: row.endWhen, shares: 0 };
    entry.shares += row.quantity ?? 0;
    takeovers.set(key, entry);
  }
  let needless = 0;
  for (const { ticker, when, shares } of takeovers.values()) {
    const wheel = rows.filter((r) => r.strategy === "wheel" && r.ticker === ticker);
    const held = wheel.filter((r) => r.kind === "shares" && r.startWhen < when && (r.endWhen === null || r.endWhen >= when)).reduce((n, r) => n + (r.quantity ?? 0), 0);
    const covered = wheel.filter((r) => r.kind === "short_call" && r.startWhen < when && (r.endWhen === null || r.endWhen > when)).reduce((n, r) => n + Math.abs(r.quantity ?? 0), 0);
    const sold = wheel.filter((r) => r.kind === "short_call" && r.startWhen === when).reduce((n, r) => n + Math.abs(r.quantity ?? 0), 0);
    const free = Math.max(0, held / DEFAULT_MULTIPLIER - covered);
    const missing = Math.max(0, sold - free);
    if (shares > missing * DEFAULT_MULTIPLIER + 1e-6) needless++;
  }
  return needless;
}

describe.skipIf(!present)("the real ledger of alpha", () => {
  it("reads every statement without a single warning", { timeout: 300_000 }, async () => {
    const { account } = await openAccount();
    for (const { text, statement } of statementsOf(account.ibAccountId)) {
      // Named by its period, never its file name: the name carries the account id.
      const { issues } = parseActivityStatement(text, { accountId: "alpha", ibAccountId: account.ibAccountId });
      expect({ period: statement!.periodStart, issues }).toEqual({ period: statement!.periodStart, issues: [] });
    }
  });

  it("replays every statement and the Flex back to the snapshot: zero difference", { timeout: 300_000 }, async () => {
    const { account, flex } = await openAccount();
    for (const { name, text } of [...statementsOf(account.ibAccountId), { name: path.basename(FLEX!.path), text: flex }]) {
      const report = await importFile(db, account, asFile(name, text));
      expect(report.status).toBe("ok");
    }

    const { report, identities } = await journals();
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);
    expect(identities.issues).toEqual([]);
  });

  it("replays the statements alone: not one difference left, and the cash comes back to zero", { timeout: 300_000 }, async () => {
    const { account } = await openAccount();
    for (const { name, text } of statementsOf(account.ibAccountId)) {
      expect((await importFile(db, account, asFile(name, text))).status).toBe("ok");
    }

    const { snapshot, report, identities } = await journals();
    expect(snapshot?.source).toBe("statement_html");
    // Sub-project 10: the two options the statements name by their underlying
    // and that IB renamed mid-life are one contract again, exactly as they are
    // with Flex. Statements alone now reconstruct the portfolio whole.
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);
    expect(identities.issues).toEqual([]);
    // Sub-project 17: a covered call takes over only what the Wheel lacks.
    expect(needlessTakeovers(report.rows)).toBe(0);

    const { rows, checks } = await cashChecks();
    for (const check of checks) {
      expect(check.start?.amount).toBe(0);
      expect(isCashCheckOk(check)).toBe(true);
      expect(rows[rows.length - 1].balances[check.currency]).toBeCloseTo(check.end!.amount, 2);
    }
  });

  it("imports the latest statement alone: positions on screen, and a cash gap only its own backdated rows explain", { timeout: 300_000 }, async () => {
    const { account } = await openAccount();
    const statements = statementsOf(account.ibAccountId);
    const { name, text } = statements[statements.length - 1];
    expect((await importFile(db, account, asFile(name, text))).status).toBe("ok");

    const snapshot = await db.snapshots.get("alpha");
    expect(snapshot?.source).toBe("statement_html");
    expect(snapshot?.positions.length).toBeGreaterThan(0);

    const ledger = await db.transactions.where("accountId").equals("alpha").toArray();
    // Spec §5 measures the start at the close of the day before it; IB books a late correction
    // in the Cash Report of the period that reports it but dates it on the day it corrects, so a
    // lone statement carrying such rows shows them as a gap (docs/points-reportes.md,
    // sub-project 9); set aside, the cash comes back to the Starting Cash.
    const { checks } = await cashChecks();
    for (const check of checks) {
      expect(check.start).not.toBeNull();
      const before = ledger.filter((tx) => dayOf(tx.when) < check.start!.asOf);
      const backdated = runningBalances(before, [check.currency]).at(-1)?.balances[check.currency] ?? 0;
      expect(Math.abs(check.start!.gap - backdated)).toBeLessThanOrEqual(CASH_CHECK_TOLERANCE);
    }
    expect(checks.some((check) => isCashCheckOk(check) === false)).toBe(true);
  });
});
