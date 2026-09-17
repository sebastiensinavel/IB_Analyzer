# Sous-projet 11 — La page Consistance et ses indicateurs permanents : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réunir couverture, reconstitution et cohérence du cash dans une page Consistance, et afficher en permanence dans la barre de titre deux verdicts, Couverture et Reconstitution, liés à cette page.

**Architecture:** Quatre couches, de bas en haut. (1) *Calcul partagé* : `AccountDataProvider`, monté par `AppLayout` pour le compte affiché, appelle une fois `useJournals` et `useRiskReport` ; toutes les pages les lisent par `useAccountJournals` / `useAccountRiskReport`. (2) *Verdicts* : `lib/consistency.ts`, fonctions pures qui lisent ce que ces deux vues rendent déjà. (3) *Barre de titre* : `ConsistencyIndicators`, un lien vers la page, deux icônes colorées. (4) *Pages* : `ConsistencyPage` empile `UncoveredCard` (extraite du Dashboard), `ReconciliationCard` et `CashCheckCard`, qui quittent ensuite Dashboard, Journaux et Historique.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, lucide-react, Tailwind 4. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-11-consistance-design.md` (lire aussi `CLAUDE.md`, et `docs/specs/2026-09-07-journaux-design.md` §4 et §7.2 pour la carte de reconstitution existante).

## Global Constraints

- **Aucun changement dans `packages/`** : ni `ledger`, ni `coverage`, ni `ib-parsers`. Les verdicts se lisent dans ce que `buildRiskReport` et `buildJournals` rendent déjà. Rien dans `apps/api`.
- **Le serveur ne voit jamais** transactions, positions ni cash. Une tâche qui semble réclamer un endpoint, un modèle ou une table est un signal d'arrêt.
- **Journaux et rapport de risque calculés une fois, dans la coquille** : aucune page ni composant n'appelle `useJournals` ni `useRiskReport` directement, hors `AccountDataProvider` lui-même. Les hooks consommateurs **lèvent une erreur** hors du fournisseur, jamais de repli silencieux (spec §4).
- **Indicateurs seulement quand un compte est affiché** (`scoped` non nul dans `AppLayout`) : jamais sur Paramètres, Aide ni la page de compte inconnu (spec §3).
- **Seule Couverture en `alert` clignote**, par `motion-safe:animate-pulse` sur l'icône ; Reconstitution en `alert` reste fixe ; `ok` et `unknown` ne clignotent jamais (spec §3).
- **Couleurs par jetons** : `text-success` (`ok`), `text-destructive` (`alert`), `text-muted-foreground` (`unknown`). Aucune couleur en dur.
- **Sans snapshot, les deux verdicts sont `unknown`**, gris ; **Reconstitution `alert` = au moins un écart ou une orpheline** (spec §2).
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — » : sans snapshot, la carte des non couvertes n'affiche pas de badge « 0 ».
- **Toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`, mêmes clés dans les deux.**
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild`.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, **jamais en moquant les hooks**.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
  ```
- Le travail se fait dans un worktree `.claude/worktrees/consistance` (skill `superpowers:using-git-worktrees`), branche `consistance`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
apps/web/src/
  db/AccountDataProvider.tsx (+ test)    NOUVEAU  AccountDataProvider, useAccountJournals,
                                                  useAccountRiskReport
  test/WithAccountData.tsx               NOUVEAU  utilitaire de test : le fournisseur sur :accountId
  lib/consistency.ts (+ test)            NOUVEAU  ConsistencyStatus, coverageVerdict,
                                                  reconstitutionVerdict
  lib/currencies.ts                      NOUVEAU  BALANCE_CURRENCIES (quitte HistoryPage)
  lib/format.ts (+ test)                          formatSnapshotDate
  lib/navigation.ts                               entrée Consistance sous Sources de données
  components/ConsistencyIndicators.tsx   NOUVEAU  les deux verdicts de la barre de titre
  components/UncoveredCard.tsx (+ test)  NOUVEAU  extraite du Dashboard, état sans snapshot
  components/ReconciliationCard.tsx (+ test)      titre, formatSnapshotDate
  components/CashCheckCard.tsx (+ test)           titre
  pages/ConsistencyPage.tsx (+ test)     NOUVEAU  les trois cartes
  pages/DashboardPage.tsx (+ test)                contexte ; perd la carte des non couvertes
  pages/JournalPage.tsx (+ test)                  contexte ; perd ReconciliationCard
  pages/HistoryPage.tsx (+ test)                  perd CashCheckCard
  pages/StatsPage.tsx (+ test)                    contexte
  pages/SourcesPage.tsx (+ test)                  contexte
  pages/PositionsPage.tsx (+ test)                contexte
  routes/AppLayout.tsx (+ test)                   fournisseur, indicateurs
  routes/router.tsx (+ test)                      route consistency
  i18n/fr.json, i18n/en.json                      nav.consistency, consistency.*, balanceHint,
                                                  dashboard.uncoveredCard supprimé

CLAUDE.md, docs/specs/2026-09-03-architecture-design.md §9, docs/specs/2026-09-11-consistance-design.md
```

## Commandes

Depuis la racine du worktree.

```bash
pnpm install                                                   # une fois, à la création du worktree
pnpm --filter web test src/lib/consistency.test.ts             # un fichier de l'app (garde TZ=Asia/Kolkata)
pnpm --filter web test                                         # toute l'app
pnpm --filter web typecheck                                    # tsc -b, silencieux si OK
pnpm lint                                                      # oxlint
pnpm check                                                     # lint + typecheck + build + tous les Vitest
```

Toujours passer par le script `test` de `web` (jamais `exec vitest`) : il fixe `TZ=Asia/Kolkata`. `pnpm check` ne lance ni Python, ni Django, ni Playwright.

---

## Tâche 1 : journaux et rapport de risque calculés une fois, dans la coquille

**Files:**
- Create: `apps/web/src/db/AccountDataProvider.tsx`, `apps/web/src/db/AccountDataProvider.test.tsx`, `apps/web/src/test/WithAccountData.tsx`
- Modify: `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/pages/JournalPage.tsx`, `apps/web/src/pages/StatsPage.tsx`, `apps/web/src/pages/SourcesPage.tsx` (`ContractIdentityCard`, ~l. 477-481), `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/PositionsPage.tsx`
- Test: `apps/web/src/routes/AppLayout.test.tsx`, `apps/web/src/pages/{JournalPage,StatsPage,SourcesPage,DashboardPage,PositionsPage}.test.tsx`

**Interfaces:**
- Consomme : `useJournals(accountId: string): JournalsView` et `useRiskReport(accountId: string): RiskReportView` de `@/db/hooks` (inchangés).
- Produit :
  - `AccountDataProvider({ accountId: string; children: ReactNode })`
  - `useAccountJournals(): JournalsView` — lève `Error("useAccountJournals must be used inside <AccountDataProvider>")` hors fournisseur
  - `useAccountRiskReport(): RiskReportView` — lève `Error("useAccountRiskReport must be used inside <AccountDataProvider>")` hors fournisseur
  - `WithAccountData({ children: ReactNode })` (tests seulement) : monte le fournisseur sur le `:accountId` de la route

- [x] **Step 1 : créer le worktree**

Invoquer la skill `superpowers:using-git-worktrees` pour créer `.claude/worktrees/consistance` sur une branche `consistance` partant de `main`, puis :

```bash
cd .claude/worktrees/consistance
pnpm install
pnpm --filter web test
```

Attendu : tout vert. C'est la ligne de base ; toutes les commandes suivantes partent de ce répertoire. Si un test échoue **déjà** ici, s'arrêter et le signaler avec sa sortie, sans rien « corriger » en passant.

- [x] **Step 2 : écrire le test du fournisseur**

Créer `apps/web/src/db/AccountDataProvider.test.tsx` :

```tsx
import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { uncovered } from "@ib/coverage";
import { db } from "@/db/schema";
import { AccountDataProvider, useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

/** Renders the message of the error its child threw, instead of the child. */
class Catch extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ?? this.props.children;
  }
}

function JournalsOnly() {
  useAccountJournals();
  return null;
}

function RiskOnly() {
  useAccountRiskReport();
  return null;
}

function Probe() {
  const journals = useAccountJournals();
  const { report } = useAccountRiskReport();
  if (journals.status === "loading" || report === undefined) return <p>loading</p>;
  const asOf = journals.report.reconciliation.asOf ?? "no snapshot";
  const naked = report === null ? "no report" : `${uncovered(report).length} uncovered`;
  return <p>{`${asOf} / ${journals.report.rows.length} rows / ${naked}`}</p>;
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.contracts.clear()]);
});

describe("AccountDataProvider", () => {
  it("refuses to be read outside the provider, rather than replaying the ledger a second time", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <Catch>
          <JournalsOnly />
        </Catch>
        <Catch>
          <RiskOnly />
        </Catch>
      </>,
    );
    expect(screen.getByText("useAccountJournals must be used inside <AccountDataProvider>")).toBeInTheDocument();
    expect(screen.getByText("useAccountRiskReport must be used inside <AccountDataProvider>")).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("serves its own account's journals and risk report, and follows the base", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    // alpha's snapshot: beta's provider must not see it.
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    render(
      <AccountDataProvider accountId="beta">
        <Probe />
      </AccountDataProvider>,
    );
    expect(await screen.findByText(/^no snapshot \/ [1-9]\d* rows \/ no report$/)).toBeInTheDocument();
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    expect(await screen.findByText(/^2026-09-02 \/ [1-9]\d* rows \/ 0 uncovered$/)).toBeInTheDocument();
  });
});
```

- [x] **Step 3 : vérifier qu'il échoue**

Run: `pnpm --filter web test src/db/AccountDataProvider.test.tsx`
Expected: FAIL, `Failed to resolve import "@/db/AccountDataProvider"`.

- [x] **Step 4 : écrire le fournisseur**

Créer `apps/web/src/db/AccountDataProvider.tsx` :

```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useJournals, useRiskReport, type JournalsView, type RiskReportView } from "./hooks";

interface AccountData {
  journals: JournalsView;
  risk: RiskReportView;
}

const AccountDataContext = createContext<AccountData | null>(null);

/**
 * The journals and the risk report of the account on screen, computed once for the whole shell
 * (spec of sub-project 11, §4): the title bar's verdicts and every page read them here, so a
 * change of the ledger replays it once, whatever the page.
 */
export function AccountDataProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const journals = useJournals(accountId);
  const { snapshot, report, sectorOf } = useRiskReport(accountId);
  const value = useMemo(
    () => ({ journals, risk: { snapshot, report, sectorOf } }),
    [journals, snapshot, report, sectorOf],
  );
  return <AccountDataContext.Provider value={value}>{children}</AccountDataContext.Provider>;
}

function useAccountData(hook: string): AccountData {
  const data = useContext(AccountDataContext);
  // Never a silent fallback on useJournals: it would replay the ledger a second time, unseen.
  if (data === null) throw new Error(`${hook} must be used inside <AccountDataProvider>`);
  return data;
}

export function useAccountJournals(): JournalsView {
  return useAccountData("useAccountJournals").journals;
}

export function useAccountRiskReport(): RiskReportView {
  return useAccountData("useAccountRiskReport").risk;
}
```

- [x] **Step 5 : vérifier qu'il passe**

Run: `pnpm --filter web test src/db/AccountDataProvider.test.tsx`
Expected: PASS, 2 tests.

- [x] **Step 6 : écrire le test de la coquille**

Dans `apps/web/src/routes/AppLayout.test.tsx` :

1. Ajouter l'import `import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";` après l'import de `db`.
2. Ajouter, avant `function renderAt` :

```tsx
function AccountDataProbe() {
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  return <div>{report === undefined || journals.status === "loading" ? "account data loading" : "account data ready"}</div>;
}
```

3. Dans `renderAt`, sous `<Route path="dashboard" element={<div>dashboard content</div>} />`, ajouter `<Route path="positions" element={<AccountDataProbe />} />`.
4. Remplacer la ligne `await Promise.all([db.accounts.clear(), db.transactions.clear(), db.imports.clear()]);` par :

```tsx
  await Promise.all([
    db.accounts.clear(),
    db.transactions.clear(),
    db.imports.clear(),
    db.snapshots.clear(),
    db.contracts.clear(),
    db.cashPoints.clear(),
  ]);
```

5. Ajouter dans `describe("AppLayout")`, après le premier test :

```tsx
  it("gives the account's pages its journals and risk report", async () => {
    renderAt("/accounts/alpha/positions");
    expect(await screen.findByText("account data ready")).toBeInTheDocument();
  });
```

Run: `pnpm --filter web test src/routes/AppLayout.test.tsx`
Expected: FAIL, le nouveau test ; l'erreur `useAccountRiskReport must be used inside <AccountDataProvider>`.

- [x] **Step 7 : monter le fournisseur dans `AppLayout`**

Dans `apps/web/src/routes/AppLayout.tsx`, ajouter l'import `import { AccountDataProvider } from "@/db/AccountDataProvider";` après celui d'`AppSidebar`, puis remplacer tout le `return (...)` final par :

```tsx
  const inset = (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        {scoped ? (
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{scoped}</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{pageLabelKey ? t(pageLabelKey) : null}</span>
        )}
      </header>
      {accountId !== undefined && scoped === null ? <UnknownAccountPage id={accountId} /> : <Outlet />}
    </>
  );

  return (
    <SidebarProvider>
      <AppSidebar accountId={navAccountId} accounts={accounts} />
      <SidebarInset>
        {/* The account on screen computes its journals and risk report once, for the title bar
            and every page (sub-project 11, §4). Account-less pages never read them. */}
        {scoped ? <AccountDataProvider accountId={scoped}>{inset}</AccountDataProvider> : inset}
      </SidebarInset>
    </SidebarProvider>
  );
```

Run: `pnpm --filter web test src/routes/AppLayout.test.tsx`
Expected: PASS.

- [x] **Step 8 : les pages lisent le contexte**

1. `apps/web/src/pages/JournalPage.tsx` : remplacer `import { useJournals } from "@/db/hooks";` par `import { useAccountJournals } from "@/db/AccountDataProvider";`, et `const view = useJournals(accountId);` par `const view = useAccountJournals();`. `accountId` reste utilisé par `ReconciliationCard` jusqu'à la tâche 5.
2. `apps/web/src/pages/StatsPage.tsx` : supprimer la ligne `import { useParams } from "react-router";` et la ligne `const { accountId = "" } = useParams<{ accountId: string }>();` ; remplacer `import { useJournals } from "@/db/hooks";` par `import { useAccountJournals } from "@/db/AccountDataProvider";` et `const view = useJournals(accountId);` par `const view = useAccountJournals();`.
3. `apps/web/src/pages/SourcesPage.tsx` : retirer `useJournals` de l'import `@/db/hooks` (qui devient `import { useAccount, useContractIdentities, useImports, useSectors, useStatements } from "@/db/hooks";`), ajouter `import { useAccountJournals } from "@/db/AccountDataProvider";` juste avant, et dans `ContractIdentityCard` remplacer `const journals = useJournals(accountId);` par `const journals = useAccountJournals();`.
4. `apps/web/src/pages/DashboardPage.tsx` : remplacer `import { useRiskReport } from "@/db/hooks";` par `import { useAccountRiskReport } from "@/db/AccountDataProvider";` et `const { report } = useRiskReport(accountId);` par `const { report } = useAccountRiskReport();`.
5. `apps/web/src/pages/PositionsPage.tsx` : remplacer `import { useRiskReport } from "@/db/hooks";` par `import { useAccountRiskReport } from "@/db/AccountDataProvider";` et `const { snapshot, report, sectorOf } = useRiskReport(accountId);` par `const { snapshot, report, sectorOf } = useAccountRiskReport();`.

Vérifier qu'aucun appel direct ne reste :

Run: `grep -rn "useJournals\|useRiskReport" apps/web/src --include=*.tsx --include=*.ts | grep -v "\.test\.\|db/hooks.ts\|db/AccountDataProvider.tsx"`
Expected: aucune ligne.

Run: `pnpm --filter web test src/pages`
Expected: FAIL sur JournalPage, StatsPage, SourcesPage, DashboardPage, PositionsPage, avec `must be used inside <AccountDataProvider>`.

- [x] **Step 9 : les tests de pages montent le fournisseur**

Créer `apps/web/src/test/WithAccountData.tsx` :

```tsx
import type { ReactNode } from "react";
import { useParams } from "react-router";
import { AccountDataProvider } from "@/db/AccountDataProvider";

/** Test-only: the account data of the route's `:accountId`, as AppLayout mounts it for the account on screen. */
export function WithAccountData({ children }: { children: ReactNode }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  return <AccountDataProvider accountId={accountId}>{children}</AccountDataProvider>;
}
```

Dans chacun des cinq fichiers de test, ajouter `import { WithAccountData } from "@/test/WithAccountData";` après l'import de la page, puis envelopper l'élément de la route :

| Fichier | Remplacer | Par |
|---|---|---|
| `JournalPage.test.tsx` | `element={<JournalPage strategy={strategy} />}` | `element={<WithAccountData><JournalPage strategy={strategy} /></WithAccountData>}` |
| `StatsPage.test.tsx` | `element={<StatsPage strategy={strategy} />}` | `element={<WithAccountData><StatsPage strategy={strategy} /></WithAccountData>}` |
| `SourcesPage.test.tsx` (4 occurrences) | `element={<SourcesPage />}` | `element={<WithAccountData><SourcesPage /></WithAccountData>}` |
| `DashboardPage.test.tsx` | `element={<DashboardPage />}` | `element={<WithAccountData><DashboardPage /></WithAccountData>}` |
| `PositionsPage.test.tsx` | `element={<PositionsPage />}` | `element={<WithAccountData><PositionsPage /></WithAccountData>}` |

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: tout vert.

- [x] **Step 10 : commit**

Cocher les cases de la tâche 1 dans ce plan, puis :

```bash
git add apps/web/src docs/plans/2026-09-11-consistance.md
git commit -F - <<'EOF'
refactor(web): journaux et rapport de risque calculés une fois, dans la coquille

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```

---

## Tâche 2 : les verdicts de couverture et de reconstitution

**Files:**
- Create: `apps/web/src/lib/consistency.ts`, `apps/web/src/lib/consistency.test.ts`
- Modify: `apps/web/src/lib/format.ts` (après `formatDateTime`), `apps/web/src/components/ReconciliationCard.tsx`
- Test: `apps/web/src/lib/format.test.ts`

**Interfaces:**
- Consomme : `JournalsView` (`@/db/hooks`), `RiskReport` et `uncovered` (`@ib/coverage`).
- Produit :
  - `type ConsistencyStatus = "ok" | "alert" | "unknown"`
  - `interface CoverageVerdict { status: ConsistencyStatus; loading: boolean; uncovered: number }`
  - `interface ReconstitutionVerdict { status: ConsistencyStatus; loading: boolean; gaps: number; asOf: string | null }`
  - `coverageVerdict(report: RiskReport | null | undefined): CoverageVerdict`
  - `reconstitutionVerdict(journals: JournalsView): ReconstitutionVerdict`
  - `formatSnapshotDate(asOf: string): string` dans `@/lib/format`

- [x] **Step 1 : écrire les tests des verdicts**

Créer `apps/web/src/lib/consistency.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { buildRiskReport } from "@ib/coverage";
import type { Reconciliation } from "@ib/ledger";
import type { JournalsView } from "@/db/hooks";
import { coverageVerdict, reconstitutionVerdict } from "@/lib/consistency";
import { SAMPLE_POSITIONS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function ready(reconciliation: Reconciliation): JournalsView {
  return { status: "ready", report: { rows: [], reconciliation, stats: { wheel: [], leaps: [], condors: [] } }, identityIssues: [] };
}

const PUT = { ticker: "MQZA", secType: "OPT", right: "P" as const, strike: 17, expiry: "2026-10-02", currency: "USD" };
const DIFFERENCE = { contract: PUT, label: "MQZA Oct02'26 17 Put", ledgerQty: -3, snapshotQty: -2 };
const ORPHAN = { id: "o" } as Reconciliation["orphans"][number];

describe("coverageVerdict", () => {
  it("is unknown and loading while the snapshot has not been read", () => {
    expect(coverageVerdict(undefined)).toEqual({ status: "unknown", loading: true, uncovered: 0 });
  });

  it("is unknown, not loading, without a snapshot", () => {
    expect(coverageVerdict(null)).toEqual({ status: "unknown", loading: false, uncovered: 0 });
  });

  it("alerts on an uncovered position, and counts them", () => {
    expect(coverageVerdict(buildRiskReport(SAMPLE_SNAPSHOT.positions, SAMPLE_SNAPSHOT.cashAvailable))).toEqual({
      status: "alert",
      loading: false,
      uncovered: 1,
    });
  });

  it("is ok when nothing is uncovered", () => {
    expect(coverageVerdict(buildRiskReport([SAMPLE_POSITIONS[5]], 42000))).toEqual({ status: "ok", loading: false, uncovered: 0 });
  });
});

describe("reconstitutionVerdict", () => {
  it("is unknown and loading while the journals are computed", () => {
    expect(reconstitutionVerdict({ status: "loading" })).toEqual({ status: "unknown", loading: true, gaps: 0, asOf: null });
  });

  it("is unknown without a snapshot, whatever orphans the replay found", () => {
    expect(reconstitutionVerdict(ready({ asOf: null, differences: [], orphans: [ORPHAN] }))).toEqual({
      status: "unknown",
      loading: false,
      gaps: 0,
      asOf: null,
    });
  });

  it("is ok when the replay matches the snapshot exactly", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-02", differences: [], orphans: [] }))).toEqual({
      status: "ok",
      loading: false,
      gaps: 0,
      asOf: "2026-09-02",
    });
  });

  it("alerts on a difference", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-02", differences: [DIFFERENCE], orphans: [] }))).toMatchObject({ status: "alert", gaps: 1 });
  });

  it("alerts on an orphan alone, as the card leaves its matching state for one", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-02", differences: [], orphans: [ORPHAN] }))).toMatchObject({ status: "alert", gaps: 1 });
  });

  it("counts differences and orphans together", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-06T13:02:00.000Z", differences: [DIFFERENCE], orphans: [ORPHAN] }))).toEqual({
      status: "alert",
      loading: false,
      gaps: 2,
      asOf: "2026-09-06T13:02:00.000Z",
    });
  });
});
```

Dans `apps/web/src/lib/format.test.ts`, ajouter `formatSnapshotDate` à la liste d'import de `@/lib/format`, et à la fin du fichier :

```ts
describe("formatSnapshotDate", () => {
  it("keeps a file's day as is", () => {
    expect(formatSnapshotDate("2026-09-02")).toBe("2026-09-02");
  });

  it("dates an agent's instant to the second", () => {
    expect(formatSnapshotDate("2026-09-06T13:02:00.000Z")).toBe("2026-09-06 13:02:00");
  });
});
```

- [x] **Step 2 : vérifier qu'ils échouent**

Run: `pnpm --filter web test src/lib/consistency.test.ts src/lib/format.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/consistency"` et `formatSnapshotDate is not a function` (ou erreur d'export).

- [x] **Step 3 : écrire les verdicts et `formatSnapshotDate`**

Créer `apps/web/src/lib/consistency.ts` :

```ts
import { uncovered, type RiskReport } from "@ib/coverage";
import type { JournalsView } from "@/db/hooks";

/** Spec of sub-project 11, §2: green, red, or grey for want of anything to check. */
export type ConsistencyStatus = "ok" | "alert" | "unknown";

export interface CoverageVerdict {
  status: ConsistencyStatus;
  /** `true` while the snapshot has not been read yet; the status is then `unknown`. */
  loading: boolean;
  /** Uncovered positions; 0 unless the status is `alert`. */
  uncovered: number;
}

export interface ReconstitutionVerdict {
  status: ConsistencyStatus;
  /** `true` while the journals are being computed; the status is then `unknown`. */
  loading: boolean;
  /** Differences plus orphan lines; 0 unless the status is `alert`. */
  gaps: number;
  /** The snapshot the replay was checked against; `null` without one or while loading. */
  asOf: string | null;
}

/** `report` as `RiskReportView.report` has it: `undefined` while loading, `null` without a snapshot. */
export function coverageVerdict(report: RiskReport | null | undefined): CoverageVerdict {
  if (report === undefined) return { status: "unknown", loading: true, uncovered: 0 };
  if (report === null) return { status: "unknown", loading: false, uncovered: 0 };
  const count = uncovered(report).length;
  return { status: count === 0 ? "ok" : "alert", loading: false, uncovered: count };
}

/** An orphan alone is a gap: `ReconciliationCard` leaves its matching state for one. */
export function reconstitutionVerdict(journals: JournalsView): ReconstitutionVerdict {
  if (journals.status === "loading") return { status: "unknown", loading: true, gaps: 0, asOf: null };
  const { asOf, differences, orphans } = journals.report.reconciliation;
  if (asOf === null) return { status: "unknown", loading: false, gaps: 0, asOf: null };
  const gaps = differences.length + orphans.length;
  return { status: gaps === 0 ? "ok" : "alert", loading: false, gaps, asOf };
}
```

Dans `apps/web/src/lib/format.ts`, juste après la fonction `formatDateTime`, ajouter :

```ts
/** A snapshot's `asOf`: a file's day as is, an agent's instant to the second. */
export function formatSnapshotDate(asOf: string): string {
  return asOf.length === 10 ? asOf : formatDateTime(asOf);
}
```

Dans `apps/web/src/components/ReconciliationCard.tsx`, remplacer `import { formatDateTime } from "@/lib/format";` par `import { formatSnapshotDate } from "@/lib/format";` et `const date = asOf.length === 10 ? asOf : formatDateTime(asOf);` par `const date = formatSnapshotDate(asOf);`.

- [x] **Step 4 : vérifier qu'ils passent**

Run: `pnpm --filter web test src/lib src/components/ReconciliationCard.test.tsx && pnpm --filter web typecheck`
Expected: PASS ; « dates an agent snapshot by its instant » de `ReconciliationCard` reste vert.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 2, puis :

```bash
git add apps/web/src docs/plans/2026-09-11-consistance.md
git commit -F - <<'EOF'
feat(web): verdicts de couverture et de reconstitution

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```

---

## Tâche 3 : la barre de titre porte Couverture et Reconstitution

**Files:**
- Create: `apps/web/src/components/ConsistencyIndicators.tsx`
- Modify: `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/routes/AppLayout.test.tsx`

**Interfaces:**
- Consomme : `useAccountJournals`, `useAccountRiskReport` (tâche 1) ; `coverageVerdict`, `reconstitutionVerdict`, `ConsistencyStatus`, `formatSnapshotDate` (tâche 2).
- Produit :
  - `ConsistencyIndicators({ accountId: string })` : un `<Link>` vers `/accounts/:accountId/consistency`, `aria-label` = `title` = les deux phrases jointes par `". "` ; deux `<span data-testid="coverage-indicator" | "reconstitution-indicator" data-status={status}>`, chacun un libellé et une icône `ShieldCheck` (`svg`).
  - Clés i18n `consistency.indicators.coverage.{label,ok,alert_one,alert_other,unknown,loading}` et `consistency.indicators.reconstitution.{label,ok,alert_one,alert_other,unknown,loading}`.

- [x] **Step 1 : écrire les tests des indicateurs**

Dans `apps/web/src/routes/AppLayout.test.tsx` :

1. Ajouter les imports :

```tsx
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";
```

2. Remplacer `navHrefs` par :

```tsx
function navHrefs() {
  // The title bar's link to the Consistency page is not a nav entry.
  return screen
    .getAllByRole("link")
    .filter((el) => !el.closest("header"))
    .map((el) => el.getAttribute("href"));
}

function indicatorIcon(testId: string): SVGElement {
  return screen.getByTestId(testId).querySelector("svg") as SVGElement;
}
```

3. Ajouter à la fin du fichier :

```tsx
describe("AppLayout: consistency indicators", () => {
  it("says both verdicts in one link to the Consistency page, only the uncovered one blinking", async () => {
    // alpha: one naked call, and no ledger to rebuild the snapshot from.
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderAt("/accounts/alpha/dashboard");
    const summary = "Couverture : 1 position non couverte. Reconstitution : 10 écarts avec le snapshot du 2026-09-02";
    const link = await screen.findByRole("link", { name: summary });
    expect(link).toHaveAttribute("href", "/accounts/alpha/consistency");
    expect(link).toHaveAttribute("title", summary);
    expect(link).toHaveTextContent("Couverture");
    expect(link).toHaveTextContent("Reconstitution");
    expect(screen.getByTestId("coverage-indicator")).toHaveAttribute("data-status", "alert");
    expect(indicatorIcon("coverage-indicator")).toHaveClass("text-destructive", "motion-safe:animate-pulse");
    expect(screen.getByTestId("reconstitution-indicator")).toHaveAttribute("data-status", "alert");
    expect(indicatorIcon("reconstitution-indicator")).toHaveClass("text-destructive");
    expect(indicatorIcon("reconstitution-indicator")).not.toHaveClass("motion-safe:animate-pulse");
  });

  it("turns both green on a covered portfolio the ledger rebuilds exactly, blinking nothing", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderAt("/accounts/beta/dashboard");
    expect(
      await screen.findByRole("link", { name: "Couverture : aucune position non couverte. Reconstitution : conforme au snapshot du 2026-09-02" }),
    ).toBeInTheDocument();
    for (const id of ["coverage-indicator", "reconstitution-indicator"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-status", "ok");
      expect(indicatorIcon(id)).toHaveClass("text-success");
      expect(indicatorIcon(id)).not.toHaveClass("motion-safe:animate-pulse");
    }
  });

  it("greys both, without blinking, when there is no snapshot", async () => {
    renderAt("/accounts/beta/dashboard");
    expect(
      await screen.findByRole("link", { name: "Couverture : aucun snapshot de positions. Reconstitution : aucun snapshot de positions" }),
    ).toBeInTheDocument();
    for (const id of ["coverage-indicator", "reconstitution-indicator"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-status", "unknown");
      expect(indicatorIcon(id)).toHaveClass("text-muted-foreground");
      expect(indicatorIcon(id)).not.toHaveClass("motion-safe:animate-pulse");
    }
  });

  it("follows the base: a snapshot imported later turns the verdicts", async () => {
    renderAt("/accounts/beta/dashboard");
    await screen.findByRole("link", { name: /^Couverture : aucun snapshot de positions/ });
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    expect(await screen.findByRole("link", { name: /^Couverture : aucune position non couverte\. Reconstitution : conforme/ })).toBeInTheDocument();
  });

  it("shows no indicator outside an account", async () => {
    window.localStorage.setItem("ib2:lastAccountId", "beta");
    renderAt("/settings");
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reconstitution-indicator")).not.toBeInTheDocument();
  });

  it("shows no indicator on an unknown account", async () => {
    renderAt("/accounts/nope/dashboard");
    expect(await screen.findByText("Compte inconnu")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-indicator")).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2 : vérifier qu'ils échouent**

Run: `pnpm --filter web test src/routes/AppLayout.test.tsx`
Expected: FAIL sur les quatre premiers tests du nouveau `describe` (lien introuvable) ; les deux derniers et les tests existants passent.

- [x] **Step 3 : les phrases**

Dans `apps/web/src/i18n/fr.json`, insérer juste avant la ligne `  "reconciliation": {` :

```json
  "consistency": {
    "indicators": {
      "coverage": {
        "label": "Couverture",
        "ok": "Couverture : aucune position non couverte",
        "alert_one": "Couverture : {{count}} position non couverte",
        "alert_other": "Couverture : {{count}} positions non couvertes",
        "unknown": "Couverture : aucun snapshot de positions",
        "loading": "Couverture : chargement…"
      },
      "reconstitution": {
        "label": "Reconstitution",
        "ok": "Reconstitution : conforme au snapshot du {{date}}",
        "alert_one": "Reconstitution : {{count}} écart avec le snapshot du {{date}}",
        "alert_other": "Reconstitution : {{count}} écarts avec le snapshot du {{date}}",
        "unknown": "Reconstitution : aucun snapshot de positions",
        "loading": "Reconstitution : chargement…"
      }
    }
  },
```

Dans `apps/web/src/i18n/en.json`, au même endroit :

```json
  "consistency": {
    "indicators": {
      "coverage": {
        "label": "Coverage",
        "ok": "Coverage: no uncovered position",
        "alert_one": "Coverage: {{count}} uncovered position",
        "alert_other": "Coverage: {{count}} uncovered positions",
        "unknown": "Coverage: no positions snapshot",
        "loading": "Coverage: loading…"
      },
      "reconstitution": {
        "label": "Reconstitution",
        "ok": "Reconstitution: matches the snapshot of {{date}}",
        "alert_one": "Reconstitution: {{count}} difference with the snapshot of {{date}}",
        "alert_other": "Reconstitution: {{count}} differences with the snapshot of {{date}}",
        "unknown": "Reconstitution: no positions snapshot",
        "loading": "Reconstitution: loading…"
      }
    }
  },
```

- [x] **Step 4 : le composant**

Créer `apps/web/src/components/ConsistencyIndicators.tsx` :

```tsx
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { coverageVerdict, reconstitutionVerdict, type ConsistencyStatus } from "@/lib/consistency";
import { formatSnapshotDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON_TONE: Record<ConsistencyStatus, string> = {
  ok: "text-success",
  alert: "text-destructive",
  unknown: "text-muted-foreground",
};

/**
 * The title bar's two verdicts (spec of sub-project 11, §3), in view on every page of an account,
 * as one link to the Consistency page. Only an uncovered position blinks: a reconstitution gap
 * stays red and still, and nothing moves for a user who asked the system to reduce motion.
 */
export function ConsistencyIndicators({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  const coverage = coverageVerdict(report);
  const reconstitution = reconstitutionVerdict(journals);

  const coverageText = t(`consistency.indicators.coverage.${coverage.loading ? "loading" : coverage.status}`, {
    count: coverage.uncovered,
  });
  const reconstitutionText = t(`consistency.indicators.reconstitution.${reconstitution.loading ? "loading" : reconstitution.status}`, {
    count: reconstitution.gaps,
    date: reconstitution.asOf === null ? "" : formatSnapshotDate(reconstitution.asOf),
  });
  const summary = `${coverageText}. ${reconstitutionText}`;

  return (
    <Link
      to={`/accounts/${accountId}/consistency`}
      aria-label={summary}
      title={summary}
      className="ml-auto flex items-center gap-3 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Indicator
        testId="coverage-indicator"
        label={t("consistency.indicators.coverage.label")}
        status={coverage.status}
        blink={coverage.status === "alert"}
      />
      <Indicator
        testId="reconstitution-indicator"
        label={t("consistency.indicators.reconstitution.label")}
        status={reconstitution.status}
        blink={false}
      />
    </Link>
  );
}

interface IndicatorProps {
  testId: string;
  label: string;
  status: ConsistencyStatus;
  blink: boolean;
}

function Indicator({ testId, label, status, blink }: IndicatorProps) {
  return (
    <span data-testid={testId} data-status={status} className="flex items-center gap-1.5">
      {/* Below `sm` the icons speak alone; the link's label still says everything. */}
      <span className="hidden sm:inline">{label}</span>
      <ShieldCheck aria-hidden="true" className={cn("size-4", ICON_TONE[status], blink && "motion-safe:animate-pulse")} />
    </span>
  );
}
```

- [x] **Step 5 : la barre de titre les rend**

Dans `apps/web/src/routes/AppLayout.tsx`, ajouter `import { ConsistencyIndicators } from "@/components/ConsistencyIndicators";` après l'import d'`AppSidebar`, et dans `inset`, juste avant `</header>`, ajouter :

```tsx
        {scoped && <ConsistencyIndicators accountId={scoped} />}
```

- [x] **Step 6 : vérifier qu'ils passent**

Run: `pnpm --filter web test src/routes/AppLayout.test.tsx && pnpm --filter web typecheck && pnpm lint`
Expected: PASS, tous les tests d'`AppLayout`.

- [x] **Step 7 : commit**

Cocher les cases de la tâche 3, puis :

```bash
git add apps/web/src docs/plans/2026-09-11-consistance.md
git commit -F - <<'EOF'
feat(web): la barre de titre porte les verdicts Couverture et Reconstitution

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```

---

## Tâche 4 : la page Consistance

**Files:**
- Create: `apps/web/src/components/UncoveredCard.tsx`, `apps/web/src/components/UncoveredCard.test.tsx`, `apps/web/src/pages/ConsistencyPage.tsx`, `apps/web/src/pages/ConsistencyPage.test.tsx`, `apps/web/src/lib/currencies.ts`
- Modify: `apps/web/src/components/ReconciliationCard.tsx`, `apps/web/src/components/CashCheckCard.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/HistoryPage.tsx`, `apps/web/src/routes/router.tsx`, `apps/web/src/lib/navigation.ts`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/components/ReconciliationCard.test.tsx`, `apps/web/src/components/CashCheckCard.test.tsx`, `apps/web/src/routes/router.test.tsx`, `apps/web/src/routes/AppLayout.test.tsx`

**Interfaces:**
- Consomme : `useAccountJournals`, `useAccountRiskReport`, `WithAccountData` (tâche 1) ; `formatSnapshotDate` (tâche 2) ; `useLedger`, `useCashPoints` (`@/db/hooks`) ; `anchoredBalances` (`@ib/ledger`).
- Produit :
  - `UncoveredCard({ accountId: string; report: RiskReport | null })`, `<Card aria-label="Positions non couvertes">`
  - `ReconciliationCard` rendu dans `<Card aria-label="Reconstitution du portefeuille">`, `CashCheckCard` dans `<Card aria-label="Cohérence du cash">`, chacune avec un `CardTitle`
  - `ConsistencyPage()`, route `consistency` sous `/accounts/:accountId`
  - `BALANCE_CURRENCIES` dans `@/lib/currencies`
  - Clés i18n `nav.consistency`, `consistency.uncovered.{title,empty}`, `consistency.reconciliation.title`, `consistency.cash.title`

- [x] **Step 1 : écrire les tests des cartes**

Créer `apps/web/src/components/UncoveredCard.test.tsx` :

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { buildRiskReport, type RiskReport } from "@ib/coverage";
import i18n from "@/i18n";
import { UncoveredCard } from "@/components/UncoveredCard";
import { SAMPLE_POSITIONS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderCard(report: RiskReport | null) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <UncoveredCard accountId="alpha" report={report} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("UncoveredCard", () => {
  it("lists the uncovered positions with their uncovered quantity", () => {
    renderCard(buildRiskReport(SAMPLE_SNAPSHOT.positions, SAMPLE_SNAPSHOT.cashAvailable));
    const card = screen.getByLabelText("Positions non couvertes");
    expect(within(card).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
    // "1" twice: the card's count badge and the row's uncovered quantity.
    expect(within(card).getAllByText("1")).toHaveLength(2);
  });

  it("shows the covered state when nothing is uncovered", () => {
    renderCard(buildRiskReport([SAMPLE_POSITIONS[5]], 42000));
    expect(screen.getByText("Aucune position non couverte.")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("points at the data sources without a snapshot, and counts nothing", () => {
    renderCard(null);
    const card = screen.getByLabelText("Positions non couvertes");
    expect(within(card).getByText(/Aucun snapshot de positions : importez un relevé HTML ou une réponse Flex/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/alpha/sources");
    expect(within(card).queryByText("0")).not.toBeInTheDocument();
    expect(within(card).queryByText("Aucune position non couverte.")).not.toBeInTheDocument();
  });
});
```

Dans `apps/web/src/components/ReconciliationCard.test.tsx`, ajouter à la fin du `describe` :

```tsx
  it("carries its title, in every state", () => {
    renderCard({ asOf: null, differences: [], orphans: [] });
    expect(screen.getByLabelText("Reconstitution du portefeuille")).toHaveTextContent(/^Reconstitution du portefeuille/);
  });
```

Dans `apps/web/src/components/CashCheckCard.test.tsx`, ajouter à la fin du `describe` :

```tsx
  it("carries its title", () => {
    renderCard([{ currency: "USD", offset: 0, end: null, start: null }]);
    expect(screen.getByLabelText("Cohérence du cash")).toHaveTextContent(/^Cohérence du cash/);
  });
```

- [x] **Step 2 : écrire les tests de la page, de la route et du menu**

Créer `apps/web/src/pages/ConsistencyPage.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { ConsistencyPage } from "@/pages/ConsistencyPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderConsistency(accountId: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/consistency`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/consistency"
            element={
              <WithAccountData>
                <ConsistencyPage />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.cashPoints.clear(), db.contracts.clear(), db.accounts.clear()]);
});

describe("ConsistencyPage", () => {
  it("stacks the three checks in order under its title", async () => {
    renderConsistency("alpha");
    const uncovered = await screen.findByLabelText("Positions non couvertes");
    const reconciliation = screen.getByLabelText("Reconstitution du portefeuille");
    const cash = screen.getByLabelText("Cohérence du cash");
    expect(screen.getByRole("heading", { level: 1, name: "Consistance" })).toBeInTheDocument();
    expect(uncovered.compareDocumentPosition(reconciliation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reconciliation.compareDocumentPosition(cash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists the positions the snapshot leaves uncovered", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Positions non couvertes");
    expect(within(card).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
  });

  it("carries the reconciliation in its three states, following the base", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderConsistency("beta");
    expect(await screen.findByText("Portefeuille reconstitué conforme au snapshot du 2026-09-02")).toBeInTheDocument();
    await db.snapshots.put({ ...SAMPLE_JOURNAL_SNAPSHOT, positions: SAMPLE_JOURNAL_SNAPSHOT.positions.slice(1) });
    expect(await screen.findByText("MQZA : ledger 200, snapshot 0")).toBeInTheDocument();
    await db.snapshots.clear();
    const card = screen.getByLabelText("Reconstitution du portefeuille");
    expect(await within(card).findByText(/Aucun snapshot de positions/)).toBeInTheDocument();
  });

  it("checks the cash against the Cash Report", async () => {
    await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS);
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Cohérence du cash");
    expect(within(card).getByText("USD : solde calé sur le cash de fin du 2026-12-31 (1,456.85), début non vérifié")).toBeInTheDocument();
    expect(within(card).getByText("EUR : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
  });

  it("shows the cash check even on an empty ledger", async () => {
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Cohérence du cash");
    expect(within(card).getByText("USD : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
    expect(within(card).getByText("EUR : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
  });
});
```

Dans `apps/web/src/routes/router.test.tsx`, ajouter à la fin du `describe` :

```tsx
  it("routes the Consistency page under the account", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    expect((account?.children ?? []).map((c) => c.path)).toContain("consistency");
  });
```

Dans `apps/web/src/routes/AppLayout.test.tsx`, test « shows the nav entry for every screen », insérer `"/accounts/beta/consistency",` entre `"/accounts/beta/sources",` et `"/settings",`.

- [x] **Step 3 : vérifier qu'ils échouent**

Run: `pnpm --filter web test src/components src/pages/ConsistencyPage.test.tsx src/routes`
Expected: FAIL — `UncoveredCard` et `ConsistencyPage` introuvables, les deux titres de cartes absents, la route et l'entrée de menu absentes.

- [x] **Step 4 : les phrases**

Dans `apps/web/src/i18n/fr.json` :
- dans `nav`, après `"sources": "Sources de données",`, ajouter `"consistency": "Consistance",` ;
- dans `consistency`, avant `"indicators": {`, ajouter :

```json
    "uncovered": {
      "title": "Positions non couvertes",
      "empty": "Aucune position non couverte."
    },
    "reconciliation": {
      "title": "Reconstitution du portefeuille"
    },
    "cash": {
      "title": "Cohérence du cash"
    },
```

- dans `dashboard`, supprimer le bloc `"uncoveredCard": { ... }` et la virgule qui le précède après `"cashCard": { ... }`.

Dans `apps/web/src/i18n/en.json`, les mêmes changements :
- `nav` : après `"sources": "Data sources",`, ajouter `"consistency": "Consistency",` ;
- `consistency`, avant `"indicators": {` :

```json
    "uncovered": {
      "title": "Uncovered positions",
      "empty": "No uncovered position."
    },
    "reconciliation": {
      "title": "Portfolio reconstitution"
    },
    "cash": {
      "title": "Cash consistency"
    },
```

- `dashboard` : supprimer `"uncoveredCard": { ... }` et sa virgule.

- [x] **Step 5 : `UncoveredCard`, et le Dashboard s'en sert**

Créer `apps/web/src/components/UncoveredCard.tsx` :

```tsx
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { uncovered, type RiskReport } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { formatContract } from "@/lib/format";

interface UncoveredCardProps {
  accountId: string;
  /** `null` without a positions snapshot. */
  report: RiskReport | null;
}

/** The positions nothing covers, with how much of each is naked (spec of sub-project 11, §5). */
export function UncoveredCard({ accountId, report }: UncoveredCardProps) {
  const { t } = useTranslation();
  // Without a snapshot there is no count to show: never a "0" that would read as covered.
  const naked = report === null ? null : uncovered(report);

  return (
    <Card aria-label={t("consistency.uncovered.title")}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("consistency.uncovered.title")}</CardTitle>
        {naked !== null && (
          <CardAction>
            <Badge variant={naked.length > 0 ? "warning" : "outline"}>{naked.length}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {naked === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("reconciliation.none")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("reconciliation.noneLink")}
            </Link>
          </div>
        ) : naked.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ShieldCheck className="size-8 text-success" />
            <p className="text-sm text-muted-foreground">{t("consistency.uncovered.empty")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {naked.map((position) => (
              <div key={position.description} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="truncate text-sm">{formatContract(position)}</span>
                <span className="shrink-0 font-mono text-sm font-medium text-destructive tabular-nums">
                  {position.uncoveredQuantity}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Dans `apps/web/src/pages/DashboardPage.tsx` :
- supprimer `import { ShieldCheck } from "lucide-react";` ;
- `import { cashOk, cashRequired, uncovered } from "@ib/coverage";` devient `import { cashOk, cashRequired } from "@ib/coverage";` ;
- `import { formatContract, formatMoney, formatPercent } from "@/lib/format";` devient `import { formatMoney, formatPercent } from "@/lib/format";` ;
- ajouter `import { UncoveredCard } from "@/components/UncoveredCard";` après l'import de `SnapshotStatus` ;
- supprimer la ligne `  const naked = uncovered(report);` ;
- remplacer tout le bloc `<Card aria-label={t("dashboard.uncoveredCard.title")}> … </Card>` (le second `Card` de la grille) par `<UncoveredCard accountId={accountId} report={report} />`.

- [x] **Step 6 : titres de `ReconciliationCard` et `CashCheckCard`**

Remplacer tout le contenu de `apps/web/src/components/ReconciliationCard.tsx` par :

```tsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { Reconciliation } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { formatSnapshotDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ReconciliationCardProps {
  accountId: string;
  reconciliation: Reconciliation;
}

/** Spec §7.2: the replayed portfolio against the snapshot, in one of three states. */
export function ReconciliationCard({ accountId, reconciliation }: ReconciliationCardProps) {
  const { t } = useTranslation();
  return (
    <Card aria-label={t("consistency.reconciliation.title")}>
      <CardHeader>
        <CardTitle>{t("consistency.reconciliation.title")}</CardTitle>
      </CardHeader>
      <ReconciliationContent accountId={accountId} reconciliation={reconciliation} />
    </Card>
  );
}

function ReconciliationContent({ accountId, reconciliation }: ReconciliationCardProps) {
  const { t } = useTranslation();
  const { asOf, differences, orphans } = reconciliation;

  if (asOf === null) {
    return (
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("reconciliation.none")}</p>
        <Link to={`/accounts/${accountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("reconciliation.noneLink")}
        </Link>
      </CardContent>
    );
  }

  const date = formatSnapshotDate(asOf);
  if (differences.length === 0 && orphans.length === 0) {
    return (
      <CardContent className="flex items-center gap-3">
        <Badge variant="success">OK</Badge>
        <p className="text-sm">{t("reconciliation.ok", { date })}</p>
      </CardContent>
    );
  }

  return (
    <CardContent className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Badge variant="warning">{differences.length}</Badge>
        <p className="text-sm font-medium">{t("reconciliation.differences", { count: differences.length, date })}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t("reconciliation.hint")}</p>
      <ul className="list-disc pl-5 font-mono text-xs tabular-nums">
        {differences.map((d) => (
          <li key={d.label}>{t("reconciliation.difference", { label: d.label, ledger: d.ledgerQty, snapshot: d.snapshotQty })}</li>
        ))}
      </ul>
      {orphans.length > 0 && <p className="text-xs text-muted-foreground">{t("reconciliation.orphans", { count: orphans.length })}</p>}
    </CardContent>
  );
}
```

Dans `apps/web/src/components/CashCheckCard.tsx` :
- `import { Card, CardContent } from "@ib/ui/card";` devient `import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";` ;
- dans `CashCheckCard`, remplacer `    <Card>` par :

```tsx
    <Card aria-label={t("consistency.cash.title")}>
      <CardHeader>
        <CardTitle>{t("consistency.cash.title")}</CardTitle>
      </CardHeader>
```

- [x] **Step 7 : `BALANCE_CURRENCIES` partagé**

Créer `apps/web/src/lib/currencies.ts` :

```ts
/**
 * The currencies the History keeps a running balance for, and the Consistency page checks
 * against the Cash Reports; the ledger itself is currency-agnostic.
 */
export const BALANCE_CURRENCIES = ["USD", "EUR"] as const;
```

Dans `apps/web/src/pages/HistoryPage.tsx`, supprimer les deux lignes :

```tsx
/** The two balance columns of the table; the ledger itself is currency-agnostic. */
const BALANCE_CURRENCIES = ["USD", "EUR"] as const;
```

et ajouter `import { BALANCE_CURRENCIES } from "@/lib/currencies";` après l'import de `@/lib/format`.

- [x] **Step 8 : la page, la route, le menu**

Créer `apps/web/src/pages/ConsistencyPage.tsx` :

```tsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { anchoredBalances } from "@ib/ledger";
import { CashCheckCard } from "@/components/CashCheckCard";
import { ReconciliationCard } from "@/components/ReconciliationCard";
import { SnapshotStatus } from "@/components/SnapshotStatus";
import { UncoveredCard } from "@/components/UncoveredCard";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCashPoints, useLedger } from "@/db/hooks";
import { BALANCE_CURRENCIES } from "@/lib/currencies";

/** Spec of sub-project 11, §5: the three checks that say whether the rest of the app can be believed. */
export function ConsistencyPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );

  if (report === undefined || journals.status === "loading" || anchored === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.consistency")}</h1>
        <SnapshotStatus accountId={accountId} />
      </div>
      <UncoveredCard accountId={accountId} report={report} />
      <ReconciliationCard accountId={accountId} reconciliation={journals.report.reconciliation} />
      {/* Shown even on an empty ledger, where it says no Cash Report anchors anything. */}
      <CashCheckCard accountId={accountId} checks={anchored.checks} />
    </div>
  );
}
```

Dans `apps/web/src/routes/router.tsx`, ajouter `import { ConsistencyPage } from "@/pages/ConsistencyPage";` après l'import d'`AccountsPage`, et après `{ path: "sources", element: <SourcesPage /> },` ajouter `{ path: "consistency", element: <ConsistencyPage /> },`.

Dans `apps/web/src/lib/navigation.ts`, ajouter `ShieldCheck,` à l'import de `lucide-react` (entre `Settings,` et `TrendingUp,`), et dans la section `nav.sections.configuration`, après l'entrée `nav.sources`, ajouter :

```ts
      { labelKey: "nav.consistency", icon: ShieldCheck, to: accountPath("consistency") },
```

- [x] **Step 9 : vérifier qu'ils passent**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: tout vert, y compris `DashboardPage.test.tsx`, dont les tests des non couvertes passent toujours par `UncoveredCard`.

- [x] **Step 10 : commit**

Cocher les cases de la tâche 4, puis :

```bash
git add apps/web/src docs/plans/2026-09-11-consistance.md
git commit -F - <<'EOF'
feat(web): page Consistance, couverture, reconstitution et cash réunis

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```

---

## Tâche 5 : les cartes quittent Dashboard, Journaux et Historique

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/JournalPage.tsx`, `apps/web/src/pages/HistoryPage.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`, `apps/web/src/pages/JournalPage.test.tsx`, `apps/web/src/pages/HistoryPage.test.tsx`

**Interfaces:**
- Consomme : les titres `aria-label` des trois cartes (tâche 4).
- Produit : rien de nouveau ; `history.columns.balanceHint` renvoie à la page Consistance.

- [x] **Step 1 : écrire les tests d'absence**

`apps/web/src/pages/DashboardPage.test.tsx` :
- supprimer les tests « lists the uncovered positions with their uncovered quantity » et « shows the empty state when nothing is uncovered » (ils vivent dans `UncoveredCard.test.tsx` et `ConsistencyPage.test.tsx`) ;
- `import { SAMPLE_POSITIONS, SAMPLE_SNAPSHOT } from "@/mocks/positions";` devient `import { SAMPLE_SNAPSHOT } from "@/mocks/positions";` ;
- ajouter à la fin du `describe` :

```tsx
  it("leaves the uncovered positions to the Consistency page", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    await screen.findByLabelText("Marge de cash");
    expect(screen.queryByLabelText("Positions non couvertes")).not.toBeInTheDocument();
    expect(screen.queryByText("AAPL Feb20'26 155 Call")).not.toBeInTheDocument();
  });
```

`apps/web/src/pages/JournalPage.test.tsx` : remplacer tout le test « carries the reconciliation card in its three states » par :

```tsx
  it("leaves the reconciliation to the Consistency page", async () => {
    renderJournal("wheel");
    await screen.findAllByTestId("journal-label");
    expect(screen.queryByLabelText("Reconstitution du portefeuille")).not.toBeInTheDocument();
    expect(screen.queryByText(/Portefeuille reconstitué/)).not.toBeInTheDocument();
  });
```

`apps/web/src/pages/HistoryPage.test.tsx` :
- dans « says on the balance headers what the balances are anchored on », ajouter à la fin :

```tsx
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("la page Consistance dit s'il retombe sur le cash de début"));
```

- dans « anchors the balances on the end point of the Cash Report », supprimer la dernière ligne `expect(screen.getByText("USD : solde calé sur le cash de fin du 2026-12-31 (1,456.85), début non vérifié")).toBeInTheDocument();` ;
- supprimer tout le test « says when no Cash Report anchors the balances » ;
- remplacer tout le test « shows no cash card on an empty ledger » par :

```tsx
  it("leaves the cash check to the Consistency page", async () => {
    await seed();
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderHistory();
    // Still anchored: only the card moved.
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("1,456.85");
    expect(screen.queryByLabelText("Cohérence du cash")).not.toBeInTheDocument();
    expect(screen.queryByText(/solde calé sur le cash de fin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aucun Cash Report/)).not.toBeInTheDocument();
  });
```

- [x] **Step 2 : vérifier qu'ils échouent**

Run: `pnpm --filter web test src/pages/DashboardPage.test.tsx src/pages/JournalPage.test.tsx src/pages/HistoryPage.test.tsx`
Expected: FAIL sur les trois tests d'absence et sur l'infobulle (« la page Consistance »).

- [x] **Step 3 : retirer les cartes**

`apps/web/src/pages/DashboardPage.tsx` : supprimer `import { UncoveredCard } from "@/components/UncoveredCard";` et la ligne `<UncoveredCard accountId={accountId} report={report} />`. La grille `md:grid-cols-2` reste : la carte « Marge de cash » garde sa demi-largeur.

`apps/web/src/pages/JournalPage.tsx` : supprimer `import { useParams } from "react-router";`, `import { ReconciliationCard } from "@/components/ReconciliationCard";`, la ligne `const { accountId = "" } = useParams<{ accountId: string }>();` et la ligne `<ReconciliationCard accountId={accountId} reconciliation={view.report.reconciliation} />`.

`apps/web/src/pages/HistoryPage.tsx` : supprimer `import { CashCheckCard } from "@/components/CashCheckCard";`, la ligne `{anchored && anchored.rows.length > 0 && <CashCheckCard accountId={accountId} checks={anchored.checks} />}` et la ligne vide qui la suit ; remplacer le commentaire

```tsx
                  {/* Anchored on the cash points when a file carries a Cash Report; the card
                      above says so, the title repeats it on the column itself. */}
```

par

```tsx
                  {/* Anchored on the cash points when a file carries a Cash Report; the
                      Consistency page checks it, the title says so on the column itself. */}
```

`apps/web/src/i18n/fr.json`, `history.columns.balanceHint` :

```json
      "balanceHint": "Solde cumulé sur toutes les transactions en base — les filtres ne le modifient pas. Il est calé sur le cash de fin du fichier le plus récent qui porte un Cash Report ; la page Consistance dit s'il retombe sur le cash de début."
```

`apps/web/src/i18n/en.json`, `history.columns.balanceHint` :

```json
      "balanceHint": "Running balance over every transaction on record — filters do not change it. It is anchored on the ending cash of the latest file carrying a Cash Report; the Consistency page says whether it comes back to the starting cash."
```

- [x] **Step 4 : vérifier qu'ils passent**

Run: `grep -rn "ReconciliationCard\|CashCheckCard\|UncoveredCard" apps/web/src --include=*.tsx | grep -v "\.test\.tsx\|components/"`
Expected: seulement les imports et usages de `pages/ConsistencyPage.tsx`.

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: tout vert.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 5, puis :

```bash
git add apps/web/src docs/plans/2026-09-11-consistance.md
git commit -F - <<'EOF'
feat(web): les cartes de vérification quittent Dashboard, Journaux et Historique

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```

---

## Tâche 6 : vérification dans la vraie application, documentation, revue, merge

**Files:**
- Modify: `CLAUDE.md`, `docs/specs/2026-09-03-architecture-design.md` (§9, après la note du 2026-09-07), `docs/specs/2026-09-11-consistance-design.md:3`, `docs/points-reportes.md` (si la revue reporte quelque chose)

- [x] **Step 1 : `pnpm check`**

Run: `pnpm check`
Expected: lint, typecheck, `check:api-types`, build et tous les Vitest verts. Un échec s'examine avec `superpowers:systematic-debugging`, jamais par un contournement.

- [x] **Step 2 : captures**

Le worktree a son propre port Vite (`tools/dev-env/ports.mjs`) : le driver démarre son serveur au lieu de réutiliser celui de la racine. Lire sa ligne `dev-env: worktree consistance → web :…`.

```bash
SHOTS=/tmp/ib-frontend-shots/consistance
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/consistency /accounts/beta/consistency /accounts/alpha/dashboard /accounts/beta/journal/wheel /accounts/alpha/history --seed --out=$SHOTS/seed
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/consistency --empty --out=$SHOTS/empty
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/consistency /accounts/beta/dashboard --seed --dark --out=$SHOTS/dark
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/consistency --seed --width=400 --out=$SHOTS/narrow
```

Lire chaque PNG avec l'outil Read et vérifier :
- `seed/accounts-alpha-consistency.png` : barre de titre à droite, « Couverture » icône rouge, « Reconstitution » icône rouge ; page « Consistance », trois cartes titrées dans l'ordre, le call AAPL non couvert, 12 écarts, cash OK ;
- `seed/accounts-beta-consistency.png` : deux icônes vertes, « conforme au snapshot du 2026-09-02 » ;
- `seed/accounts-alpha-dashboard.png` : plus de carte « Positions non couvertes », la carte de cash à demi-largeur ;
- `seed/accounts-beta-journal-wheel.png` : plus de carte de reconstitution ;
- `seed/accounts-alpha-history.png` : plus de carte de cash, les soldes toujours calés ;
- `empty/accounts-alpha-consistency.png` : deux icônes grises ; les deux premières cartes disent « Aucun snapshot de positions », la carte cash « aucun Cash Report » ;
- `dark/…` : icônes et cartes lisibles en thème sombre ;
- `narrow/…` : à 400 px, la barre de titre garde les deux icônes sans libellé, rien ne déborde horizontalement.

Si le driver échoue (délai `networkidle`, Chromium manquant), s'arrêter et le signaler avec sa sortie ; ne pas modifier le driver.

- [x] **Step 3 : `CLAUDE.md`**

1. Tableau des sous-projets, ajouter après la ligne du 10 :

```markdown
| 11 | Page Consistance et verdicts permanents dans la barre de titre | livré (2026-09-11), en attente de merge |
```

2. Après la règle « **Les journaux sont une vue calculée du ledger, jamais stockée** … », ajouter :

```markdown
- **Journaux et rapport de risque se calculent une fois, dans la coquille** :
  `AccountDataProvider` (`db/AccountDataProvider.tsx`), monté par `AppLayout` pour le compte
  affiché, appelle `useJournals` et `useRiskReport` ; la barre de titre et toutes les pages les
  lisent par `useAccountJournals` et `useAccountRiskReport`, qui lèvent une erreur hors du
  fournisseur. Aucune page n'appelle `useJournals` ni `useRiskReport` directement.
- **Couverture, reconstitution et cohérence du cash vivent sur la page Consistance**, et nulle
  part ailleurs. La barre de titre porte en permanence deux verdicts (`lib/consistency.ts`),
  Couverture et Reconstitution : vert, rouge, gris sans snapshot. Seule une position non
  couverte clignote ; un écart de reconstitution est une alerte, rouge fixe, même quand un
  historique tronqué suffit à l'expliquer.
```

3. Dans la règle « **Le solde cumulé de l'Historique est calé, jamais stocké** », remplacer « La carte « Cohérence du cash » l'affiche ; » par « La carte « Cohérence du cash » de la page Consistance l'affiche ; ».

- [x] **Step 4 : les specs**

Dans `docs/specs/2026-09-03-architecture-design.md`, §9, après le paragraphe « **Note du 2026-09-07** … », ajouter :

```markdown
**Note du 2026-09-11** : une page Consistance, `/accounts/:id/consistency`, s'ajoute à la section
Configuration sous Sources de données. Elle réunit les positions non couvertes (venues du
Dashboard), la reconstitution du portefeuille (venue des Journaux) et la cohérence du cash (venue
de l'Historique) ; la barre de titre porte en permanence deux verdicts, Couverture et
Reconstitution, liés à cette page (`2026-09-11-consistance-design.md`).
```

Dans `docs/specs/2026-09-11-consistance-design.md`, remplacer `Statut : conçu (2026-09-11).` par `Statut : implémenté (2026-09-11).`

Commit :

```bash
git add CLAUDE.md docs
git commit -F - <<'EOF'
docs: sous-projet 11 livré, règles du calcul partagé et de la page Consistance

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```

- [x] **Step 5 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche `consistance` contre `main`, avec ce plan et le spec. Corriger chaque constat retenu (TDD, un commit par correction). Un constat jugé non bloquant et reporté délibérément s'écrit dans `docs/points-reportes.md`, sous un titre `## Reporté par le sous-projet 11 (page Consistance)` inséré avant `## Sans échéance`, avec la raison du report. Relancer `pnpm check` après les corrections.

- [x] **Step 6 : merge**

Cocher les cases de la tâche 6 dans le dernier commit de la branche, puis invoquer `superpowers:finishing-a-development-branch`. Après le merge sur `main`, dans `CLAUDE.md`, la ligne du 11 devient `| 11 | Page Consistance et verdicts permanents dans la barre de titre | fait (2026-09-11) |`, puis :

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: sous-projet 11 mergé sur main

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wT6hjkGgosKx81p1NJrci
EOF
```
