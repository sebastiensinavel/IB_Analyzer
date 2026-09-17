# Sous-projet 18 — Propriété de plage en jours de marché : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Les cases `- [ ]` suivent l'avancement : **elles se cochent dans le worktree, au fur et à
> mesure, dans le même commit que la tâche.** Une reprise de session part de la première case
> non cochée.

**Goal:** Qu'une assignation rapportée par Flex et par l'agent TWS ne compte qu'une fois dans le ledger, et que la base existante se répare à l'ouverture de l'application.

**Architecture:** (1) `toReportTime` (`packages/ib-parsers/src/common.ts`) ramène un vrai instant UTC à l'heure murale de New York stampée UTC, la convention des fichiers IB ; `parseAgentSnapshot` l'applique au `time` des exécutions et à `fetchedAt`. (2) `planFlex` et `planAgent` (`packages/ledger/src/import.ts`) raisonnent en jours : Flex possède ses jours entiers, l'agent n'écrit qu'après le dernier jour Flex. (3) La version 8 de Dexie convertit les lignes et le snapshot déjà écrits par l'agent. (4) Le badge « En direct » lit `account.lastAgentSyncAt`.

**Tech Stack:** TypeScript, Vitest, Dexie 4 (`fake-indexeddb` en test), React Testing Library. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-16-plage-jours-marche-design.md`. Lire aussi `CLAUDE.md` et le spec fondateur `docs/specs/2026-09-03-architecture-design.md` §6.1 et §6.2.

## Global Constraints

- **`IB_REPORT_TIME_ZONE = "America/New_York"`, une seule définition**, dans `packages/ib-parsers/src/common.ts`. Aucune autre occurrence de la chaîne `America/New_York` dans le code.
- **L'agent Python ne change pas** : il envoie toujours du vrai UTC. La conversion se fait dans le parseur TS.
- **Seules les heures IB sont converties** : `Transaction.when` et `SnapshotRecord.asOf` venus de l'agent. `lastAgentSyncAt`, `lastAgentSyncStatus.at`, `importedAt`, `updatedAt`, `createdAt` restent en vrai UTC.
- **L'agent ne supprime jamais rien** ; la migration ne supprime rien non plus.
- **Le plancher `fromDate` de `planFlex` ne change pas.** `planStatement` ne change pas.
- **Aucun ticker, identifiant de compte ni montant réel de l'utilisateur dans un fichier versionné.** Les tests utilisent IQZA comme ticker public générique, un compte `U1234567` et des montants inventés.
- **Un test doit échouer si le comportement change.** Chaque test neuf est lancé avant l'implémentation et doit échouer pour la raison annoncée ; un test qui passe déjà est signalé comme garde-fou.
- Code et commentaires en anglais ; documentation et messages de commit en français.
- Chaque commit se termine par :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Le travail se fait dans le worktree `.claude/worktrees/plage-jours-marche`, branche `plage-jours-marche`, mergé sur `main` après revue.
- Avant chaque commit : les tests et le `typecheck` du ou des paquets touchés passent (`pnpm --filter @ib/ib-parsers test`, `pnpm --filter @ib/ledger test`, `pnpm --filter web test`, et `typecheck` de même).

---

## Structure des fichiers

```
packages/ib-parsers/src/
  common.ts (+ test)        + IB_REPORT_TIME_ZONE, toReportTime ; commentaire des heures réécrit
  agent.ts (+ test)         time et fetchedAt passés par toReportTime
  index.ts                  exporte toReportTime et IB_REPORT_TIME_ZONE
packages/ledger/src/
  import.ts (+ test)        planFlex et planAgent en jours
apps/web/src/
  db/schema.ts (+ test)     version 8 : when et asOf de l'agent convertis
  agent/sync.test.ts        attendus convertis ; chronologie IQZA de bout en bout
  components/SnapshotStatus.tsx (+ test)   badge sur lastAgentSyncAt
  lib/format.ts             commentaires des fuseaux
apps/web/e2e/agent.spec.ts  commentaire de l'heure affichée
docs/                       spec fondateur §6.1/§6.2, points-reportes, statut du spec
CLAUDE.md                   règle de l'agent, tableau des sous-projets
```

---

### Task 1: `toReportTime` et l'heure de l'agent

**Files:**
- Modify: `packages/ib-parsers/src/common.ts` (commentaire l. 35-37, nouvelles exportations après `toIso`)
- Modify: `packages/ib-parsers/src/index.ts`
- Modify: `packages/ib-parsers/src/agent.ts` (`readExecution` : `when` ; `parseAgentSnapshot` : `fetchedAt`)
- Test: `packages/ib-parsers/src/common.test.ts`, `packages/ib-parsers/src/agent.test.ts`

**Interfaces:**
- Produces: `export const IB_REPORT_TIME_ZONE = "America/New_York"` et `export function toReportTime(instant: string): string`, exportés de `@ib/ib-parsers`. `toReportTime` lève `NormalizationError` sur un instant illisible.

- [x] **Step 1: Write the failing tests**

Dans `common.test.ts`, ajouter `toReportTime` à l'import de `./common.ts` et :

```ts
describe("toReportTime", () => {
  it("brings a true UTC instant to New York's wall clock, stamped UTC like the files", () => {
    // EDT, UTC-4: an evening in New York is already the next day in UTC.
    expect(toReportTime("2026-09-16T02:13:46.000Z")).toBe("2026-09-15T22:13:46.000Z");
    // EST, UTC-5.
    expect(toReportTime("2026-01-15T15:30:00.000Z")).toBe("2026-01-15T10:30:00.000Z");
    // Just after the spring change (2026-03-08, 07:00 UTC).
    expect(toReportTime("2026-03-08T07:30:00.000Z")).toBe("2026-03-08T03:30:00.000Z");
  });

  it("keeps the milliseconds and reads an offset", () => {
    expect(toReportTime("2026-09-06T13:02:11.482Z")).toBe("2026-09-06T09:02:11.482Z");
    expect(toReportTime("2026-09-06T14:31:02+00:00")).toBe("2026-09-06T10:31:02.000Z");
  });

  it("refuses an unreadable instant", () => {
    expect(() => toReportTime("yesterday")).toThrow(NormalizationError);
  });
});
```

Dans `agent.test.ts`, remplacer les attendus d'heure :
- test « passes the envelope through… » : renommer en `"passes the envelope through and brings fetchedAt to New York's wall clock"`, attendu `snapshot.fetchedAt` → `"2026-09-06T09:02:11.482Z"` ;
- test « turns a SLD option fill… » : `when: "2026-09-06T10:31:02.000Z"` ;
- test « turns a BOT stock fill… » : `when: "2026-09-06T11:00:00.000Z"`.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ib/ib-parsers test -- common agent`
Expected: FAIL — `toReportTime` n'est pas exporté ; les trois attendus d'`agent.test.ts` reçoivent l'heure UTC (`13:02:11.482`, `14:31:02`, `15:00:00`).

- [x] **Step 3: Implement**

Dans `common.ts`, remplacer le commentaire des lignes 35-37 et ajouter, juste après `toIso` :

```ts
// Every IB time in the ledger is New York's wall clock stamped as UTC. Flex and statement
// files carry that wall clock without a zone and are stamped without conversion (`toIso`);
// the agent reports true UTC instants, brought to the same clock by `toReportTime`. One
// clock is what lets `planImport` compare days across sources and the journals compare a
// snapshot's `asOf` with the transactions' `when`.
export const IB_REPORT_TIME_ZONE = "America/New_York";

const REPORT_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: IB_REPORT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** A true instant ("2026-09-16T02:13:46Z") to New York's wall clock stamped UTC ("2026-09-15T22:13:46.000Z"). */
export function toReportTime(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new NormalizationError(`Unreadable instant "${instant}"`);
  const parts = Object.fromEntries(REPORT_CLOCK.formatToParts(at).map((part) => [part.type, part.value]));
  return new Date(
    Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second, at.getUTCMilliseconds()),
  ).toISOString();
}
```

Vérifier que `NormalizationError` est déclarée avant cet usage dans le fichier (elle l'est en tête de `common.ts` ; sinon, c'est une classe, déplacer le bloc après sa déclaration).

Dans `index.ts`, remplacer la ligne 4 par :

```ts
export { IB_REPORT_TIME_ZONE, NormalizationError, splitOptionSymbol, toReportTime } from "./common.ts";
```

Dans `agent.ts`, importer `toReportTime` depuis `./common.ts` (à côté des imports existants de ce module), puis :
- dans `readExecution` : `when: toReportTime(instant(o, "time", path)),`
- dans `parseAgentSnapshot` : `const fetchedAt = toReportTime(instant(root, "fetchedAt", "payload"));`

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ib-parsers typecheck`
Expected: PASS, tout le paquet (oracles compris : aucun ne passe par l'agent).

- [x] **Step 5: Commit**

Cocher les cases de la tâche 1 dans ce plan, puis :

```bash
git add packages/ib-parsers/src/common.ts packages/ib-parsers/src/common.test.ts packages/ib-parsers/src/index.ts packages/ib-parsers/src/agent.ts packages/ib-parsers/src/agent.test.ts docs/plans/2026-09-16-plage-jours-marche.md
git commit -m "feat(ib-parsers): l'heure de l'agent passe à l'heure de New York des fichiers IB"
```

---

### Task 2: Propriété de plage en jours

**Files:**
- Modify: `packages/ledger/src/import.ts` (`planFlex`, `planAgent` et leurs commentaires)
- Test: `packages/ledger/src/import.test.ts`

**Interfaces:**
- Consumes: rien de la tâche 1 (le ledger ne dépend de rien) ; il suppose seulement que tout `when` suit la même horloge.
- Produces: `planImport` inchangé en signature.

- [x] **Step 1: Write the failing tests**

Dans `describe("planImport from Flex")`, remplacer le test « deletes rows of other sources inside its real range, bounds included » par :

```ts
  it("deletes rows of other sources over its whole days, bounds included", () => {
    const existing = [
      html("before", "2026-01-09T23:59:59.000Z"),
      html("at-min", "2026-01-10T10:00:00.000Z"),
      html("inside", "2026-02-01T00:00:00.000Z"),
      html("at-max", "2026-03-05T15:00:00.000Z"),
      html("later-that-day", "2026-03-05T22:13:46.000Z"),
      html("next-day", "2026-03-06T00:00:00.000Z"),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["html:at-min", "html:inside", "html:at-max", "html:later-that-day"]);
  });
```

Remplacer tout `describe("planImport from the agent")` par :

```ts
describe("planImport from the agent", () => {
  const flexMax = "2026-09-05T20:00:00.000Z";
  const existing = [flex("1", "2026-01-10T10:00:00.000Z"), flex("2", flexMax)];

  it("writes only the days after Flex's last day: Flex reports that day in full", () => {
    const atBound = agent("at-bound", flexMax);
    const laterThatDay = agent("later-that-day", "2026-09-05T23:59:59.999Z");
    const nextDay = agent("next-day", "2026-09-06T00:00:00.000Z");
    const before = agent("before", "2026-09-05T19:59:59.000Z");
    const plan = planImport(existing, { source: "agent", transactions: [atBound, laterThatDay, nextDay, before], period: null });
    expect(plan.upsert).toEqual([nextDay]);
    expect(plan.skipped).toBe(3);
  });

  it("leaves out an assignment Flex already dated at 16:20 that TWS reports in the evening", () => {
    const flexAssignment = [flex("put", "2026-09-15T16:20:00.000Z"), flex("stk", "2026-09-15T16:20:00.000Z")];
    const evening = [agent("put", "2026-09-15T22:13:46.000Z"), agent("stk", "2026-09-15T22:13:46.000Z")];
    const plan = planImport(flexAssignment, { source: "agent", transactions: evening, period: null });
    expect(plan.upsert).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("writes everything when there is no Flex row at all", () => {
    const rows = [agent("a", "2026-09-06T14:00:00.000Z"), agent("b", "2026-01-01T00:00:00.000Z")];
    const plan = planImport([html("h", "2026-02-01T00:00:00.000Z")], { source: "agent", transactions: rows, period: null });
    expect(plan.upsert).toEqual(rows);
    expect(plan.skipped).toBe(0);
  });

  it("never deletes anything, not even its own rows missing from the batch", () => {
    const stale = agent("gone", "2026-09-06T09:00:00.000Z");
    const plan = planImport([...existing, stale], { source: "agent", transactions: [agent("new", "2026-09-06T15:00:00.000Z")], period: null });
    expect(plan.delete).toEqual([]);
    expect(plan.dropped).toEqual([]);
  });

  it("is idempotent: the same batch twice plans the same writes", () => {
    const batch = { source: "agent" as const, transactions: [agent("x", "2026-09-06T15:00:00.000Z")], period: null };
    const first = planImport(existing, batch);
    const second = planImport([...existing, ...first.upsert], batch);
    expect(second.upsert).toEqual(first.upsert);
    expect(second.delete).toEqual([]);
  });

  it("returns a fresh array, never the caller's own", () => {
    const rows = [agent("x", "2026-09-06T15:00:00.000Z")];
    const plan = planImport([], { source: "agent", transactions: rows, period: null });
    expect(plan.upsert).not.toBe(rows);
  });
});
```

Remplacer tout `describe("planImport from Flex, over agent rows")` par :

```ts
describe("planImport from Flex, over agent rows", () => {
  it("retires agent rows over its whole last day: Flex replaces the day the agent wrote", () => {
    const existing = [
      agent("morning", "2026-09-05T14:00:00.000Z"),
      agent("after", "2026-09-05T20:00:00.001Z"),
      agent("next-day", "2026-09-06T09:30:00.000Z"),
    ];
    const incoming = [flex("1", "2026-09-01T10:00:00.000Z"), flex("2", "2026-09-05T20:00:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:morning", "agent:after"]);
    expect(plan.dropped).toEqual([{ kind: "trade", count: 2 }]);
  });

  it("retires the evening assignment the agent wrote before Flex dated it at 16:20", () => {
    const existing = [agent("put", "2026-09-15T22:13:46.000Z"), agent("stk", "2026-09-15T22:13:46.000Z")];
    const incoming = [flex("open", "2026-09-01T10:00:00.000Z"), flex("put", "2026-09-15T16:20:00.000Z"), flex("stk", "2026-09-15T16:20:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:put", "agent:stk"]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ib/ledger test -- import`
Expected: FAIL — `html:later-that-day` absent de `delete` ; `later-that-day` écrit par l'agent (`upsert` à deux lignes) ; l'assignation du soir écrite ; `agent:after` et les deux lignes de l'assignation non supprimées par Flex.

- [x] **Step 3: Implement**

Dans `planFlex`, remplacer le calcul de `doomed` :

```ts
  const minDay = dayOf(min);
  const maxDay = dayOf(max);
  const doomed = existing.filter((tx) => {
    if (tx.source === "flex") return false;
    const day = dayOf(tx.when);
    return day >= minDay && day <= maxDay;
  });
```

Dans le commentaire de `planFlex`, remplacer le paragraphe « The lower bound is floored to the *start of its day*… hide such a row, where the asymmetry leaves it visible. » par :

```ts
 * Both bounds are whole days. If Flex's oldest row is at 14:30, its query covered that
 * whole day. And a response always runs to the previous close, so its newest day is
 * complete too: whatever the agent reported that day, at whatever hour, Flex reports it
 * as well. The hours do not match across sources — Flex dates an assignment 16:20, TWS at
 * the evening hour IB processed it — so an instant bound would keep both. The upper bound
 * is not clamped to `toDate`: a row beyond the declared end has never been observed, while
 * the floor is dragged back by an ordinary late adjustment. Clamping it would also silently
 * hide such a row, where the asymmetry leaves it visible.
```

Remplacer `planAgent` et son commentaire par :

```ts
/**
 * The agent writes only the days *after* Flex's newest day, strictly: Flex owns its days
 * whole (`planFlex`), and an execution TWS reports in the evening of a day Flex already
 * covers — an assignment IB processed at 22:13 that Flex dates 16:20 — is Flex's row under
 * another hour. It never deletes: a TWS restarted mid-day no longer reports the morning's
 * fills, and erasing them would lose true information. The next Flex sync replaces the
 * whole day anyway (spec fondateur §6.2). Upserting by externalId makes a five-minute
 * cadence idempotent, and lets a later pass fill in a commission that IB reported after the
 * fill.
 */
function planAgent(existing: readonly Transaction[], incoming: readonly Transaction[]): ImportPlan {
  let flexMax: string | null = null;
  for (const tx of existing) {
    if (tx.source === "flex" && (flexMax === null || tx.when > flexMax)) flexMax = tx.when;
  }
  const flexDay = flexMax === null ? null : dayOf(flexMax);
  const kept = flexDay === null ? [...incoming] : incoming.filter((tx) => dayOf(tx.when) > flexDay);
  return { delete: [], upsert: kept, dropped: [], skipped: incoming.length - kept.length };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck`
Expected: PASS, tout le paquet.

Run aussi: `pnpm --filter @ib/ib-parsers test && pnpm --filter web test`
Expected: PASS. Un échec dans `apps/web` qui dépend de l'ancienne borne à l'instant (par exemple `importFile.test.ts`) est à lire : s'il teste une ligne non-Flex après `max` le même jour, l'attendu suit la nouvelle règle du jour ; le signaler dans le rapport.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 2, puis :

```bash
git add packages/ledger/src/import.ts packages/ledger/src/import.test.ts docs/plans/2026-09-16-plage-jours-marche.md
git commit -m "feat(ledger): Flex possède ses jours entiers, l'agent n'écrit qu'après le dernier"
```

(Ajouter à `git add` tout autre test ajusté à l'étape 4.)

---

### Task 3: Migration Dexie 8

**Files:**
- Modify: `apps/web/src/db/schema.ts` (après `version(7)`)
- Test: `apps/web/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `toReportTime` de `@ib/ib-parsers` (tâche 1).
- Produces: `AppDatabase.verno === 8`.

- [x] **Step 1: Write the failing test**

Dans `schema.test.ts`, remplacer les trois `expect(upgraded.verno).toBe(7);` par `toBe(8)`, puis ajouter à la fin :

```ts
/** The schema as it stood right before version 8: version 7 renamed the sectors' `importedAt`. */
class LegacyDatabaseV7 extends LegacyDatabaseV6 {
  constructor(name: string) {
    super(name);
    this.version(7).stores({ sectors: "ticker" });
  }
}

describe("AppDatabase version 8", () => {
  it("brings the agent's transactions and snapshot to New York's wall clock and leaves every other time alone", async () => {
    const name = `ib-analyzer-v8-migration-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV7(name);
    await legacy.open();
    const row = (source: string, externalId: string, when: string) => ({
      accountId: "beta", externalId, source, kind: "trade", symbol: "IQZA", secType: "STK", right: "", strike: null,
      expiry: null, quantity: 100, price: 60, amount: -6000, commission: null, currency: "USD", when, description: "",
    });
    await legacy.table("transactions").bulkPut([
      row("agent", "agent:e1", "2026-09-16T02:13:46.000Z"),
      row("flex", "flex:trade:1", "2026-09-15T16:20:00.000Z"),
    ]);
    await legacy.table("snapshots").bulkPut([
      { accountId: "beta", source: "agent", asOf: "2026-09-16T15:04:26.000Z", importedAt: "2026-09-16T15:04:27.000Z", positions: [], cashAvailable: null },
      { accountId: "alpha", source: "flex", asOf: "2026-09-15", importedAt: "2026-09-16T07:00:00.000Z", positions: [], cashAvailable: null },
    ]);
    const account = {
      id: "beta", label: "Beta", ibAccountId: "U1234567", createdAt: "2026-09-01T00:00:00.000Z",
      warnedDroppedKinds: [], lastAgentSyncAt: "2026-09-16T15:04:27.000Z",
    };
    await legacy.table("accounts").put(account);
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(8);
      expect((await upgraded.transactions.get(["beta", "agent:e1"]))?.when).toBe("2026-09-15T22:13:46.000Z");
      expect((await upgraded.transactions.get(["beta", "flex:trade:1"]))?.when).toBe("2026-09-15T16:20:00.000Z");
      // The compound index follows the rewrite: the row is found by its new time.
      expect(
        await upgraded.transactions.where("[accountId+when]").equals(["beta", "2026-09-15T22:13:46.000Z"]).count(),
      ).toBe(1);
      expect(await upgraded.snapshots.get("beta")).toMatchObject({ asOf: "2026-09-16T11:04:26.000Z", importedAt: "2026-09-16T15:04:27.000Z" });
      expect((await upgraded.snapshots.get("alpha"))?.asOf).toBe("2026-09-15");
      expect(await upgraded.accounts.get("beta")).toEqual(account);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- src/db/schema.test.ts`
Expected: FAIL — `verno` vaut 7 ; `when` de `agent:e1` reste `2026-09-16T02:13:46.000Z`.

- [x] **Step 3: Implement**

Dans `schema.ts`, importer `toReportTime` depuis `@ib/ib-parsers` et ajouter après le bloc `version(7)` :

```ts
    // IB times are New York's wall clock stamped UTC (ib-parsers' common.ts). The agent used
    // to write true UTC instants: its rows and its snapshot are brought to that clock, so that
    // Flex's whole days own them (`planImport`). App instants (`lastAgentSyncAt`, `importedAt`)
    // are not IB times and stay true UTC.
    this.version(8)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("transactions")
          .filter((row: { source: string }) => row.source === "agent")
          .modify((row: { when: string }) => {
            row.when = toReportTime(row.when);
          });
        await tx
          .table("snapshots")
          .filter((row: { source: string }) => row.source === "agent")
          .modify((row: { asOf: string }) => {
            row.asOf = toReportTime(row.asOf);
          });
      });
```

Si Dexie refuse `.stores({})`, déclarer la version sans `stores` n'est pas permis non plus : redéclarer alors une table inchangée, `.stores({ sectors: "ticker" })`, et le dire dans le rapport.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- src/db && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 3, puis :

```bash
git add apps/web/src/db/schema.ts apps/web/src/db/schema.test.ts docs/plans/2026-09-16-plage-jours-marche.md
git commit -m "feat(web): Dexie 8 ramène les heures de l'agent à l'heure de New York"
```

---

### Task 4: La synchro de l'agent de bout en bout

**Files:**
- Test: `apps/web/src/agent/sync.test.ts`
- Modify (si un attendu en dépend) : `apps/web/src/agent/useAgentSync.test.tsx`, `apps/web/src/pages/SourcesPage.test.tsx`
- Modify: `apps/web/e2e/agent.spec.ts` (commentaire de `expectAgentFillRow`)

**Interfaces:**
- Consumes: tâches 1 à 3 ; `buildJournals` de `@ib/ledger` (`buildJournals(transactions, { asOf, positions }?)` → `.reconciliation.differences`).
- Produces: rien de nouveau ; `syncAgent` ne change pas de code.

- [x] **Step 1: Update the existing expectation and write the new tests**

Dans `sync.test.ts`, test « writes the transactions, the live snapshot and the account state in one go » : l'attendu du snapshot devient `asOf: "2026-09-06T09:02:11.482Z"` (l'`importedAt` et `lastAgentSyncAt` restent `NOW.toISOString()`).

Ajouter en tête `import { buildJournals, type Transaction } from "@ib/ledger";` et à la fin du fichier :

```ts
describe("syncAgent over an assignment Flex already reported", () => {
  const IQZA = {
    conId: 1, symbol: "IQZA", localSymbol: "IQZA", secType: "STK", right: "", strike: 0,
    lastTradeDateOrContractMonth: "", multiplier: "", currency: "USD",
  };
  const IREN_PUT = {
    conId: 2, symbol: "IQZA", localSymbol: "IQZA  260918P00060000", secType: "OPT", right: "P", strike: 60,
    lastTradeDateOrContractMonth: "20260918", multiplier: "100", currency: "USD",
  };
  const put = { symbol: "IQZA  260918P00060000", secType: "OPT", right: "P", strike: 60, expiry: "2026-09-18" };
  const flexRow = (id: string, when: string, fields: Partial<Transaction>): Transaction => ({
    accountId: "beta", externalId: `flex:trade:${id}`, source: "flex", kind: "trade", symbol: "IQZA", secType: "STK",
    right: "", strike: null, expiry: null, quantity: 0, price: 0, amount: 0, commission: 0, currency: "USD", when,
    description: "", ...fields,
  });
  // Flex dates the assignment 16:20 on the expiry day; TWS reports it at 02:13:46 UTC the next
  // morning, 22:13:46 in New York the same evening.
  const flexLedger = [
    flexRow("open", "2026-09-01T10:00:00.000Z", { ...put, quantity: -1, price: 1.5, amount: 150, commission: -1.05 }),
    flexRow("put", "2026-09-15T16:20:00.000Z", { ...put, quantity: 1 }),
    flexRow("stk", "2026-09-15T16:20:00.000Z", { quantity: 100, price: 60, amount: -6000 }),
  ];
  const execution = (execId: string, contract: typeof IQZA, shares: number, price: number, time: string) => ({
    execId, time, acctNumber: "U1234567", side: "BOT", shares, price, cumQty: shares, avgPrice: price, orderRef: "",
    contract, commission: null, commissionCurrency: null,
  });
  const assignmentPass = payload({
    fetchedAt: "2026-09-16T15:04:26.000Z",
    positions: [{ ...IQZA, position: 100, averageCost: 60, marketPrice: 61, marketValue: 6100, unrealizedPNL: 100 }],
    executions: [
      execution("put", IREN_PUT, 1, 0, "2026-09-16T02:13:46+00:00"),
      execution("stk", IQZA, 100, 60, "2026-09-16T02:13:46+00:00"),
    ],
  });

  it("writes none of it, and the ledger reconciles with the live snapshot", async () => {
    await db.transactions.bulkPut(flexLedger);
    const outcome = await syncAgent(ok(assignmentPass), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 0, positions: 1 });

    const ledger = await db.transactions.where("accountId").equals("beta").toArray();
    expect(ledger.map((row) => row.externalId).sort()).toEqual(["flex:trade:open", "flex:trade:put", "flex:trade:stk"]);
    const snapshot = await db.snapshots.get("beta");
    expect(snapshot?.asOf).toBe("2026-09-16T11:04:26.000Z");
    const report = buildJournals(ledger, { asOf: snapshot!.asOf, positions: snapshot!.positions });
    expect(report.reconciliation.differences).toEqual([]);
  });

  it("still writes a fill of the next New York day, at New York's hour", async () => {
    await db.transactions.bulkPut(flexLedger);
    const nextDay = payload({ executions: [execution("buy", IQZA, 10, 61, "2026-09-16T14:00:00+00:00")] });
    const outcome = await syncAgent(ok(nextDay), ACCOUNT);
    expect(outcome).toMatchObject({ status: "ok", transactions: 1 });
    expect((await db.transactions.get(["beta", "agent:buy"]))?.when).toBe("2026-09-16T10:00:00.000Z");
  });
});
```

Si le champ `payload` des positions ou des exécutions n'accepte pas ces objets au typecheck, aligner leurs champs sur `AgentSnapshotPayload` (`packages/ib-parsers/src/agent.ts`) sans changer les valeurs.

- [x] **Step 2: Run tests to check what fails**

Run: `pnpm --filter web test -- src/agent`
Expected: les tâches 1 à 3 étant faites, ces tests passent déjà : ce sont des **garde-fous de bout en bout**, à signaler comme tels. Pour prouver qu'ils mordent, remettre temporairement `tx.when > flexMax` dans `planAgent` (tâche 2) : le premier test doit alors échouer (`transactions: 2`, écart IQZA 200/100). Restaurer ensuite le code, et ne rien committer de cette expérience.

- [x] **Step 3: Fix any other agent expectation**

Run: `pnpm --filter web test`
Expected: PASS. Si un test de `useAgentSync.test.tsx` ou `SourcesPage.test.tsx` attend un `asOf` ou un `when` en vrai UTC, son attendu passe à l'heure de New York (EDT, −4 h en septembre) ; ne jamais changer les entrées.

Dans `apps/web/e2e/agent.spec.ts`, réécrire la fin du commentaire de `expectAgentFillRow` : l'exécution `2026-09-06T14:31:02Z` est ramenée à l'heure de New York par `parseAgentSnapshot` et affichée « 2026-09-06 10:31:02 » ; l'attendu (le jour seul) ne change pas.

- [x] **Step 4: Run the checks**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 4, puis :

```bash
git add apps/web/src/agent/sync.test.ts apps/web/e2e/agent.spec.ts docs/plans/2026-09-16-plage-jours-marche.md
git commit -m "test(web): une assignation vue par Flex puis par l'agent ne compte qu'une fois"
```

(Ajouter à `git add` tout autre test ajusté à l'étape 3.)

---

### Task 5: Le badge « En direct » à l'heure de la pendule

**Files:**
- Modify: `apps/web/src/components/SnapshotStatus.tsx`
- Modify: `apps/web/src/lib/format.ts` (commentaires de `formatDateTime` et de `CLOCK_FORMATTER`)
- Test: `apps/web/src/components/SnapshotStatus.test.tsx`

**Interfaces:**
- Consumes: `AccountRecord.lastAgentSyncAt?: string` (vrai UTC, écrit par `syncAgent`).

- [x] **Step 1: Write the failing tests**

Dans `SnapshotStatus.test.tsx`, remplacer `agentSnapshot` et le test « says live with the clock time for an agent snapshot » par :

```ts
// `asOf` is New York's wall clock stamped UTC; `lastAgentSyncAt` is the true instant of the
// same pass, four hours later on the UTC scale in September.
const agentSnapshot: SnapshotRecord = { ...flexSnapshot, source: "agent", asOf: "2026-09-06T09:02:00.000Z" };
const LAST_AGENT_SYNC_AT = "2026-09-06T13:02:01.000Z";
```

```ts
  it("says live with the wall-clock time of the last agent pass, never the snapshot's New York time", async () => {
    await db.snapshots.put(agentSnapshot);
    await db.accounts.update("alpha", { lastAgentSyncAt: LAST_AGENT_SYNC_AT });
    renderStatus();
    const badge = await screen.findByText(`En direct, ${formatClockTime(LAST_AGENT_SYNC_AT)}`);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("text-success");
    expect(screen.queryByText(`En direct, ${formatClockTime(agentSnapshot.asOf)}`)).not.toBeInTheDocument();
  });

  it("says live with a dash when no agent pass time is known", async () => {
    await db.snapshots.put(agentSnapshot);
    renderStatus();
    expect(await screen.findByText("En direct, —")).toBeInTheDocument();
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- src/components/SnapshotStatus.test.tsx`
Expected: FAIL — le badge affiche l'heure de `asOf` ; sans `lastAgentSyncAt`, il n'affiche pas « — ».

- [x] **Step 3: Implement**

Dans `SnapshotStatus.tsx`, remplacer la ligne du badge agent par :

```tsx
          // `asOf` is New York's wall clock like every IB time; the badge reads the true
          // instant of the last pass, shown on the viewer's own clock.
          <Badge variant="success">
            {t("snapshot.live", { time: account?.lastAgentSyncAt ? formatClockTime(account.lastAgentSyncAt) : "—" })}
          </Badge>
```

(Le commentaire JSX doit être placé là où la syntaxe le permet, par exemple avant le ternaire ; ne pas casser la structure.)

Dans `format.ts`, réécrire :
- le commentaire au-dessus de `formatDateTime` : « … The zone stays UTC: every IB time — Flex, statements, and the agent's after `toReportTime` — is New York's wall clock stamped UTC (see ib-parsers' common.ts), so converting here would move them. » ;
- le commentaire au-dessus de `CLOCK_FORMATTER` : « Unlike every other formatter here, this one is in the *viewer's* zone: it reads an app instant, the true UTC time of the last agent pass (`lastAgentSyncAt`), and "live, 15:02" must read as the clock on the wall. IB times are New York's wall clock stamped UTC and are shown by `formatDateTime`. »

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 5, puis :

```bash
git add apps/web/src/components/SnapshotStatus.tsx apps/web/src/components/SnapshotStatus.test.tsx apps/web/src/lib/format.ts docs/plans/2026-09-16-plage-jours-marche.md
git commit -m "feat(web): le badge En direct lit l'heure réelle de la dernière passe de l'agent"
```

---

### Task 6: Documentation et vérification finale

**Files:**
- Modify: `docs/specs/2026-09-03-architecture-design.md` (§6.1, §6.2)
- Modify: `docs/specs/2026-09-16-plage-jours-marche-design.md` (statut)
- Modify: `docs/points-reportes.md` (sous-projet 4, ligne « Exercices, assignations et dividendes du jour… »)
- Modify: `CLAUDE.md`

- [x] **Step 1: Spec fondateur**

§6.1, dans le bloc du modèle, remplacer `when        ISO 8601 UTC` par `when        ISO 8601, heure murale de New York stampée UTC (§6.2)`.

§6.2, remplacer les puces sur Flex (première phrase seulement), l'agent et la synchro Flex :
- « **Flex est propriétaire** de ses jours réels, du jour de `min(when)` au jour de `max(when)` inclus, … » (le reste de la puce ne change pas) ;
- « **L'agent n'écrit qu'après** le dernier jour Flex, en jours entiers : une réponse Flex court jusqu'à la clôture de la veille, son dernier jour est complet. » ;
- « **À chaque synchro Flex**, les lignes HTML et agent tombant dans ses jours sont supprimées et remplacées, dans la même écriture IndexedDB. »

Et ajouter à la fin du §6.2 :

« **Une seule horloge** (sous-projet 18) : toute heure IB du ledger et des snapshots est l'heure murale de New York stampée UTC. Flex et les relevés la donnent sans fuseau ; l'agent rend du vrai UTC, ramené à cette horloge par `toReportTime` (`packages/ib-parsers/src/common.ts`). Sans cela, et sans jours entiers, une assignation que Flex date 16:20 et que TWS rend à 22:13 heure de New York serait comptée deux fois. »

- [x] **Step 2: Dette et statut**

`docs/points-reportes.md` : remplacer la puce « **Exercices, assignations et dividendes du jour n'apparaissent pas dans les exécutions intraday.** … » par :

« - **Les dividendes du jour n'apparaissent pas dans les exécutions intraday** ; ils n'arrivent qu'avec la synchro Flex du lendemain matin. Les assignations et exercices, eux, sont rendus par `reqExecutions`, sans commission, à l'heure où IB les traite le soir : corrigé au sous-projet 18, qui fait posséder à Flex ses jours entiers. »

Spec du sous-projet : `Statut : conçu (2026-09-16).` → `Statut : implémenté (2026-09-16).`

- [x] **Step 3: CLAUDE.md**

Remplacer la règle « **L'agent n'écrit qu'après `max(when)` Flex, strictement, et ne supprime jamais.** Un snapshot `agent` remplace toujours le courant ; un fichier remplace si son `asOf` atteint le jour du courant (`db/snapshot.ts`). » par :

« - **Toute heure IB est l'heure murale de New York stampée UTC** (`IB_REPORT_TIME_ZONE`, `toReportTime` dans `packages/ib-parsers/src/common.ts`) : Flex et relevés telle quelle, l'agent converti depuis son vrai UTC. Seuls les instants de l'application (`lastAgentSyncAt`, `importedAt`…) restent en vrai UTC, et le badge « En direct » lit `lastAgentSyncAt`. **Flex possède ses jours entiers ; l'agent n'écrit qu'après le dernier jour Flex, et ne supprime jamais** : TWS rend une assignation le soir, Flex la date 16:20. Un snapshot `agent` remplace toujours le courant ; un fichier remplace si son `asOf` atteint le jour du courant (`db/snapshot.ts`). »

Dans la règle « **Propriété de plage, jamais comparaison de contenu** (spec §6.2) : Flex est propriétaire de sa plage réelle, le relevé HTML n'écrit qu'avant, l'agent n'écrit qu'après. » remplacer « sa plage réelle » par « ses jours réels ».

Dans le tableau des sous-projets, ajouter :

`| 18 | Propriété de plage en jours de marché | fait (2026-09-16) |`

- [x] **Step 4: Full check**

Run: `pnpm check`
Expected: PASS (lint, typecheck, types de l'API, build, tests).

Run: `grep -rn "America/New_York" packages apps --include=*.ts --include=*.tsx | grep -v test`
Expected: une seule ligne, `packages/ib-parsers/src/common.ts`.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 6, puis :

```bash
git add docs/specs/2026-09-03-architecture-design.md docs/specs/2026-09-16-plage-jours-marche-design.md docs/points-reportes.md CLAUDE.md docs/plans/2026-09-16-plage-jours-marche.md
git commit -m "docs: sous-projet 18 livré, propriété de plage en jours de marché"
```
