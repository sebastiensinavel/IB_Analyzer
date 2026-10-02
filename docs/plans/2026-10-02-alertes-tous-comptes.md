# Sous-projet 43 — Les alertes de tous les comptes : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Cocher chaque case dans le même commit que la tâche** (CLAUDE.md, Workflow).

**Goal:** Les alertes de prix de tous les comptes qui ont un port TWS se vérifient à chaque passe de l'agent, sur toutes les pages, onglet visible ou non, par un veilleur unique élu entre les onglets ; une pastille du sélecteur de compte et une notification nommant le compte les signalent.

**Architecture:** Un veilleur hors React (`src/alerts/watcher.ts`), démarré par `main.tsx`, tient un verrou Web Locks par base et fait les passes : pour chaque compte, `runAgentSync` puis `evaluateAccountAlerts` (lecture Dexie, `buildJournals`, cotations, `runPass`, S₀), puis notification. Le code de lecture, de journaux, de passe et de S₀ est extrait des hooks actuels pour être partagé, jamais recopié. `useAgentPolling` disparaît ; la sonde de présence reste dans chaque onglet ; `exclusiveTws` devient un verrou Web Locks entre onglets.

**Tech Stack:** TypeScript, React 19, Dexie 4 (`liveQuery`), Web Locks API, react-i18next, shadcn base-ui (`@ib/ui`), Vitest + fake-indexeddb + jsdom.

**Spec:** `docs/specs/2026-10-02-alertes-tous-comptes-design.md` — à lire avant toute tâche. CLAUDE.md s'applique en entier.

## Global Constraints

- Le serveur ne voit rien : aucun endpoint, modèle ni migration. Aucun changement de `packages/alerts`. **Aucune version 13 de Dexie.**
- `AGENT_POLL_MS = 5 * 60 * 1000` reste défini une seule fois, `apps/web/src/agent/useAgentSync.ts`.
- Nom du verrou du veilleur : `` `ib2:watcher:${db.name}` `` ; nom du verrou TWS : `"ib2:tws"` (`TWS_LOCK`, `agent/client.ts`).
- Jamais deux passes du veilleur qui se chevauchent ; le minuteur suivant s'arme à la **fin** d'une passe.
- Le veilleur passe onglet masqué : il ne lit jamais `document.visibilityState` pour décider d'une passe (seulement pour la sonde de présence, §3.1 de la spec).
- Seul `apps/web/src/alerts/notify.ts` touche l'API `Notification` ; rien en démonstration (`isDemo()`).
- Tous les textes dans `apps/web/src/i18n/{fr,en}.json` (test de parité).
- Tests `apps/web` : `npx vitest run <motif>` **depuis `apps/web`** (jamais `pnpm --filter web test -- <motif>`, qui ne filtre pas). `pnpm check` **une seule fois**, tâche 8.
- Tests sur `fake-indexeddb` avec une base semée ; aucun hook moqué. Faux temps : `vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })` — **jamais `setImmediate`**, dont fake-indexeddb a besoin (voir le commentaire de `agent/useAgentSync.test.tsx`).
- jsdom n'a pas `navigator.locks` : les tests qui en ont besoin passent un `FakeLocks` (tâche 4).
- Arbitrages d'affichage tranchés ici, à ne pas rouvrir :
  - sélecteur : `AlertBadge` existant (`components/alerts/AlertBadge.tsx`), rien à zéro ; dans la liste, à droite du nom du compte (`flex w-full items-center justify-between gap-2`) ; sur le bouton fermé, juste avant le chevron, la somme des **autres** comptes ; le texte de la valeur affichée reste le seul identifiant du compte ;
  - titre de notification à partir de deux comptes : `"{{account}} · {{title}}"`, le titre étant celui d'aujourd'hui.

## Review Focus

1. **Onglet non élu sans présence** : un second onglet ne tient pas le verrou ; il doit quand même passer de « inconnu » à « présent » (sonde), sans quoi cotations, bouton Actualiser et relais Flex meurent. Test en tâche 6 (« a tab that does not lead still probes the agent »).
2. **Purge sur un compte en échec TWS** : une synchro `failed` ne doit jamais déclencher ni réarmer (aucun cours frais), mais purge. Test en tâche 3 (`fresh: false`) et tâche 6 (TWS d'`alpha` injoignable, `beta` passe).
3. **Double notification** : le compte affiché est évalué par le hook et par le veilleur ; une transition n'est notifiée qu'une fois. Test en tâche 3 (deux évaluations de suite, la seconde rend `[]`).
4. **Écriture d'un autre compte qui relance les journaux affichés** : un snapshot écrit pour `beta` ne doit pas recalculer les journaux d'`alpha`. Test en tâche 1.
5. **Verrou jamais rendu** : un veilleur arrêté (`stop()`) libère son verrou, et un veilleur arrêté avant d'avoir obtenu le verrou n'en fait jamais rien. Test en tâche 6.

---

### Task 1: Les journaux d'un compte se calculent hors React

**Files:**
- Create: `apps/web/src/db/journals.ts`
- Modify: `apps/web/src/db/hooks.ts` (`useLedger`, `useJournals`)
- Test: `apps/web/src/db/journals.test.tsx`

**Interfaces:**
- Produces:
  - `readLedger(db: AppDatabase, accountId: string): Promise<Transaction[]>` — trié par `sortTransactions` ;
  - `computeJournals(ledger: Transaction[], snapshot: SnapshotRecord | null, inputs: IdentityInput[], active: readonly ActivableStrategy[]): ReadyJournals` ;
  - `type ReadyJournals = Extract<JournalsView, { status: "ready" }>` (exporté depuis `db/journals.ts`) ;
  - `loadAccountJournals(db: AppDatabase, accountId: string): Promise<{ account: AccountRecord; snapshot: SnapshotRecord | null; journals: ReadyJournals } | null>` — `null` si le compte n'existe pas.

- [x] **Step 1: Write the failing test**

```tsx
// apps/web/src/db/journals.test.tsx
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import { SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { useActiveStrategies, useJournals, type JournalsView } from "./hooks";
import { loadAccountJournals } from "./journals";

const account = (id: string): AccountRecord => ({ id, label: id, ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [] });

const seen: JournalsView[] = [];
function Probe({ accountId }: { accountId: string }) {
  const journals = useJournals(accountId, useActiveStrategies(accountId));
  useEffect(() => {
    if (journals.status === "ready") seen.push(journals);
  }, [journals]);
  return null;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));

beforeEach(async () => {
  seen.length = 0;
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("loadAccountJournals", () => {
  it("builds the very journals useJournals shows", async () => {
    await db.accounts.add(account("beta"));
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS.map((t) => ({ ...t, accountId: "beta" })));
    render(<Probe accountId="beta" />);
    await settle();
    const loaded = await loadAccountJournals(db, "beta");
    expect(loaded?.journals).toEqual(seen.at(-1));
    expect(loaded?.snapshot).toBeNull();
  });

  it("answers null for an unknown account", async () => {
    expect(await loadAccountJournals(db, "nobody")).toBeNull();
  });
});

describe("useJournals across accounts", () => {
  it("does not rebuild alpha's journals when beta's snapshot is written", async () => {
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS.map((t) => ({ ...t, accountId: "alpha" })));
    render(<Probe accountId="alpha" />);
    await settle();
    const before = seen.length;
    await db.snapshots.put({ accountId: "beta", source: "agent", asOf: "2026-09-30T14:00:00.000Z", importedAt: "2026-09-30T18:00:00.000Z", cashAvailable: null, positions: [] });
    await settle();
    expect(seen.length).toBe(before);
  });
});
```

Si `SAMPLE_JOURNAL_TRANSACTIONS` porte déjà `accountId: "beta"`, le `map` le réécrit : garder tel quel.

- [x] **Step 2: Run test to verify it fails**

Run (depuis `apps/web`) : `npx vitest run src/db/journals.test.tsx`
Expected: FAIL — `Cannot find module './journals'`. (Le test « across accounts » peut déjà passer : il fige un comportement, Review Focus 4.)

- [x] **Step 3: Write minimal implementation**

```ts
// apps/web/src/db/journals.ts
import { buildIdentities, buildJournals, pairCorporateActions, sortTransactions, type ActivableStrategy, type IdentityInput, type Transaction } from "@ib/ledger";
import { activeStrategies } from "@/lib/strategies";
import { readIdentityInputs } from "./contracts";
import type { JournalsView } from "./hooks";
import type { AccountRecord, AppDatabase, SnapshotRecord } from "./schema";

export type ReadyJournals = Extract<JournalsView, { status: "ready" }>;

/** The whole ledger of one account, in reference order — what `useLedger` shows. */
export async function readLedger(db: AppDatabase, accountId: string): Promise<Transaction[]> {
  return sortTransactions(await db.transactions.where("accountId").equals(accountId).toArray());
}

/**
 * The journals of one account from its stored inputs, the one sequence `useJournals` and the
 * alert watcher (sub-project 43) both run: the events date the ambiguous tickers, and the same
 * events are paired again inside `buildJournals` — pairing is pure and cheap, and passing a
 * pre-built list in would make the engine's own input ambiguous.
 */
export function computeJournals(
  ledger: Transaction[],
  snapshot: SnapshotRecord | null,
  inputs: IdentityInput[],
  active: readonly ActivableStrategy[],
): ReadyJournals {
  const { events, issues: actionIssues } = pairCorporateActions(ledger);
  const identities = buildIdentities(inputs, events);
  return {
    status: "ready",
    report: buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined, identities, active),
    identityIssues: [...identities.issues, ...actionIssues],
  };
}

/** One account's journals read straight from the base, outside React; `null` for an unknown account. */
export async function loadAccountJournals(
  db: AppDatabase,
  accountId: string,
): Promise<{ account: AccountRecord; snapshot: SnapshotRecord | null; journals: ReadyJournals } | null> {
  const [account, ledger, snapshot, inputs] = await Promise.all([
    db.accounts.get(accountId),
    readLedger(db, accountId),
    db.snapshots.get(accountId),
    readIdentityInputs(db, accountId),
  ]);
  if (account === undefined) return null;
  const own = snapshot ?? null;
  return { account, snapshot: own, journals: computeJournals(ledger, own, inputs, activeStrategies(account)) };
}
```

Dans `hooks.ts`, `useJournals` délègue :

```ts
export function useJournals(accountId: string, active: readonly ActivableStrategy[] | undefined): JournalsView {
  const ledger = useLedger(accountId);
  const snapshot = useSnapshot(accountId);
  const inputs = useContractIdentities(accountId);
  return useMemo<JournalsView>(() => {
    if (ledger === undefined || snapshot === undefined || inputs === undefined || active === undefined) return { status: "loading" };
    return computeJournals(ledger, snapshot, inputs, active);
  }, [ledger, snapshot, inputs, active]);
}
```

et `useLedger` garde sa requête live (elle doit rester scopée) mais trie toujours par `sortTransactions` — inchangé. Retirer de `hooks.ts` les imports devenus inutiles (`buildIdentities`, `buildJournals`, `pairCorporateActions`). L'import circulaire de type `JournalsView` (`journals.ts` → `hooks.ts`) est un `import type`, sans effet à l'exécution.

- [x] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/db/journals.test.tsx src/db/hooks src/alerts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/db/journals.ts apps/web/src/db/journals.test.tsx apps/web/src/db/hooks.ts docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Alertes : les journaux d'un compte se calculent hors React"
```

---

### Task 2: La passe d'alertes et la pose de S₀ sortent du hook

Refactor sans changement de comportement : `useAlertEngine.test.tsx` doit passer **sans modification de ses assertions**.

**Files:**
- Create: `apps/web/src/alerts/pass.ts`, `apps/web/src/alerts/anchors.ts`
- Modify: `apps/web/src/alerts/useAlertEngine.ts`, `apps/web/src/alerts/useAlertEngine.test.tsx` (seulement `beforeEach` : `resetAnchorGuards()`)
- Test: `apps/web/src/alerts/anchors.test.ts`

**Interfaces:**
- Produces:
  - `pass.ts` : `interface PassInputs { db; accountId; rows: readonly JournalRow[]; margins: AlertMargins; priceOf: (ticker: string) => PriceQuote | null }`, `interface Triggered { alert: Alert; price: number | undefined }`, `runPass(inputs: PassInputs): Promise<Triggered[]>`, `noPrice: () => null` ;
  - `anchors.ts` : `interface AnchorInputs { snapshot: SnapshotRecord | null; priceOf: (ticker: string) => PriceQuote | null; port: number | undefined; agentPresent: boolean; syncedAt: string | undefined; observedAt: string; fetchBars: (port: number, symbol: string, currency?: string) => Promise<BarsResult> }`, `anchorPending(db, accountId, alerts: readonly Alert[], inputs: AnchorInputs): Promise<void>`, `resetAnchorGuards(): void`.

- [x] **Step 1: Write the failing test**

```ts
// apps/web/src/alerts/anchors.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WheelAlert } from "@ib/alerts";
import { db } from "@/db/schema";
import { anchorPending, resetAnchorGuards, type AnchorInputs } from "./anchors";

const WHEEL: WheelAlert = {
  id: "wheel:MQZA|OPT|C|15|2026-10-16|USD", kind: "wheel", ticker: "MQZA", currency: "USD",
  contract: { symbol: "MQZA  261016C00015000", secType: "OPT", right: "C", strike: 15, expiry: "2026-10-16", multiplier: 100, currency: "USD" } as never,
  strike: 15, expiry: "2026-10-16", quantity: -2, averageAssignmentPrice: 17, saleWhen: "2026-09-29T10:30:00.000Z", fraction: 0.7, anchor: null, thresholds: null,
};

function inputs(fields: Partial<AnchorInputs>): AnchorInputs {
  return {
    snapshot: null, priceOf: () => null, port: 7502, agentPresent: true, syncedAt: "2026-09-30T18:00:00.000Z",
    observedAt: "2026-09-30T18:00:00.000Z",
    fetchBars: vi.fn(async () => ({ ok: true as const, payload: { symbol: "MQZA", fetchedAt: "x", bars: [{ date: "2026-09-29", open: 14, high: 14, low: 14, close: 14.2, volume: 1, average: 14.1 }] } })),
    ...fields,
  };
}

beforeEach(async () => {
  resetAnchorGuards();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("anchorPending", () => {
  it("sets S₀ from the sale day's VWAP once the live window has passed", async () => {
    await anchorPending(db, "beta", [WHEEL], inputs({}));
    expect((await db.alertStates.get(["beta", WHEEL.id]))?.anchor).toMatchObject({ price: 14.1, source: "vwap" });
  });

  it("asks the bars once per account, ticker and agent pass", async () => {
    const fetchBars = vi.fn(async () => ({ ok: false as const, code: "tws-unreachable" as const }));
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars }));
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars }));
    expect(fetchBars).toHaveBeenCalledTimes(1);
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars, syncedAt: "2026-09-30T18:05:00.000Z" }));
    expect(fetchBars).toHaveBeenCalledTimes(2);
  });

  it("asks nothing without the agent", async () => {
    const fetchBars = vi.fn();
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars, agentPresent: false }));
    expect(fetchBars).not.toHaveBeenCalled();
  });
});
```

`saleWhen` est une heure IB (New York stampée UTC) ; `observedAt` vrai UTC le lendemain : la fenêtre live (`ANCHOR_LIVE_WINDOW_MS`) est passée.

- [x] **Step 2: Run test to verify it fails**

Run : `npx vitest run src/alerts/anchors.test.ts`
Expected: FAIL — `Cannot find module './anchors'`.

- [x] **Step 3: Write minimal implementation**

`pass.ts` : déplacer **tel quel** depuis `useAlertEngine.ts` le commentaire, `PassInputs` et `runPass`, plus `noPrice`, et nommer son type de retour `Triggered[]`. Le hook les importe.

`anchors.ts` :

```ts
import { ANCHOR_LIVE_WINDOW_MS, chooseAnchor, type Alert, type PriceQuote, type WheelAlert } from "@ib/alerts";
import { toReportTime } from "@ib/ib-parsers";
import type { BarsResult } from "@/agent/client";
import { setAlertAnchor } from "@/db/alerts";
import type { AppDatabase, SnapshotRecord } from "@/db/schema";

export interface AnchorInputs {
  snapshot: SnapshotRecord | null;
  priceOf: (ticker: string) => PriceQuote | null;
  port: number | undefined;
  agentPresent: boolean;
  /** `lastAgentSyncAt` of the account: the bars are asked again only after a new agent pass. */
  syncedAt: string | undefined;
  /** True UTC instant of the observation. */
  observedAt: string;
  fetchBars: (port: number, symbol: string, currency?: string) => Promise<BarsResult>;
}

// Shared by the shell's engine and the watcher (sub-project 43): one request per account,
// ticker and agent pass, whoever asks.
const barsAsked = new Set<string>();

/** Test seam. */
export function resetAnchorGuards(): void {
  barsAsked.clear();
}

/**
 * S₀ of the Wheel alerts still without one (spec of sub-project 42, §6.2): the price of the moment
 * if the sale is fresh, else the sale day's bar. Never throws: a failed write or request leaves
 * S₀ to the next pass.
 */
export async function anchorPending(db: AppDatabase, accountId: string, alerts: readonly Alert[], inputs: AnchorInputs): Promise<void> {
  const pending = alerts.filter((a): a is WheelAlert => a.kind === "wheel" && a.anchor === null);
  if (pending.length === 0) return;
  const { snapshot, priceOf, observedAt } = inputs;
  const live = (ticker: string) => {
    if (snapshot?.source !== "agent") return null;
    const quote = priceOf(ticker);
    return quote?.realtime ? { price: quote.price, at: snapshot.asOf } : null;
  };
  const writes: Promise<unknown>[] = [];
  const needBars = new Map<string, WheelAlert[]>();
  // `saleWhen` est une heure IB : l'instant présent s'y compare une fois passé par `toReportTime`.
  const nowReport = Date.parse(toReportTime(observedAt));
  for (const alert of pending) {
    const anchor = chooseAnchor({ saleWhen: alert.saleWhen, observedAt, live: live(alert.ticker), dayBar: null });
    if (anchor !== null) writes.push(setAlertAnchor(db, accountId, alert.id, anchor));
    // Tant que la fenêtre est ouverte, seul le prix du moment vaut S₀ : un VWAP de journée
    // entamée serait figé à sa place. On attend un snapshot `agent` pris dans la fenêtre.
    else if (nowReport - Date.parse(alert.saleWhen) > ANCHOR_LIVE_WINDOW_MS) {
      const key = `${alert.ticker}|${alert.currency}`;
      needBars.set(key, [...(needBars.get(key) ?? []), alert]);
    }
  }
  const { port } = inputs;
  if (inputs.agentPresent && port !== undefined) {
    for (const [key, group] of needBars) {
      const guard = `${accountId}|${key}|${inputs.syncedAt ?? ""}`;
      if (barsAsked.has(guard)) continue;
      barsAsked.add(guard);
      const { ticker, currency } = group[0];
      writes.push(
        inputs.fetchBars(port, ticker, currency).then(async (result) => {
          if (!result.ok) return;
          for (const alert of group) {
            const bar = result.payload.bars.find((b) => b.date === alert.saleWhen.slice(0, 10));
            const anchor = chooseAnchor({ saleWhen: alert.saleWhen, observedAt, live: null, dayBar: bar ? { average: bar.average, close: bar.close } : null });
            if (anchor !== null) await setAlertAnchor(db, accountId, alert.id, anchor);
          }
        }),
      );
    }
  }
  await Promise.all(writes.map((write) => write.catch(() => {})));
}
```

Dans `useAlertEngine.ts`, l'effet S₀ devient :

```ts
  const port = account?.twsPort;
  const syncedAt = account?.lastAgentSyncAt;
  useEffect(() => {
    if (!ready || alerts === null) return;
    void anchorPending(db, accountId, alerts, {
      snapshot: ownSnapshot ?? null, priceOf, port, agentPresent: presence === "present", syncedAt,
      observedAt: new Date().toISOString(), fetchBars,
    });
  }, [ready, alerts, ownSnapshot, priceOf, presence, port, syncedAt, db, accountId]);
```

Le `barsAsked` ref du hook disparaît. Dans `useAlertEngine.test.tsx`, ajouter `resetAnchorGuards()` au `beforeEach` (le garde est désormais de module) — aucune autre modification.

- [x] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/alerts`
Expected: PASS, `useAlertEngine.test.tsx` compris.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/alerts docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Alertes : la passe et la pose de S₀ sortent du hook"
```

---

### Task 3: `evaluateAccountAlerts`, l'évaluation d'un compte hors React

**Files:**
- Create: `apps/web/src/alerts/evaluateAccount.ts`
- Test: `apps/web/src/alerts/evaluateAccount.test.ts`

**Interfaces:**
- Consumes: `loadAccountJournals` (tâche 1), `runPass`, `noPrice`, `Triggered` (tâche 2), `anchorPending` (tâche 2), `alertPriceOf` (`alerts/prices.ts`), `alertMargins` (`lib/alertMargins.ts`).
- Produces:
  ```ts
  export interface EvaluateAccountDeps {
    /** false after a failed agent pass: no price is fresh, the pass only purges. */
    fresh: boolean;
    /** Quotes the tickers into the in-memory table (`refreshQuotes`). */
    quote: (port: number, tickers: readonly string[]) => Promise<void>;
    /** The in-memory quote table (`getQuotesSnapshot`). */
    quotes: () => QuoteMap;
    fetchBars: (port: number, symbol: string, currency?: string) => Promise<BarsResult>;
    now: () => Date;
  }
  export function evaluateAccountAlerts(db: AppDatabase, accountId: string, deps: EvaluateAccountDeps): Promise<Triggered[]>;
  ```

- [x] **Step 1: Write the failing test**

Reprendre les fabriques `account`, `trade`, `position`, `CONDOR_TRANSACTIONS` et `WHEEL_TRANSACTIONS` de `useAlertEngine.test.tsx` (les copier en tête du fichier : elles n'y sont pas exportées).

```ts
// apps/web/src/alerts/evaluateAccount.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteMap } from "@/agent/quotes";
import { createManualAlert } from "@/db/alerts";
import { db } from "@/db/schema";
import { resetAnchorGuards } from "./anchors";
import { evaluateAccountAlerts, type EvaluateAccountDeps } from "./evaluateAccount";
// … fabriques copiées de useAlertEngine.test.tsx …

const quoteTable = (entries: Record<string, number>): QuoteMap =>
  new Map(Object.entries(entries).map(([ticker, last]) => [ticker, { last, close: last, change: 0 }])) as QuoteMap;

function deps(fields: Partial<EvaluateAccountDeps> = {}): EvaluateAccountDeps {
  return {
    fresh: true,
    quote: vi.fn(async () => {}),
    quotes: () => quoteTable({}),
    fetchBars: vi.fn(async () => ({ ok: false as const, code: "tws-unreachable" as const })),
    now: () => new Date("2026-09-30T18:00:00.000Z"),
    ...fields,
  };
}

beforeEach(async () => {
  resetAnchorGuards();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("evaluateAccountAlerts", () => {
  it("triggers a manual alert on its quote, once", async () => {
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, currentPrice: 250, note: null });
    const d = deps({ quotes: () => quoteTable({ AAPL: 244 }) });
    const first = await evaluateAccountAlerts(db, "beta", d);
    expect(first.map((t) => [t.alert.ticker, t.price])).toEqual([["AAPL", 244]]);
    expect(await evaluateAccountAlerts(db, "beta", d)).toEqual([]);
    expect(d.quote).toHaveBeenCalledWith(7502, ["AAPL"]);
  });

  it("triggers a condor alert from the account's own journals", async () => {
    await db.accounts.add(account("beta", { twsPort: 7502, strategies: ["wheel", "condors"] }));
    await db.transactions.bulkAdd(CONDOR_TRANSACTIONS);
    const triggered = await evaluateAccountAlerts(db, "beta", deps({ quotes: () => quoteTable({ QQQ: 615 }) }));
    expect(triggered.map((t) => t.alert.kind)).toEqual(["condor"]);
  });

  it("purges but never triggers when the agent pass failed", async () => {
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, currentPrice: 250, note: null });
    await db.alertStates.put({ accountId: "beta", alertId: "wheel:gone", triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null });
    const d = deps({ fresh: false, quotes: () => quoteTable({ AAPL: 244 }) });
    expect(await evaluateAccountAlerts(db, "beta", d)).toEqual([]);
    expect(d.quote).not.toHaveBeenCalled();
    expect(await db.alertStates.get(["beta", "wheel:gone"])).toBeUndefined();
  });

  it("never touches another account's states", async () => {
    await db.accounts.bulkAdd([account("alpha", { twsPort: 7501 }), account("beta", { twsPort: 7502 })]);
    await db.alertStates.put({ accountId: "alpha", alertId: "wheel:x", triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null });
    await evaluateAccountAlerts(db, "beta", deps());
    expect(await db.alertStates.get(["alpha", "wheel:x"])).toBeDefined();
  });

  it("answers nothing for an unknown account", async () => {
    expect(await evaluateAccountAlerts(db, "nobody", deps())).toEqual([]);
  });
});
```

Adapter la forme de `createManualAlert` et d'une entrée de `QuoteMap` à leurs signatures réelles (`db/alerts.ts`, `agent/quotes.ts`) ; l'assertion, elle, ne change pas. Pour le condor : 615 est sous le seuil 616 calculé dans `useAlertEngine.test.tsx` (« alert under 616 ») — si le test du hook sème le condor autrement (stratégies actives, snapshot), reprendre exactement son semis.

- [x] **Step 2: Run test to verify it fails**

Run : `npx vitest run src/alerts/evaluateAccount.test.ts`
Expected: FAIL — `Cannot find module './evaluateAccount'`.

- [x] **Step 3: Write minimal implementation**

```ts
// apps/web/src/alerts/evaluateAccount.ts
import { autoAlerts, manualAlerts, type AlertState } from "@ib/alerts";
import type { BarsResult } from "@/agent/client";
import type { QuoteMap } from "@/agent/quotes";
import { loadAccountJournals } from "@/db/journals";
import type { AppDatabase } from "@/db/schema";
import { alertMargins } from "@/lib/alertMargins";
import { anchorPending } from "./anchors";
import { noPrice, runPass, type Triggered } from "./pass";
import { alertPriceOf } from "./prices";

export interface EvaluateAccountDeps {
  /** false after a failed agent pass: no price is fresh, the pass only purges. */
  fresh: boolean;
  /** Quotes the tickers into the in-memory table (`refreshQuotes`). */
  quote: (port: number, tickers: readonly string[]) => Promise<void>;
  /** The in-memory quote table (`getQuotesSnapshot`). */
  quotes: () => QuoteMap;
  fetchBars: (port: number, symbol: string, currency?: string) => Promise<BarsResult>;
  now: () => Date;
}

/**
 * One account's alerts evaluated outside React, by the watcher (sub-project 43, §4): its journals
 * read from the base, its alerts' tickers quoted, the shell's own pass, then S₀. No React, no DOM:
 * what a Worker would run.
 */
export async function evaluateAccountAlerts(db: AppDatabase, accountId: string, deps: EvaluateAccountDeps): Promise<Triggered[]> {
  const loaded = await loadAccountJournals(db, accountId);
  if (loaded === null) return [];
  const { account, snapshot, journals } = loaded;
  const rows = journals.report.rows;
  const margins = alertMargins(account);
  const [defs, stored] = await Promise.all([
    db.alerts.where("accountId").equals(accountId).toArray(),
    db.alertStates.where("accountId").equals(accountId).toArray(),
  ]);
  const states = new Map(stored.map((s) => [s.alertId, s as AlertState]));
  const alerts = [...manualAlerts(defs), ...autoAlerts(rows, margins, states)];
  const port = account.twsPort;
  if (deps.fresh && port !== undefined) {
    const tickers = [...new Set(alerts.map((a) => a.ticker))].sort();
    if (tickers.length > 0) await deps.quote(port, tickers);
  }
  const priceOf = deps.fresh ? alertPriceOf(snapshot, deps.quotes()) : noPrice;
  const triggered = await runPass({ db, accountId, rows, margins, priceOf });
  if (deps.fresh) {
    await anchorPending(db, accountId, alerts, {
      snapshot, priceOf, port, agentPresent: true, syncedAt: account.lastAgentSyncAt,
      observedAt: deps.now().toISOString(), fetchBars: deps.fetchBars,
    });
  }
  return triggered;
}
```

- [x] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/alerts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/alerts/evaluateAccount.ts apps/web/src/alerts/evaluateAccount.test.ts docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Alertes : un compte s'évalue hors React"
```

---

### Task 4: Une connexion TWS à la fois entre onglets, et `runAgentSync`

**Files:**
- Create: `apps/web/src/test/fakeLocks.ts`
- Modify: `apps/web/src/agent/client.ts` (`exclusiveTws`, `TWS_LOCK`), `apps/web/src/agent/useAgentSync.ts` (`runAgentSync`, `run`)
- Test: `apps/web/src/agent/client.test.ts` (créer ou compléter), `apps/web/src/agent/useAgentSync.test.tsx`

**Interfaces:**
- Produces:
  - `TWS_LOCK = "ib2:tws"` ; `exclusiveTws<T>(call: () => Promise<T>): Promise<T>` (même signature) ;
  - `runAgentSync(db: AppDatabase, accountId: string): Promise<AgentSyncOutcome | null>` — `null` si l'id est vide, le compte inconnu ou déjà en cours de synchro ;
  - `class FakeLocks implements Pick<LockManager, "request">` + `held(name): boolean` pour les tests.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/test/fakeLocks.ts
/**
 * An in-memory `navigator.locks` for jsdom, which has none (sub-project 43): exclusive locks
 * granted in request order, `signal` honoured while waiting, released when the callback's
 * promise settles.
 */
export class FakeLocks {
  private tails = new Map<string, Promise<unknown>>();
  private holders = new Map<string, number>();

  held(name: string): boolean {
    return (this.holders.get(name) ?? 0) > 0;
  }

  request<T>(name: string, ...args: [(lock: Lock | null) => T | Promise<T>] | [LockOptions, (lock: Lock | null) => T | Promise<T>]): Promise<T> {
    const [options, callback] = args.length === 1 ? [{} as LockOptions, args[0]] : args;
    const previous = this.tails.get(name) ?? Promise.resolve();
    let aborted = false;
    const abortion = new Promise<never>((_, reject) => {
      options.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    const turn = previous.then(async () => {
      if (aborted) return undefined as T;
      this.holders.set(name, (this.holders.get(name) ?? 0) + 1);
      try {
        return await callback({ name, mode: "exclusive" } as Lock);
      } finally {
        this.holders.set(name, (this.holders.get(name) ?? 1) - 1);
      }
    });
    this.tails.set(name, turn.catch(() => undefined));
    return options.signal ? Promise.race([turn, abortion]) : turn;
  }
}
```

```ts
// apps/web/src/agent/client.test.ts — ajouter
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeLocks } from "@/test/fakeLocks";
import { exclusiveTws, TWS_LOCK } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("exclusiveTws", () => {
  it("goes through the browser-wide lock when there is one, one call at a time", async () => {
    const locks = new FakeLocks();
    const request = vi.spyOn(locks, "request");
    vi.stubGlobal("navigator", { ...navigator, locks });
    let running = 0;
    let most = 0;
    const call = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };
    await Promise.all([exclusiveTws(call), exclusiveTws(call), exclusiveTws(call)]);
    expect(most).toBe(1);
    expect(request.mock.calls.every(([name]) => name === TWS_LOCK)).toBe(true);
  });

  it("still serializes without navigator.locks", async () => {
    let running = 0;
    let most = 0;
    const call = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };
    await Promise.all([exclusiveTws(call), exclusiveTws(call)]);
    expect(most).toBe(1);
  });

  it("lets the next call run after one that throws", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: new FakeLocks() });
    await expect(exclusiveTws(async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(exclusiveTws(async () => 1)).resolves.toBe(1);
  });
});
```

Dans `useAgentSync.test.tsx`, ajouter (le `mockAgent` du fichier sert) :

```ts
describe("runAgentSync", () => {
  it("syncs the account and answers the outcome", async () => {
    const calls = mockAgent();
    expect(await runAgentSync(db, "beta")).toMatchObject({ status: "ok" });
    expect(calls.snapshot).toBe(1);
  });

  it("answers null for an account already syncing, and does not call the agent twice", async () => {
    const calls = mockAgent();
    const [first, second] = await Promise.all([runAgentSync(db, "beta"), runAgentSync(db, "beta")]);
    expect([first?.status, second]).toEqual(["ok", null]);
    expect(calls.snapshot).toBe(1);
  });

  it("answers null for an unknown account", async () => {
    mockAgent();
    expect(await runAgentSync(db, "nobody")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run : `npx vitest run src/agent/client.test.ts src/agent/useAgentSync.test.tsx`
Expected: FAIL — `TWS_LOCK` et `runAgentSync` non exportés.

- [ ] **Step 3: Write minimal implementation**

`client.ts` :

```ts
/** The browser-wide lock every TWS connection takes (sub-project 43, §5). */
export const TWS_LOCK = "ib2:tws";

// Every agent call that opens a TWS connection goes through here, one after the other: the agent
// connects with clientId 0 each time, and TWS refuses a second connection on the same clientId
// while the first lives (spec of sub-project 35, §4). Across tabs too (sub-project 43, §5): two
// tabs may each poll, and the watcher passes with its tab hidden. Without the Web Locks API, the
// tab's own queue. A call's own timeout only starts on its turn.
let twsQueue: Promise<unknown> = Promise.resolve();

export function exclusiveTws<T>(call: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks) return locks.request(TWS_LOCK, () => call());
  const turn = twsQueue.then(call, call);
  twsQueue = turn.catch(() => undefined);
  return turn;
}
```

`useAgentSync.ts` :

```ts
/**
 * One agent pass for one account, shared by the Refresh button and the watcher (sub-project 43,
 * §3.3): `null` when there is nothing to do — no id, an unknown account, or a pass of this account
 * already running in this tab.
 */
export async function runAgentSync(db: AppDatabase, accountId: string): Promise<AgentSyncOutcome | null> {
  // Check-then-add with no `await` in between: two callers in one tick cannot both pass.
  if (!accountId || runningAccounts.has(accountId)) return null;
  runningAccounts.add(accountId);
  notify();
  try {
    const account = await db.accounts.get(accountId);
    if (!account) return null;
    return await syncAgent({ db, fetchSnapshot, now: () => new Date() }, account);
  } finally {
    runningAccounts.delete(accountId);
    notify();
  }
}
```

et dans `useAgentSync`, `run` devient `useCallback(async () => { lastRunAt.set(accountId, Date.now()); await runAgentSync(db, accountId); }, [accountId, db])` — `lastRunAt` reste jusqu'à la tâche 6, qui le retire avec `useAgentPolling`. Importer `AgentSyncOutcome` depuis `./sync` et `AppDatabase` depuis `@/db/schema`.

- [ ] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/test/fakeLocks.ts apps/web/src/agent docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Agent : une connexion TWS à la fois entre onglets, runAgentSync partagé"
```

---

### Task 5: La notification nomme le compte

**Files:**
- Modify: `apps/web/src/alerts/notify.ts`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`, `apps/web/src/alerts/useAlertEngine.ts`
- Test: `apps/web/src/alerts/notify.test.ts`

**Interfaces:**
- Produces: `notifyTriggered(alert: Alert, onOpen: () => void, t: TFunction, locale: string, price?: number, account?: string): void` — `account` défini ⇒ titre préfixé.

- [ ] **Step 1: Write the failing test**

```ts
// notify.test.ts — dans describe("notifyTriggered")
  it("names the account in the title when one is given", () => {
    notifyTriggered(WHEEL, () => {}, t, "fr", undefined, "beta");
    notifyTriggered(WHEEL, () => {}, i18n.getFixedT("en"), "en", undefined, "beta");
    expect(FakeNotification.created.map((n) => n.title)).toEqual(["beta · ZXAB ↑ 38,20", "beta · ZXAB ↑ 38.20"]);
  });
```

Et un test de `useAlertEngine.test.tsx` (le fichier a déjà `FakeNotification`) : deux comptes en base, le compte affiché `beta`, une alerte manuelle déclenchée ⇒ titre `"beta · …"` ; un seul compte ⇒ titre sans préfixe. Suivre la structure du test de notification existant du fichier et n'ajouter que le second compte et l'assertion de titre.

- [ ] **Step 2: Run test to verify it fails**

Run : `npx vitest run src/alerts/notify.test.ts src/alerts/useAlertEngine.test.tsx`
Expected: FAIL — titre sans préfixe.

- [ ] **Step 3: Write minimal implementation**

`fr.json` et `en.json`, dans `alerts.notify` : `"title_account": "{{account}} · {{title}}"` (identique dans les deux langues).

`notify.ts` :

```ts
export function notifyTriggered(alert: Alert, onOpen: () => void, t: TFunction, locale: string, price?: number, account?: string): void {
  // … inchangé jusqu'au titre …
  const bare = t(threshold.direction === "above" ? "alerts.notify.title_above" : "alerts.notify.title_below", {
    ticker: alert.ticker,
    price: formatLocalePrice(threshold.price, locale),
  });
  const title = account === undefined ? bare : t("alerts.notify.title_account", { account, title: bare });
  // … inchangé …
}
```

Compléter la doc du paramètre : « `account`, à partir de deux comptes dans le navigateur (sous-projet 43) : le titre le nomme ». Attention à l'échappement d'i18next : si `title` est échappé (`&amp;`…), passer `interpolation: { escapeValue: false }` dans l'appel — vérifier sur le test.

`useAlertEngine.ts` : lire le nombre de comptes par `useAccounts()` (`db/hooks.ts`), le garder dans `tRef` (`named: (accounts?.length ?? 0) > 1`), et passer `tRef.current.named ? accountId : undefined` en dernier argument de `notifyTriggered`.

- [ ] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/alerts src/i18n`
Expected: PASS (parité fr/en comprise).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/alerts apps/web/src/i18n docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Alertes : la notification nomme le compte dès deux comptes"
```

---

### Task 6: Le veilleur

**Files:**
- Create: `apps/web/src/alerts/watcher.ts`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/agent/useAgentSync.ts` (retirer `useAgentPolling`, `lastRunAt`), `apps/web/src/agent/useAgentSync.test.tsx` (retirer le `describe("useAgentPolling")` et l'appel du `Probe`), `apps/web/src/flex/useFlexAutoSync.test.tsx:201` (commentaire : « what the watcher's probe or the Sources page does »)
- Test: `apps/web/src/alerts/watcher.test.ts`

**Interfaces:**
- Consumes: `runAgentSync` (tâche 4), `evaluateAccountAlerts` (tâche 3), `notifyTriggered` (tâche 5), `refreshPresence`, `AGENT_POLL_MS` (`agent/useAgentSync.ts`), `refreshQuotes`, `getQuotesSnapshot` (`agent/quotes.ts`), `fetchBars` (`agent/client.ts`), `FakeLocks` (tâche 4).
- Produces:
  ```ts
  export interface WatcherDeps {
    db: AppDatabase;
    /** Opens an in-app path (the router's `navigate`). */
    open: (path: string) => void;
    /** `navigator.locks` by default; `null` watches alone, without an election. */
    locks?: Pick<LockManager, "request"> | null;
  }
  export function startAlertWatcher(deps: WatcherDeps): () => void; // returns stop
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/alerts/watcher.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQuotes } from "@/agent/quotes";
import { AGENT_POLL_MS, agentPresence, resetAgentState } from "@/agent/useAgentSync";
import { createManualAlert } from "@/db/alerts";
import { db, type AccountRecord } from "@/db/schema";
import { FakeLocks } from "@/test/fakeLocks";
import { resetAnchorGuards } from "./anchors";
import { startAlertWatcher } from "./watcher";

const account = (id: string, fields: Partial<AccountRecord> = {}): AccountRecord => ({
  id, label: id, ibAccountId: "U1234567", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [], ...fields,
});

const PAYLOAD = { accounts: ["U1234567"], fetchedAt: "2026-09-30T18:00:00.000Z", cashAvailable: 1, positions: [], executions: [] };

/**
 * The agent: /health (absent unless `present`), /snapshot per port (`down` ports answer 503),
 * /quotes answering `last` for every asked symbol. Counts calls by kind and port.
 */
function mockAgent({ present = true, down = [] as number[], last = 244 } = {}) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(`${url.pathname}${url.searchParams.get("port") ? `:${url.searchParams.get("port")}` : ""}`);
    if (url.pathname === "/health") {
      if (!present) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    }
    if (url.pathname === "/snapshot") {
      if (down.includes(Number(url.searchParams.get("port")))) return new Response("", { status: 503 });
      return new Response(JSON.stringify(PAYLOAD), { status: 200 });
    }
    if (url.pathname === "/quotes") {
      const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      return new Response(JSON.stringify({ fetchedAt: "2026-09-30T18:00:00.000Z", quotes: symbols.map((symbol) => ({ symbol, last, close: 250 })) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static created: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(public title: string) {
    FakeNotification.created.push(this);
  }
}

const flush = () => vi.advanceTimersByTimeAsync(50);
const stops: (() => void)[] = [];
function start(deps: Partial<Parameters<typeof startAlertWatcher>[0]> = {}) {
  const stop = startAlertWatcher({ db, open: vi.fn(), locks: null, ...deps });
  stops.push(stop);
  return stop;
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-09-30T18:00:00.000Z"));
  resetAgentState();
  resetQuotes();
  resetAnchorGuards();
  FakeNotification.created = [];
  vi.stubGlobal("Notification", FakeNotification);
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterEach(() => {
  while (stops.length > 0) stops.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startAlertWatcher", () => {
  it("triggers and notifies another account's alert with no account page mounted", async () => {
    mockAgent({ last: 244 });
    await db.accounts.bulkAdd([account("alpha", { twsPort: 7501 }), account("beta", { twsPort: 7502 })]);
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, currentPrice: 250, note: null });
    const open = vi.fn();
    start({ open });
    await vi.waitFor(() => expect(FakeNotification.created.map((n) => n.title)).toEqual(["beta · AAPL ↓ 245,00"]));
    FakeNotification.created[0].onclick?.();
    expect(open).toHaveBeenCalledWith("/accounts/beta/alerts");
  });

  it("never calls the agent for an account without a TWS port", async () => {
    const calls = mockAgent();
    await db.accounts.bulkAdd([account("alpha"), account("beta", { twsPort: 7502 })]);
    start();
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith("/snapshot"))).toEqual(["/snapshot:7502"]));
  });

  it("writes nothing when the agent is absent", async () => {
    mockAgent({ present: false });
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, currentPrice: 250, note: null });
    start();
    await flush();
    expect(await db.alertStates.count()).toBe(0);
    expect((await db.accounts.get("beta"))?.lastAgentSyncAt).toBeUndefined();
  });

  it("still evaluates beta when alpha's TWS is unreachable", async () => {
    mockAgent({ down: [7501], last: 244 });
    await db.accounts.bulkAdd([account("alpha", { twsPort: 7501 }), account("beta", { twsPort: 7502 })]);
    await createManualAlert(db, "alpha", { ticker: "AAPL", price: 245, currentPrice: 250, note: null });
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, currentPrice: 250, note: null });
    start();
    await vi.waitFor(() => expect(FakeNotification.created.map((n) => n.title)).toEqual(["beta · AAPL ↓ 245,00"]));
  });

  it("passes every five minutes with its tab hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const calls = mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    start();
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith("/snapshot"))).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith("/snapshot"))).toHaveLength(2));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("never runs two passes at once, and arms the next one at the end of a pass", async () => {
    let inFlight = 0;
    let most = 0;
    mockAgent();
    const original = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/snapshot")) {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, AGENT_POLL_MS * 2));
        inFlight -= 1;
      }
      return original(input, init);
    });
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    start();
    await vi.advanceTimersByTimeAsync(AGENT_POLL_MS * 5);
    expect(most).toBe(1);
  });

  it("passes at once when an account gains a TWS port", async () => {
    const calls = mockAgent();
    await db.accounts.add(account("beta"));
    start();
    await flush();
    expect(calls.filter((c) => c.startsWith("/snapshot"))).toEqual([]);
    await db.accounts.update("beta", { twsPort: 7502 });
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith("/snapshot"))).toEqual(["/snapshot:7502"]));
  });

  it("passes in one tab only, and the other takes over when the first stops", async () => {
    const calls = mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const locks = new FakeLocks();
    const first = start({ locks });
    start({ locks });
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith("/snapshot"))).toHaveLength(1));
    await flush();
    expect(calls.filter((c) => c.startsWith("/snapshot"))).toHaveLength(1);
    first();
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith("/snapshot"))).toHaveLength(2));
  });

  it("a tab that does not lead still probes the agent", async () => {
    mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const locks = new FakeLocks();
    // Another tab holds the lock forever — never awaited: it never settles.
    void locks.request("ib2:watcher:" + db.name, () => new Promise(() => {}));
    start({ locks });
    await vi.waitFor(() => expect(agentPresence().status).toBe("present"));
  });

  it("releases its lock when stopped, and a watcher stopped while waiting never passes", async () => {
    const calls = mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const locks = new FakeLocks();
    const first = start({ locks });
    const second = start({ locks });
    second();
    await vi.waitFor(() => expect(locks.held("ib2:watcher:" + db.name)).toBe(true));
    first();
    await flush();
    expect(locks.held("ib2:watcher:" + db.name)).toBe(false);
    expect(calls.filter((c) => c.startsWith("/snapshot"))).toHaveLength(1);
  });
});
```

`agentPresence()` est un accesseur non-hook ajouté à `agent/useAgentSync.ts` par cette tâche (Step 3).
Une correction à faire en écrivant le fichier, sans changer ce que les tests affirment :
- adapter `PAYLOAD`, la forme de `/quotes` et la lecture du port aux réponses réelles de l'agent (voir `apps/web/src/mocks/agent-snapshot.json`, `agent-quotes.json` et `agent/client.ts` : si le port voyage dans un en-tête ou un autre paramètre, compter par ce moyen).

- [ ] **Step 2: Run test to verify it fails**

Run : `npx vitest run src/alerts/watcher.test.ts`
Expected: FAIL — `Cannot find module './watcher'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/alerts/watcher.ts
import { liveQuery } from "dexie";
import { fetchBars } from "@/agent/client";
import { getQuotesSnapshot, refreshQuotes } from "@/agent/quotes";
import { AGENT_POLL_MS, refreshPresence, runAgentSync } from "@/agent/useAgentSync";
import type { AppDatabase } from "@/db/schema";
import i18n from "@/i18n";
import { evaluateAccountAlerts } from "./evaluateAccount";
import { notifyTriggered } from "./notify";

export interface WatcherDeps {
  db: AppDatabase;
  /** Opens an in-app path (the router's `navigate`). */
  open: (path: string) => void;
  /** `navigator.locks` by default; `null` watches alone, without an election. */
  locks?: Pick<LockManager, "request"> | null;
}

function defaultLocks(): Pick<LockManager, "request"> | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

/**
 * One pass over every account with a TWS port, one after the other (sub-project 43, §3.3): the
 * agent pass, then the account's alerts, then a notification per alert triggered. An account's
 * failure never stops the next one.
 */
async function pass(db: AppDatabase, open: (path: string) => void): Promise<void> {
  if ((await refreshPresence()).status !== "present") return;
  const accounts = await db.accounts.orderBy("id").toArray();
  const named = accounts.length > 1;
  for (const account of accounts) {
    if (account.twsPort === undefined) continue;
    try {
      const outcome = await runAgentSync(db, account.id);
      if (outcome === null) continue;
      const triggered = await evaluateAccountAlerts(db, account.id, {
        fresh: outcome.status === "ok",
        quote: refreshQuotes,
        quotes: getQuotesSnapshot,
        fetchBars,
        now: () => new Date(),
      });
      for (const { alert, price } of triggered) {
        notifyTriggered(alert, () => open(`/accounts/${account.id}/alerts`), i18n.t, i18n.language, price, named ? account.id : undefined);
      }
    } catch {
      // A closed base, an engine that throws: the next account passes, the next pass retries.
    }
    // Hands the main thread back between two accounts' journals.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The alert watcher (sub-project 43): started once per tab by `main.tsx`, whatever the route. Every
 * tab probes the agent (its presence is the tab's own state); only the tab holding
 * `ib2:watcher:<base>` passes — at once, then `AGENT_POLL_MS` after the end of each pass, hidden
 * or not, and at once when an account gains a TWS port. Returns `stop`, which releases the lock.
 */
export function startAlertWatcher({ db, open, locks = defaultLocks() }: WatcherDeps): () => void {
  let stopped = false;

  // Presence, in every tab.
  let hasPort = false;
  let lastProbe = 0;
  const probe = () => {
    if (stopped || !hasPort) return;
    lastProbe = Date.now();
    void refreshPresence();
  };
  const probeTimer = setInterval(probe, AGENT_POLL_MS);
  const onVisibility = () => {
    if (document.visibilityState === "visible" && Date.now() - lastProbe >= AGENT_POLL_MS) probe();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Passes, in the leading tab only.
  let leading = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = async (): Promise<void> => {
    if (!leading || stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    clearTimeout(timer);
    try {
      do {
        again = false;
        lastProbe = Date.now();
        await pass(db, open);
      } while (again && !stopped);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void request(), AGENT_POLL_MS);
    }
  };

  let ports: Set<string> | null = null;
  const subscription = liveQuery(() => db.accounts.toArray()).subscribe({
    next: (accounts) => {
      const next = new Set(accounts.filter((a) => a.twsPort !== undefined).map((a) => `${a.id}|${a.twsPort}`));
      const first = ports === null;
      const gained = !first && [...next].some((key) => !ports!.has(key));
      ports = next;
      hasPort = next.size > 0;
      if (first) probe();
      else if (gained) {
        probe();
        void request();
      }
    },
    error: () => {},
  });

  const controller = new AbortController();
  let release: (() => void) | undefined;
  const lead = () => {
    leading = true;
    void request();
  };
  if (locks) {
    locks
      .request(`ib2:watcher:${db.name}`, { signal: controller.signal }, () => {
        if (stopped) return undefined;
        lead();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {});
  } else lead();

  return () => {
    stopped = true;
    leading = false;
    clearTimeout(timer);
    clearInterval(probeTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    subscription.unsubscribe();
    controller.abort();
    release?.();
  };
}
```

`agent/useAgentSync.ts` : supprimer `useAgentPolling`, `lastRunAt` (et son usage dans `run` et `resetAgentState`) ; ajouter `export function agentPresence(): AgentPresence { return presence; }` ; garder `AGENT_POLL_MS` et mettre à jour son commentaire (« the watcher's cadence, sub-project 43 »).

`routes/AppLayout.tsx` : retirer l'import et l'appel de `useAgentPolling` ; le commentaire au-dessus de `useFlexAutoSync` ne parle plus que de lui.

`main.tsx` : dans le rendu de `startApp`, après `createRoot(...).render(...)`, démarrer le veilleur — après la graine de démonstration, jamais avant :

```tsx
import { startAlertWatcher } from "@/alerts/watcher";
import { router } from "@/routes/router";
// …
  () => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // Les alertes de tous les comptes, sur toutes les pages, onglet masqué compris (sous-projet 43).
    startAlertWatcher({ db, open: (path) => void router.navigate(path) });
  },
```

`useAgentSync.test.tsx` : retirer `describe("useAgentPolling")`, `setVisibility` s'il n'a plus d'usage, et `useAgentPolling(accountId)` du `Probe`.

- [ ] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/alerts src/agent src/routes src/flex`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Alertes : un veilleur vérifie tous les comptes, onglet masqué compris"
```

---

### Task 7: La pastille du sélecteur de compte

**Files:**
- Modify: `apps/web/src/db/hooks.ts` (`useTriggeredAlertCounts`), `apps/web/src/components/AccountSwitcher.tsx`
- Test: `apps/web/src/components/AccountSwitcher.test.tsx`

**Interfaces:**
- Produces: `useTriggeredAlertCounts(): ReadonlyMap<string, number> | undefined` — par `accountId`, les états `triggeredAt !== null && acknowledgedAt === null`.

- [ ] **Step 1: Write the failing test**

Dans `AccountSwitcher.test.tsx`, suivre le rendu existant (`MemoryRouter`, comptes semés) :

```tsx
describe("AccountSwitcher alert badges", () => {
  const state = (accountId: string, alertId: string, fields: Partial<AlertStateRecord> = {}): AlertStateRecord => ({
    accountId, alertId, triggeredAt: "2026-09-30T18:00:00.000Z", acknowledgedAt: null, disabled: false, armed: false, anchor: null, override: null, ...fields,
  });

  it("shows the other accounts' triggered alerts on the closed button, never the current one's", async () => {
    await db.alertStates.bulkPut([
      state("alpha", "manual:1"),
      state("beta", "manual:2"),
      state("beta", "manual:3"),
      state("beta", "manual:4", { acknowledgedAt: "2026-09-30T18:05:00.000Z" }),
    ]);
    renderSwitcher("alpha"); // l'aide de rendu existante du fichier, compte affiché alpha
    const trigger = await screen.findByRole("combobox", { name: "Compte" });
    await waitFor(() => expect(within(trigger).getByLabelText(/2/)).toBeInTheDocument());
    expect(trigger).toHaveTextContent(/^alpha/);
  });

  it("shows each account's count in the list", async () => {
    await db.alertStates.bulkPut([state("alpha", "manual:1"), state("beta", "manual:2")]);
    renderSwitcher("alpha");
    await userEvent.click(await screen.findByRole("combobox", { name: "Compte" }));
    const beta = await screen.findByRole("option", { name: /beta/ });
    expect(within(beta).getByLabelText(/1/)).toBeInTheDocument();
  });

  it("shows nothing when nothing is triggered", async () => {
    renderSwitcher("alpha");
    const trigger = await screen.findByRole("combobox", { name: "Compte" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(trigger).queryByLabelText(/alerte/i)).toBeNull();
  });
});
```

Adapter les noms à l'aide de rendu, aux comptes déjà semés et au libellé `alerts.badge` du fichier ; le `getByLabelText` vise l'`aria-label` d'`AlertBadge`.

- [ ] **Step 2: Run test to verify it fails**

Run : `npx vitest run src/components/AccountSwitcher.test.tsx`
Expected: FAIL — aucune pastille.

- [ ] **Step 3: Write minimal implementation**

`hooks.ts` :

```ts
/**
 * Triggered and unseen alerts by account, every account at once (sub-project 43, §6.1): the
 * status reads on the stored state alone, and the watcher purges the states of vanished alerts
 * at every pass. `undefined` while loading.
 */
export function useTriggeredAlertCounts(): ReadonlyMap<string, number> | undefined {
  const db = useDb();
  const states = useLiveQuery(() => db.alertStates.filter((s) => s.triggeredAt !== null && s.acknowledgedAt === null).toArray(), [db]);
  return useMemo(() => {
    if (states === undefined) return undefined;
    const counts = new Map<string, number>();
    for (const s of states) counts.set(s.accountId, (counts.get(s.accountId) ?? 0) + 1);
    return counts;
  }, [states]);
}
```

`AccountSwitcher.tsx` :

```tsx
  const counts = useTriggeredAlertCounts();
  const others = accounts.reduce((sum, a) => sum + (a.id === accountId ? 0 : (counts?.get(a.id) ?? 0)), 0);
  // …
      <SelectTrigger className="w-full font-medium" aria-label={t("accountSwitcher.label")}>
        {/* The value alone: the item's badge must not follow it into the button. */}
        <SelectValue>{(value: string) => value}</SelectValue>
        <AlertBadge count={others} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            <span className="flex w-full items-center justify-between gap-2">
              {account.id}
              <AlertBadge count={counts?.get(account.id) ?? 0} />
            </span>
          </SelectItem>
        ))}
```

Si le `SelectItem` de `@ib/ui` enveloppe ses enfants dans un `ItemText` qui ne prend pas toute la largeur, poser la classe sur ce qui la prend, sans toucher à `packages/ui`.

- [ ] **Step 4: Run test to verify it passes**

Run : `npx vitest run src/components/AccountSwitcher.test.tsx src/components/app-sidebar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/hooks.ts apps/web/src/components/AccountSwitcher.tsx apps/web/src/components/AccountSwitcher.test.tsx docs/plans/2026-10-02-alertes-tous-comptes.md
git commit -m "Alertes : le sélecteur de compte signale les alertes des autres comptes"
```

---

### Task 8: Aide, CLAUDE.md, vérification complète

**Files:**
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json` (texte d'aide des alertes, la clé dont la valeur fr commence par « Une alerte se vérifie à chaque passe de l'agent »), `CLAUDE.md`, `docs/specs/2026-10-02-alertes-tous-comptes-design.md` (statut)

- [ ] **Step 1: Aide**

fr : « Une alerte se vérifie à chaque passe de l'agent (toutes les 5 minutes), pour tous vos comptes qui ont un port TWS, quelle que soit la page ouverte et même onglet en arrière-plan. Sans agent ou sans onglet ouvert, rien n'est évalué, et aucun rattrapage n'a lieu entre deux passes. Le cours d'un titre que vous ne détenez pas est différé d'environ 15 minutes. »

en : la même chose en anglais, sur la valeur en actuelle de la même clé (garder son ton et sa dernière phrase).

- [ ] **Step 2: CLAUDE.md**

- Règle des alertes : remplacer « **L'évaluation n'a lieu que sur une page de compte ouverte, agent présent** : sans agent (`useAgentPresence`), la passe purge toujours mais ne déclenche ni ne réarme rien — le snapshot `agent` stocké et les cotations peuvent dater de la veille. » par : « **Le veilleur évalue tous les comptes** (sous-projet 43) : `startAlertWatcher` (`src/alerts/watcher.ts`), démarré par `main.tsx`, tient le verrou Web Locks `ib2:watcher:<base>` — un seul onglet passe, un autre reprend à sa fermeture — et toutes les `AGENT_POLL_MS`, onglet masqué compris, fait pour chaque compte qui a un port `runAgentSync` puis `evaluateAccountAlerts` (`alerts/evaluateAccount.ts`, sans React : journaux par `loadAccountJournals`, `runPass`, `anchorPending`). Chaque onglet sonde l'agent, élu ou non. Une synchro en échec purge mais ne déclenche ni ne réarme rien. `useAlertEngine` reste monté pour le compte affiché, pour l'affichage et la réaction immédiate ; la double évaluation est sans effet, la passe relisant les états dans sa transaction. Le sélecteur de compte porte les alertes déclenchées des autres comptes (`useTriggeredAlertCounts`) ; à partir de deux comptes, la notification nomme le compte. `useAgentPolling` n'existe plus. »
- Règle de `exclusiveTws` (« **Une connexion TWS à la fois** ») : ajouter « entre onglets aussi, par le verrou Web Locks `ib2:tws` (`TWS_LOCK`), la file en mémoire seulement sans `navigator.locks` ».
- Registre : `| 43 | Les alertes de tous les comptes | fait (2026-10-02) |`.

- [ ] **Step 3: Statut de la spec** : « Statut : implémenté (2026-10-02). »

- [ ] **Step 4: Vérification complète**

Run (racine) : `pnpm check`
Expected: lint, typage, build et tous les tests verts. Corriger tout écart, relancer **une** fois.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md apps/web/src/i18n docs
git commit -m "Sous-projet 43 : Aide, CLAUDE.md et registre"
```

- [ ] **Step 6: Instance de relecture**

Dans le worktree : `pnpm dev:start`, puis donner les deux URL à Seb (CLAUDE.md, Workflow). Rappeler qu'un worktree servi sur un autre port que 5173 doit être autorisé par l'agent : `ib-tws-agent origin add http://127.0.0.1:<port>`, puis relancer l'agent.
