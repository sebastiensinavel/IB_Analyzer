# Sous-projet 1 — Socle du monorepo et Historique au palier 2 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une application web sans serveur où l'on crée un compte, importe un XML Flex et un relevé HTML depuis le disque, et lit la page Historique avec ses soldes cumulés USD et EUR.

**Architecture:** Monorepo pnpm. `packages/ledger` (TS pur) porte le modèle de transaction, les soldes et la propriété de plage ; `packages/ib-parsers` (TS pur, DOMParser) transforme Flex XML et relevé HTML en lignes de ledger ; `apps/web` (Vite + React) persiste en IndexedDB via Dexie, lit par `useLiveQuery`, et reprend la coquille visuelle de la première version ; `packages/ui` porte les composants shadcn.

**Tech Stack:** Node 22, pnpm (corepack), TypeScript 6, Vite 8, Vitest 4, React 19, react-router 8, react-i18next, Tailwind 4, shadcn base-ui, Dexie 4, dexie-react-hooks, fake-indexeddb, @noble/hashes, oxlint, Playwright (driver du skill `run-frontend` seulement).

**Spec:** `docs/specs/2026-09-03-socle-historique-design.md` (lire aussi `docs/specs/2026-09-03-architecture-design.md` §3, §6 et CLAUDE.md).

## Global Constraints

- `private/` n'est jamais versionné ; aucun identifiant de compte, jeton ou montant réel dans un fichier committé.
- Une valeur absente reste `null`, jamais `0`, et s'affiche « — ».
- Paire de devises reconnue à la forme du symbole `^[A-Z]{3}\.[A-Z]{3}$` : `amount` à la devise de cotation, `quantity` et `commission` à la devise de base.
- Ordre de référence : `when` croissant puis `externalId` croissant.
- Flex conserve ses lignes pour toujours ; le relevé HTML n'écrit qu'avant le premier jour Flex ; un relevé remplace ses propres lignes sur sa période déclarée.
- Comptes jamais combinés : toute clé IndexedDB et toute route est scopée par `accountId` (slug du libellé).
- shadcn est **base-ui** : `render={<X />}` au lieu de `asChild`, `onValueChange` typé `T | null`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Un test doit échouer si le comportement change, pas seulement couvrir des lignes.
- Versions : TypeScript `~6.0.3`, Vite `^8.2.2`, Vitest `^4.1.11`, React `^19.2.8`, react-router `^8.3.0`, `@base-ui/react ^1.7.0`, Tailwind `^4.3.3`, Dexie `^4.4.5`, dexie-react-hooks `^4.4.0`, fake-indexeddb `^6.2.5`, `@noble/hashes ^2.4.0`, oxlint `^1.80.0`, jsdom `^30.0.1`.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF
  ```
- Le travail se fait dans un worktree `.claude/worktrees/socle-historique` (skill `superpowers:using-git-worktrees`), branche `socle-historique`, mergé sur `main` après revue.

---

## Structure des fichiers

```
package.json                         scripts racine, devDependencies partagées (typescript, oxlint, vitest)
pnpm-workspace.yaml
tsconfig.base.json
.oxlintrc.json
.gitignore                           ajouter node_modules/, dist/, coverage/, *.tsbuildinfo

packages/ledger/
  package.json                       "@ib/ledger", exports ./src/index.ts
  tsconfig.json
  vitest.config.ts                   environment node
  src/index.ts                       ré-exports
  src/types.ts                       TRANSACTION_KINDS, Transaction, TransactionSource
  src/order.ts                       compareTransactions, sortTransactions
  src/cash.ts                        isCurrencyPair, cashImpact, runningBalances, LedgerRow
  src/filter.ts                      dayOf, matchesFilter, filterTransactions
  src/import.ts                      planImport, ImportBatch, ImportPlan, DroppedCount
  src/*.test.ts

packages/ib-parsers/
  package.json                       "@ib/ib-parsers", dépend de @ib/ledger et @noble/hashes
  tsconfig.json
  vitest.config.ts                   environment jsdom
  src/index.ts
  src/issues.ts                      ParseIssue, ParseTarget, ParseResult, hasErrors
  src/common.ts                      NormalizationError, parseNumber, dates, splitOptionSymbol, symbolFromDescription
  src/hash.ts                        statementExternalId, suffixTwins
  src/flex.ts                        parseFlexXml
  src/statement.ts                   parseActivityStatement
  src/*.test.ts
  scripts/anonymize-flex.mjs         private/*.xml → fixture
  tests/fixtures/flex_activity_sample.xml
  tests/fixtures/activity_statement_sample.htm

packages/ui/
  package.json                       "@ib/ui", exports "./*": "./src/components/ui/*.tsx"
  tsconfig.json
  components.json
  README.md                          règle des imports relatifs après `shadcn add`
  src/lib/utils.ts                   cn()
  src/hooks/use-mobile.ts
  src/components/ui/*.tsx            copiés, imports "@/..." réécrits en relatifs

apps/web/
  package.json, index.html, vite.config.ts, tsconfig.json, tsconfig.node.json, vitest.setup.ts
  public/favicon.svg
  src/main.tsx, src/App.tsx, src/index.css
  src/i18n/{index.ts,en.json,fr.json}
  src/lib/{format.ts,utils.ts,accountStorage.ts,navigation.ts}
  src/hooks/useTheme.ts
  src/components/{LanguageSwitcher,ThemeToggle,AccountSwitcher,app-sidebar}.tsx
  src/db/{schema.ts,accounts.ts,hooks.ts,readFile.ts,importFile.ts}
  src/routes/{router.tsx,AppLayout.tsx,RootRedirect.tsx}
  src/pages/{PlaceholderPage,AccountsPage,HistoryPage,SourcesPage,UnknownAccountPage}.tsx
  src/mocks/{ledger.ts,seed.ts}
  tests colocalisés *.test.ts(x)

.claude/skills/run-frontend/{SKILL.md,driver.mjs}
docs/plans/2026-09-03-socle-historique.md   ce fichier
```

---

## Tâche 1 : squelette du monorepo et paquet `ledger` avec le type `Transaction`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.oxlintrc.json`, `.npmrc`
- Modify: `.gitignore`
- Create: `packages/ledger/package.json`, `packages/ledger/tsconfig.json`, `packages/ledger/vitest.config.ts`, `packages/ledger/src/index.ts`, `packages/ledger/src/types.ts`, `packages/ledger/src/order.ts`
- Test: `packages/ledger/src/order.test.ts`

**Interfaces:**
- Produces: `Transaction`, `TransactionKind`, `TRANSACTION_KINDS`, `TransactionSource`, `TRANSACTION_SOURCES`, `compareTransactions(a, b): number`, `sortTransactions(txs): Transaction[]` depuis `@ib/ledger`.

- [ ] **Étape 1 : activer pnpm sans sudo**

Node est `/usr/bin/node` (système), `corepack enable` y échouerait sans root. Installer le shim dans `~/.local/bin`, déjà dans le `PATH` :

```bash
corepack enable --install-directory ~/.local/bin
pnpm --version
```

Attendu : une version `10.x`. Si `pnpm` reste introuvable, ouvrir un nouveau shell ou `export PATH=~/.local/bin:$PATH`.

- [ ] **Étape 2 : fichiers racine**

`package.json` :

```json
{
  "name": "ib-analyzer2",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.18.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --filter web dev",
    "test": "pnpm -r --workspace-concurrency=1 test",
    "lint": "oxlint",
    "typecheck": "pnpm -r typecheck",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "oxlint": "^1.80.0",
    "typescript": "~6.0.3",
    "vitest": "^4.1.11"
  }
}
```

Remplacer `10.18.0` par la version imprimée à l'étape 1 (`pnpm --version`).

`pnpm-workspace.yaml` :

```yaml
packages:
  - apps/*
  - packages/*
```

`.npmrc` :

```
auto-install-peers=true
strict-peer-dependencies=false
```

`tsconfig.base.json` :

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true
  }
}
```

`.oxlintrc.json` :

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  },
  "ignorePatterns": ["**/dist/**", "**/node_modules/**", "packages/ui/src/components/ui/**"]
}
```

Ajouter à `.gitignore`, sous `# Node` :

```
coverage/
*.tsbuildinfo
.pnpm-store/
```

- [ ] **Étape 3 : paquet `ledger`**

`packages/ledger/package.json` :

```json
{
  "name": "@ib/ledger",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "~6.0.3",
    "vitest": "^4.1.11"
  }
}
```

`packages/ledger/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": [] },
  "include": ["src"]
}
```

`packages/ledger/vitest.config.ts` :

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

`packages/ledger/src/types.ts` :

```ts
export const TRANSACTION_KINDS = [
  "trade",
  "dividend",
  "interest",
  "fee",
  "tax",
  "corporate_action",
  "transfer",
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_SOURCES = ["flex", "statement_html", "agent"] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/**
 * One economic event of one account, whatever the source that reported it.
 * Money fields are `null` when the source did not provide them: unknown is
 * never zero.
 */
export interface Transaction {
  /** Slug of the owning account; every IndexedDB key and every route carries it. */
  accountId: string;
  /**
   * Dedup key inside one account:
   * `flex:trade:{tradeID}`, `flex:cash:{transactionID}`, `flex:ca:{transactionID}`,
   * `html:{sha256}` optionally suffixed `#2`, `#3`… for twin rows of one file.
   */
  externalId: string;
  source: TransactionSource;
  kind: TransactionKind;
  symbol: string;
  /** "STK", "OPT", "CASH", "WAR"… or "" when the row has no security. */
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  /** Signed: a sale is negative. */
  quantity: number | null;
  price: number | null;
  /** Gross cash effect of the row, in `currency`. */
  amount: number | null;
  commission: number | null;
  currency: string;
  /** ISO 8601 UTC, e.g. "2026-08-14T16:20:00.000Z". */
  when: string;
  description: string;
}
```

`packages/ledger/src/order.ts` :

```ts
import type { Transaction } from "./types.ts";

/**
 * Reference order of the ledger: `when` first, then `externalId`. HTML
 * statements stamp cash rows at midnight, so ties on `when` are common and
 * the running balances would be unstable without the second key.
 */
export function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.when < b.when) return -1;
  if (a.when > b.when) return 1;
  if (a.externalId < b.externalId) return -1;
  if (a.externalId > b.externalId) return 1;
  return 0;
}

export function sortTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort(compareTransactions);
}
```

`packages/ledger/src/index.ts` :

```ts
export * from "./types.ts";
export * from "./order.ts";
```

- [ ] **Étape 4 : test de l'ordre de référence**

`packages/ledger/src/fixtures.ts`, un constructeur de transaction pour tous les tests du paquet (hors d'un fichier `*.test.ts`, sinon chaque import rejouerait ses tests) :

```ts
import type { Transaction } from "./types.ts";

export function tx(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "test",
    externalId: "flex:trade:1",
    source: "flex",
    kind: "trade",
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity: 1,
    price: 10,
    amount: -10,
    commission: -1,
    currency: "USD",
    when: "2026-01-01T00:00:00.000Z",
    description: "",
    ...overrides,
  };
}
```

`packages/ledger/src/order.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { tx } from "./fixtures.ts";
import { sortTransactions } from "./order.ts";

describe("sortTransactions", () => {
  it("orders by when, oldest first, whatever the input order", () => {
    const sorted = sortTransactions([
      tx({ externalId: "b", when: "2026-01-02T00:00:00.000Z" }),
      tx({ externalId: "a", when: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((t) => t.externalId)).toEqual(["a", "b"]);
  });

  it("breaks ties on when with externalId, so midnight-stamped rows stay deterministic", () => {
    const midnight = "2025-03-15T00:00:00.000Z";
    const sorted = sortTransactions([
      tx({ externalId: "html:zzz", when: midnight }),
      tx({ externalId: "html:aaa", when: midnight }),
      tx({ externalId: "html:mmm", when: midnight }),
    ]);
    expect(sorted.map((t) => t.externalId)).toEqual(["html:aaa", "html:mmm", "html:zzz"]);
  });

  it("does not mutate its input", () => {
    const input = [tx({ externalId: "b", when: "2026-01-02T00:00:00.000Z" }), tx({ externalId: "a" })];
    sortTransactions(input);
    expect(input[0].externalId).toBe("b");
  });
});
```

- [ ] **Étape 5 : installer et lancer**

```bash
pnpm install
pnpm --filter @ib/ledger test
pnpm --filter @ib/ledger typecheck
pnpm lint
```

Attendu : 3 tests verts, typecheck silencieux, lint sans erreur.

- [ ] **Étape 6 : commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json .oxlintrc.json .gitignore packages/ledger
git commit -m "feat(ledger): squelette pnpm et type Transaction avec l'ordre de référence

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 2 : `cashImpact` et `runningBalances`

**Files:**
- Create: `packages/ledger/src/cash.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/src/cash.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `sortTransactions` (tâche 1).
- Produces: `CURRENCY_PAIR_RE`, `isCurrencyPair(symbol): boolean`, `baseCurrencyOf(symbol): string`, `cashImpact(tx): number | null`, `LedgerRow { transaction, cash, balances: Record<string, number> }`, `runningBalances(txs, currencies): LedgerRow[]` (ordre de référence croissant).

- [ ] **Étape 1 : tests**

`packages/ledger/src/cash.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { cashImpact, runningBalances } from "./cash.ts";
import { tx } from "./fixtures.ts";

describe("cashImpact", () => {
  it("adds the commission to the amount: both are signed by the broker", () => {
    expect(cashImpact(tx({ amount: -18050, commission: -1.5 }))).toBe(-18051.5);
  });

  it("treats a missing commission as nothing to add", () => {
    expect(cashImpact(tx({ amount: 610, commission: null }))).toBe(610);
  });

  it("is unknown when the amount is unknown, whatever the commission", () => {
    expect(cashImpact(tx({ amount: null, commission: -1 }))).toBeNull();
  });

  it("leaves the commission out of a currency conversion: IB charges it in the base currency", () => {
    expect(cashImpact(tx({ symbol: "EUR.USD", amount: 4641.84, commission: -1.7 }))).toBe(4641.84);
  });
});

describe("runningBalances", () => {
  const deposit = tx({
    externalId: "flex:cash:1",
    kind: "transfer",
    symbol: "",
    amount: 10000,
    commission: null,
    currency: "EUR",
    when: "2026-08-12T00:00:00.000Z",
  });
  const tsla = tx({
    externalId: "flex:trade:2",
    symbol: "TSLA",
    amount: -1100,
    commission: -1,
    when: "2026-08-20T09:05:00.000Z",
  });
  const msft = tx({
    externalId: "flex:trade:3",
    symbol: "MSFT",
    amount: 610,
    commission: -0.65,
    when: "2026-08-27T10:15:00.000Z",
  });
  const aapl = tx({
    externalId: "flex:trade:4",
    symbol: "AAPL",
    amount: -18050,
    commission: -1.5,
    when: "2026-08-28T14:30:00.000Z",
  });

  it("accumulates per currency in reference order, whatever the input order", () => {
    const rows = runningBalances([aapl, deposit, msft, tsla], ["USD", "EUR"]);
    expect(rows.map((r) => r.transaction.symbol)).toEqual(["", "TSLA", "MSFT", "AAPL"]);
    expect(rows.map((r) => r.balances.USD)).toEqual([0, -1101, -491.65, -18543.15]);
    expect(rows.map((r) => r.balances.EUR)).toEqual([10000, 10000, 10000, 10000]);
  });

  it("carries the other currency forward on a row that moves only one", () => {
    const [first, second] = runningBalances([deposit, tsla], ["USD", "EUR"]);
    expect(first.balances).toEqual({ USD: 0, EUR: 10000 });
    expect(second.balances).toEqual({ USD: -1101, EUR: 10000 });
  });

  it("reports the row's own cash impact next to the balances", () => {
    const [row] = runningBalances([aapl], ["USD"]);
    expect(row.cash).toBe(-18051.5);
  });

  it("splits a currency conversion over three fields: amount to the quote, quantity and commission to the base", () => {
    // SELL 1000 EUR at 1.10: +1100 USD, -1000 EUR, and the 2 EUR minimum commission in EUR.
    const conversion = tx({
      symbol: "EUR.USD",
      secType: "CASH",
      quantity: -1000,
      price: 1.1,
      amount: 1100,
      commission: -2,
      currency: "USD",
    });
    const [row] = runningBalances([conversion], ["USD", "EUR"]);
    expect(row.balances).toEqual({ USD: 1100, EUR: -1002 });
    expect(row.cash).toBe(1100);
  });

  it("skips the balance, not the row, when the amount is unknown", () => {
    const unknown = tx({ amount: null, commission: null, when: "2026-08-21T00:00:00.000Z" });
    const rows = runningBalances([tsla, unknown], ["USD"]);
    expect(rows[1].cash).toBeNull();
    expect(rows[1].balances.USD).toBe(-1101);
  });

  it("ignores currencies that were not asked for", () => {
    const [row] = runningBalances([deposit], ["USD"]);
    expect(row.balances).toEqual({ USD: 0 });
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

```bash
pnpm --filter @ib/ledger test
```

Attendu : échec, `./cash.ts` introuvable.

- [ ] **Étape 3 : implémentation**

`packages/ledger/src/cash.ts` :

```ts
import { sortTransactions } from "./order.ts";
import type { Transaction } from "./types.ts";

/** A currency conversion is recognised by its symbol, never by `secType`. */
export const CURRENCY_PAIR_RE = /^[A-Z]{3}\.[A-Z]{3}$/;

export function isCurrencyPair(symbol: string): boolean {
  return CURRENCY_PAIR_RE.test(symbol);
}

/** "EUR.USD" -> "EUR": the currency `quantity` and `commission` are denominated in. */
export function baseCurrencyOf(pairSymbol: string): string {
  return pairSymbol.slice(0, 3);
}

/**
 * Signed impact of one row on the balance of its `currency`. Broker signs
 * need no handling: proceeds are negative on a buy, commissions are always
 * negative, a withdrawal is negative. On a conversion the commission is
 * charged in the base currency, so it is left out here and counted by
 * `runningBalances` on the base side instead.
 */
export function cashImpact(tx: Transaction): number | null {
  if (tx.amount === null) return null;
  if (isCurrencyPair(tx.symbol)) return tx.amount;
  return tx.amount + (tx.commission ?? 0);
}

export interface LedgerRow {
  transaction: Transaction;
  /** This row's own impact, `null` when unknown. */
  cash: number | null;
  /** Balance of each requested currency once this row has settled. */
  balances: Record<string, number>;
}

/**
 * Running balances over the whole ledger of one account, in reference
 * order. Always feed it every transaction of the account, never a filtered
 * page: a balance is only meaningful from the oldest row on record.
 */
export function runningBalances(
  transactions: readonly Transaction[],
  currencies: readonly string[],
): LedgerRow[] {
  const totals: Record<string, number> = {};
  for (const currency of currencies) totals[currency] = 0;
  const add = (currency: string, value: number) => {
    if (currency in totals) totals[currency] += value;
  };

  return sortTransactions(transactions).map((transaction) => {
    const cash = cashImpact(transaction);
    if (cash !== null) add(transaction.currency, cash);
    if (isCurrencyPair(transaction.symbol)) {
      add(
        baseCurrencyOf(transaction.symbol),
        (transaction.quantity ?? 0) + (transaction.commission ?? 0),
      );
    }
    return { transaction, cash, balances: { ...totals } };
  });
}
```

Ajouter à `packages/ledger/src/index.ts` : `export * from "./cash.ts";`

- [ ] **Étape 4 : vérifier**

```bash
pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck
```

Attendu : tout vert. Si `-491.65` échoue d'un epsilon flottant, remplacer l'assertion par `toBeCloseTo(-491.65, 10)` sur chaque valeur ; ne pas arrondir dans l'implémentation.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledger
git commit -m "feat(ledger): effet cash et soldes cumulés par devise, règle des conversions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 3 : filtres de l'Historique

**Files:**
- Create: `packages/ledger/src/filter.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/src/filter.test.ts`

**Interfaces:**
- Produces: `dayOf(when): string` (`YYYY-MM-DD`), `TransactionFilter { symbol?, kind?, from?, to? }`, `matchesFilter(tx, filter): boolean`, `filterTransactions(txs, filter): Transaction[]`.

- [ ] **Étape 1 : tests**

`packages/ledger/src/filter.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { dayOf, filterTransactions, matchesFilter } from "./filter.ts";
import { tx } from "./fixtures.ts";

describe("dayOf", () => {
  it("keeps the UTC calendar day of an ISO timestamp", () => {
    expect(dayOf("2026-08-14T16:20:00.000Z")).toBe("2026-08-14");
  });
});

describe("matchesFilter", () => {
  const aapl = tx({ symbol: "AAPL", kind: "trade", when: "2026-02-10T12:00:00.000Z" });

  it("matches everything with an empty filter", () => {
    expect(matchesFilter(aapl, {})).toBe(true);
  });

  it("matches the symbol as a case-insensitive substring", () => {
    expect(matchesFilter(aapl, { symbol: "aap" })).toBe(true);
    expect(matchesFilter(aapl, { symbol: "MSFT" })).toBe(false);
  });

  it("matches the kind exactly and ignores a null kind", () => {
    expect(matchesFilter(aapl, { kind: "trade" })).toBe(true);
    expect(matchesFilter(aapl, { kind: "dividend" })).toBe(false);
    expect(matchesFilter(aapl, { kind: null })).toBe(true);
  });

  it("bounds by whole days, inclusive on both ends", () => {
    expect(matchesFilter(aapl, { from: "2026-02-10", to: "2026-02-10" })).toBe(true);
    expect(matchesFilter(aapl, { from: "2026-02-11" })).toBe(false);
    expect(matchesFilter(aapl, { to: "2026-02-09" })).toBe(false);
  });
});

describe("filterTransactions", () => {
  it("keeps only the matching rows", () => {
    const rows = [tx({ symbol: "AAPL" }), tx({ symbol: "MSFT", externalId: "2" })];
    expect(filterTransactions(rows, { symbol: "MS" }).map((t) => t.symbol)).toEqual(["MSFT"]);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

```bash
pnpm --filter @ib/ledger test
```

- [ ] **Étape 3 : implémentation**

`packages/ledger/src/filter.ts` :

```ts
import type { Transaction, TransactionKind } from "./types.ts";

/** UTC calendar day of an ISO 8601 UTC timestamp. */
export function dayOf(when: string): string {
  return when.slice(0, 10);
}

export interface TransactionFilter {
  /** Case-insensitive substring of the symbol. */
  symbol?: string;
  /** Exact kind; `null` or `undefined` means every kind. */
  kind?: TransactionKind | null;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  /** YYYY-MM-DD, inclusive. */
  to?: string;
}

export function matchesFilter(tx: Transaction, filter: TransactionFilter): boolean {
  if (filter.symbol && !tx.symbol.toLowerCase().includes(filter.symbol.toLowerCase())) {
    return false;
  }
  if (filter.kind && tx.kind !== filter.kind) return false;
  const day = dayOf(tx.when);
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  return true;
}

export function filterTransactions(
  transactions: readonly Transaction[],
  filter: TransactionFilter,
): Transaction[] {
  return transactions.filter((tx) => matchesFilter(tx, filter));
}
```

Ajouter `export * from "./filter.ts";` à `index.ts`.

- [ ] **Étape 4 : vérifier et committer**

```bash
pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck
git add packages/ledger
git commit -m "feat(ledger): filtres symbole, type et plage de jours

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 4 : `planImport`, propriété de plage

**Files:**
- Create: `packages/ledger/src/import.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/src/import.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `TRANSACTION_KINDS`, `dayOf`.
- Produces: `ImportBatch { source, transactions, period: { start, end } | null }`, `DroppedCount { kind, count }`, `ImportPlan { delete: string[], upsert: Transaction[], dropped: DroppedCount[], skipped: number }`, `planImport(existing, batch): ImportPlan`, `UnsupportedSourceError`.

- [ ] **Étape 1 : tests**

`packages/ledger/src/import.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { planImport, UnsupportedSourceError } from "./import.ts";
import { tx } from "./fixtures.ts";
import type { Transaction } from "./types.ts";

const flex = (id: string, when: string, extra: Partial<Transaction> = {}) =>
  tx({ source: "flex", externalId: `flex:trade:${id}`, when, ...extra });
const html = (id: string, when: string, extra: Partial<Transaction> = {}) =>
  tx({ source: "statement_html", externalId: `html:${id}`, when, ...extra });

describe("planImport from Flex", () => {
  const incoming = [flex("1", "2026-01-10T10:00:00.000Z"), flex("2", "2026-03-05T15:00:00.000Z")];

  it("upserts every incoming row", () => {
    const plan = planImport([], { source: "flex", transactions: incoming, period: null });
    expect(plan.upsert).toEqual(incoming);
    expect(plan.delete).toEqual([]);
    expect(plan.skipped).toBe(0);
  });

  it("deletes rows of other sources inside its real range, bounds included", () => {
    const existing = [
      html("before", "2026-01-09T00:00:00.000Z"),
      html("at-min", "2026-01-10T10:00:00.000Z"),
      html("inside", "2026-02-01T00:00:00.000Z"),
      html("at-max", "2026-03-05T15:00:00.000Z"),
      html("after", "2026-03-05T15:00:01.000Z"),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["html:at-min", "html:inside", "html:at-max"]);
  });

  it("never deletes its own older rows: a row out of the 365-day window is kept for good", () => {
    const old = flex("old", "2024-06-01T00:00:00.000Z");
    const plan = planImport([old], { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual([]);
    expect(plan.upsert).not.toContain(old);
  });

  it("counts what it dropped by kind, so the app can warn about unchecked sections", () => {
    const existing = [
      html("d1", "2026-02-01T00:00:00.000Z", { kind: "transfer" }),
      html("d2", "2026-02-02T00:00:00.000Z", { kind: "transfer" }),
      html("t1", "2026-02-03T00:00:00.000Z", { kind: "trade" }),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.dropped).toEqual([
      { kind: "trade", count: 1 },
      { kind: "transfer", count: 2 },
    ]);
  });

  it("deletes nothing on an empty batch: a query that stops reporting must not wipe the ledger", () => {
    const plan = planImport([html("x", "2026-02-01T00:00:00.000Z")], {
      source: "flex",
      transactions: [],
      period: null,
    });
    expect(plan).toEqual({ delete: [], upsert: [], dropped: [], skipped: 0 });
  });
});

describe("planImport from an HTML statement", () => {
  const period = { start: "2025-01-01", end: "2025-12-31" };

  it("takes everything when Flex owns nothing yet", () => {
    const incoming = [html("a", "2025-03-01T00:00:00.000Z"), html("b", "2025-12-31T00:00:00.000Z")];
    const plan = planImport([], { source: "statement_html", transactions: incoming, period });
    expect(plan.upsert).toEqual(incoming);
    expect(plan.skipped).toBe(0);
  });

  it("writes only before the first Flex day, whole days: Flex covered that day entirely", () => {
    const existing = [flex("f", "2025-09-03T14:30:00.000Z")];
    const incoming = [
      html("kept", "2025-09-02T23:59:59.000Z"),
      html("same-day-earlier", "2025-09-03T09:15:00.000Z"),
      html("later", "2025-10-01T00:00:00.000Z"),
    ];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.upsert.map((t) => t.externalId)).toEqual(["html:kept"]);
    expect(plan.skipped).toBe(2);
  });

  it("uses the oldest Flex row as the cutoff, not the newest", () => {
    const existing = [flex("new", "2026-01-01T00:00:00.000Z"), flex("old", "2025-06-01T00:00:00.000Z")];
    const incoming = [html("x", "2025-07-01T00:00:00.000Z")];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.upsert).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it("replaces its own rows over its declared period, so a re-import is idempotent", () => {
    const existing = [
      html("stale", "2025-05-05T00:00:00.000Z"),
      html("outside", "2024-12-31T00:00:00.000Z"),
      html("same", "2025-06-06T00:00:00.000Z"),
    ];
    const incoming = [html("same", "2025-06-06T00:00:00.000Z"), html("fresh", "2025-07-07T00:00:00.000Z")];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.delete).toEqual(["html:stale"]);
    expect(plan.upsert.map((t) => t.externalId)).toEqual(["html:same", "html:fresh"]);
  });

  it("leaves Flex rows inside the period alone", () => {
    const existing = [flex("f", "2025-06-01T00:00:00.000Z")];
    const incoming = [html("x", "2025-03-01T00:00:00.000Z")];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.delete).toEqual([]);
  });

  it("refuses a statement batch without its period", () => {
    expect(() =>
      planImport([], { source: "statement_html", transactions: [], period: null }),
    ).toThrow(/period/);
  });
});

describe("planImport from the agent", () => {
  it("is not supported before sub-project 4 and says so", () => {
    expect(() => planImport([], { source: "agent", transactions: [], period: null })).toThrow(
      UnsupportedSourceError,
    );
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

```bash
pnpm --filter @ib/ledger test
```

- [ ] **Étape 3 : implémentation**

`packages/ledger/src/import.ts` :

```ts
import { dayOf } from "./filter.ts";
import { TRANSACTION_KINDS, type Transaction, type TransactionKind, type TransactionSource } from "./types.ts";

export interface ImportBatch {
  source: TransactionSource;
  transactions: Transaction[];
  /** Period the file declares (Flex from/to, statement header), YYYY-MM-DD inclusive. */
  period: { start: string; end: string } | null;
}

export interface DroppedCount {
  kind: TransactionKind;
  count: number;
}

export interface ImportPlan {
  /** externalIds to remove before writing. */
  delete: string[];
  upsert: Transaction[];
  /** Rows of *other* sources retired by Flex to own its range, by kind. */
  dropped: DroppedCount[];
  /** Rows of the batch left out because another source owns their day. */
  skipped: number;
}

export class UnsupportedSourceError extends Error {
  constructor(source: string) {
    super(`Import from source "${source}" is not supported yet`);
    this.name = "UnsupportedSourceError";
  }
}

/**
 * Range ownership. Sources cannot recognise each other's rows (IB ids, hashes,
 * execIds) and twin rows on one day are legitimate, so nothing is ever
 * compared by content: a source owns a range of time and writes all of it.
 */
export function planImport(existing: readonly Transaction[], batch: ImportBatch): ImportPlan {
  switch (batch.source) {
    case "flex":
      return planFlex(existing, batch.transactions);
    case "statement_html":
      return planStatement(existing, batch.transactions, batch.period);
    default:
      throw new UnsupportedSourceError(batch.source);
  }
}

function countByKind(transactions: readonly Transaction[]): DroppedCount[] {
  const counts = new Map<TransactionKind, number>();
  for (const tx of transactions) counts.set(tx.kind, (counts.get(tx.kind) ?? 0) + 1);
  return TRANSACTION_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind)!,
  }));
}

/**
 * Flex owns the real range of what it reports, read from the data and never
 * from a configuration. Its own rows are upserted and kept forever: a row
 * that slid out of the 365-day window is history Flex once vouched for.
 */
function planFlex(existing: readonly Transaction[], incoming: Transaction[]): ImportPlan {
  if (incoming.length === 0) return { delete: [], upsert: [], dropped: [], skipped: 0 };
  let min = incoming[0].when;
  let max = incoming[0].when;
  for (const tx of incoming) {
    if (tx.when < min) min = tx.when;
    if (tx.when > max) max = tx.when;
  }
  const doomed = existing.filter(
    (tx) => tx.source !== "flex" && tx.when >= min && tx.when <= max,
  );
  return {
    delete: doomed.map((tx) => tx.externalId),
    upsert: incoming,
    dropped: countByKind(doomed),
    skipped: 0,
  };
}

/**
 * A statement backfills the deep history *before* Flex: whole days, because
 * if Flex's oldest row is at 14:30 its query covered that day entirely. Over
 * its own declared period it replaces the statement rows already there, so
 * importing the same or an overlapping statement twice never duplicates.
 */
function planStatement(
  existing: readonly Transaction[],
  incoming: Transaction[],
  period: ImportBatch["period"],
): ImportPlan {
  if (period === null) throw new Error("A statement batch needs its declared period");

  let cutoffDay: string | null = null;
  for (const tx of existing) {
    if (tx.source !== "flex") continue;
    const day = dayOf(tx.when);
    if (cutoffDay === null || day < cutoffDay) cutoffDay = day;
  }

  const kept = cutoffDay === null ? incoming : incoming.filter((tx) => dayOf(tx.when) < cutoffDay);
  const keptIds = new Set(kept.map((tx) => tx.externalId));
  const replaced = existing.filter((tx) => {
    if (tx.source !== "statement_html" || keptIds.has(tx.externalId)) return false;
    const day = dayOf(tx.when);
    return day >= period.start && day <= period.end;
  });

  return {
    delete: replaced.map((tx) => tx.externalId),
    upsert: kept,
    dropped: [],
    skipped: incoming.length - kept.length,
  };
}
```

Ajouter `export * from "./import.ts";` à `index.ts`.

- [ ] **Étape 4 : vérifier et committer**

```bash
pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck && pnpm lint
git add packages/ledger
git commit -m "feat(ledger): planificateur d'import par propriété de plage

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---
## Tâche 5 : paquet `ib-parsers`, types d'issues et helpers communs

**Files:**
- Create: `packages/ib-parsers/package.json`, `packages/ib-parsers/tsconfig.json`, `packages/ib-parsers/vitest.config.ts`
- Create: `packages/ib-parsers/src/index.ts`, `packages/ib-parsers/src/issues.ts`, `packages/ib-parsers/src/common.ts`
- Test: `packages/ib-parsers/src/common.test.ts`

**Interfaces:**
- Consumes: `Transaction` de `@ib/ledger`.
- Produces: `ParseIssue`, `ParseIssueCode`, `ParseTarget { accountId, ibAccountId }`, `ParseResult<S> { transactions, statement: S | null, issues }`, `hasErrors(issues)`, `NormalizationError`, `parseNumber(text, what)`, `parseFlexDateTime(text, what)`, `flexDateToIsoDay(text)`, `parseStatementDateTime(text, what)`, `splitOptionSymbol(text)`, `symbolFromDescription(description)`, `attr(el, name)`.

- [ ] **Étape 1 : paquet**

`packages/ib-parsers/package.json` :

```json
{
  "name": "@ib/ib-parsers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@ib/ledger": "workspace:*",
    "@noble/hashes": "^2.4.0"
  },
  "devDependencies": {
    "jsdom": "^30.0.1",
    "typescript": "~6.0.3",
    "vitest": "^4.1.11"
  }
}
```

`packages/ib-parsers/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": [] },
  "include": ["src"]
}
```

`packages/ib-parsers/vitest.config.ts` :

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom" },
});
```

`packages/ib-parsers/src/issues.ts` :

```ts
import type { Transaction } from "@ib/ledger";

export type ParseIssueCode =
  | "account-mismatch"
  | "section-missing"
  | "section-unread"
  | "column-missing"
  | "unknown-cash-type"
  | "unknown-asset-category"
  | "row-skipped"
  | "normalization";

export interface ParseIssue {
  /** An error empties the result: nothing of the file may be written. */
  severity: "error" | "warning";
  code: ParseIssueCode;
  /** Technical detail, IB's own section and column names, shown as is. */
  detail: string;
}

export interface ParseTarget {
  /** Slug of the account the rows are written to. */
  accountId: string;
  /** IB account id the file must belong to, e.g. "U1234567". */
  ibAccountId: string;
}

export interface ParseResult<S> {
  transactions: Transaction[];
  /** What the file says about itself; `null` when it is not even the right kind of file. */
  statement: S | null;
  issues: ParseIssue[];
}

export function hasErrors(issues: readonly ParseIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function warning(code: ParseIssueCode, detail: string): ParseIssue {
  return { severity: "warning", code, detail };
}

export function error(code: ParseIssueCode, detail: string): ParseIssue {
  return { severity: "error", code, detail };
}
```

`packages/ib-parsers/src/common.ts` :

```ts
/** Raised on a value the parser cannot read; the whole import is cancelled. */
export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

/** Attribute value, or `null` when the attribute is absent (an empty attribute is ""). */
export function attr(el: Element, name: string): string | null {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}

/**
 * IB numbers: "1,200.00", "-1.94", "&nbsp;" for a blank cell. A blank is
 * unknown, never zero.
 */
export function parseNumber(text: string | null | undefined, what: string): number | null {
  if (text === null || text === undefined) return null;
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new NormalizationError(`Unreadable number "${text}" for ${what}`);
  return value;
}

function toIso(what: string, y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): string {
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new NormalizationError(`Unreadable date for ${what}`);
  }
  return date.toISOString();
}

// Timestamps are stamped as UTC without conversion: neither file carries a
// timezone, and both must be configured on the same one in IB's Client
// Portal for `when` values to be comparable across sources.

/** Flex "20260814;162000" or "20260814" (midnight). */
export function parseFlexDateTime(text: string | null | undefined, what: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:;(\d{2})(\d{2})(\d{2}))?$/.exec(text ?? "");
  if (!match) throw new NormalizationError(`Unreadable Flex date "${text}" for ${what}`);
  const [, y, m, d, hh, mm, ss] = match;
  return toIso(what, +y, +m, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
}

/** Flex "20260220" -> "2026-02-20"; blank -> null. */
export function flexDateToIsoDay(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) throw new NormalizationError(`Unreadable Flex day "${text}"`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Statement "2025-01-02, 09:30:00" or "2025-01-02" (midnight). */
export function parseStatementDateTime(text: string | null | undefined, what: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:,\s*(\d{2}):(\d{2}):(\d{2}))?$/.exec((text ?? "").trim());
  if (!match) throw new NormalizationError(`Unreadable statement date "${text}" for ${what}`);
  const [, y, m, d, hh, mm, ss] = match;
  return toIso(what, +y, +m, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const OPTION_SYMBOL_RE =
  /^(?<symbol>\S+)\s+(?<day>\d{2})(?<month>[A-Z]{3})(?<year>\d{2})\s+(?<strike>[\d.]+)\s+(?<right>[CP])$/;

export interface OptionParts {
  symbol: string;
  expiry: string | null;
  strike: number | null;
  right: "C" | "P" | "";
}

/** "AANZ 26SEP25 24 P" -> { AANZ, 2025-09-26, 24, P }; a plain stock passes through. */
export function splitOptionSymbol(text: string): OptionParts {
  const match = OPTION_SYMBOL_RE.exec(text.trim());
  if (!match?.groups) return { symbol: text.trim(), expiry: null, strike: null, right: "" };
  const { symbol, day, month, year, strike, right } = match.groups;
  const monthNumber = MONTHS[month];
  if (!monthNumber) return { symbol: text.trim(), expiry: null, strike: null, right: "" };
  const expiry = `20${year}-${String(monthNumber).padStart(2, "0")}-${day}`;
  return { symbol, expiry, strike: Number(strike), right: right as "C" | "P" };
}

/** "TESTX(US0000000000) Cash Dividend…" -> "TESTX"; "" when there is no leading ticker. */
export function symbolFromDescription(description: string): string {
  const match = /^([A-Za-z0-9.]+)\s*\(/.exec(description);
  return match ? match[1] : "";
}
```

`packages/ib-parsers/src/index.ts` :

```ts
export * from "./issues.ts";
export { NormalizationError, splitOptionSymbol } from "./common.ts";
```

- [ ] **Étape 2 : tests**

`packages/ib-parsers/src/common.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import {
  NormalizationError,
  flexDateToIsoDay,
  parseFlexDateTime,
  parseNumber,
  parseStatementDateTime,
  splitOptionSymbol,
  symbolFromDescription,
} from "./common.ts";

describe("parseNumber", () => {
  it("reads IB's thousands separators and signs", () => {
    expect(parseNumber("-1,732.00", "proceeds")).toBe(-1732);
  });

  it("returns null, never zero, for a blank or non-breaking-space cell", () => {
    expect(parseNumber(" ", "price")).toBeNull();
    expect(parseNumber("", "price")).toBeNull();
    expect(parseNumber(null, "price")).toBeNull();
  });

  it("refuses garbage", () => {
    expect(() => parseNumber("abc", "price")).toThrow(NormalizationError);
  });
});

describe("Flex dates", () => {
  it("reads a timestamp and a bare day", () => {
    expect(parseFlexDateTime("20260814;162000", "trade")).toBe("2026-08-14T16:20:00.000Z");
    expect(parseFlexDateTime("20251217", "cash")).toBe("2025-12-17T00:00:00.000Z");
  });

  it("converts an expiry to YYYY-MM-DD and keeps a blank one null", () => {
    expect(flexDateToIsoDay("20260220")).toBe("2026-02-20");
    expect(flexDateToIsoDay("")).toBeNull();
  });

  it("refuses an impossible date", () => {
    expect(() => parseFlexDateTime("20261340", "trade")).toThrow(NormalizationError);
  });
});

describe("Statement dates", () => {
  it("reads a timestamp and a bare day", () => {
    expect(parseStatementDateTime("2025-01-02, 09:30:00", "trade")).toBe("2025-01-02T09:30:00.000Z");
    expect(parseStatementDateTime("2025-03-15", "dividend")).toBe("2025-03-15T00:00:00.000Z");
  });
});

describe("splitOptionSymbol", () => {
  it("splits an option contract", () => {
    expect(splitOptionSymbol("ZQX 15AUG25 500 P")).toEqual({
      symbol: "ZQX",
      expiry: "2025-08-15",
      strike: 500,
      right: "P",
    });
  });

  it("passes a stock symbol through", () => {
    expect(splitOptionSymbol("TESTX")).toEqual({ symbol: "TESTX", expiry: null, strike: null, right: "" });
  });
});

describe("symbolFromDescription", () => {
  it("pulls the leading ticker", () => {
    expect(symbolFromDescription("TESTX(US0000000000) Cash Dividend USD 0.10 per Share")).toBe("TESTX");
  });

  it("is empty for a plain cash description", () => {
    expect(symbolFromDescription("Electronic Fund Transfer")).toBe("");
  });
});
```

- [ ] **Étape 3 : installer, vérifier, committer**

```bash
pnpm install
pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ib-parsers typecheck && pnpm lint
git add pnpm-lock.yaml packages/ib-parsers
git commit -m "feat(ib-parsers): paquet, types d'issues et helpers de normalisation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 6 : parseur Flex XML

**Files:**
- Create: `packages/ib-parsers/src/flex.ts`
- Modify: `packages/ib-parsers/src/index.ts`
- Test: `packages/ib-parsers/src/flex.test.ts`

**Interfaces:**
- Consumes: helpers de la tâche 5.
- Produces: `FlexStatementInfo { ibAccountId, fromDate, toDate, whenGenerated }`, `FlexParseResult = ParseResult<FlexStatementInfo>`, `parseFlexXml(xml: string, target: ParseTarget): FlexParseResult`.

- [ ] **Étape 1 : tests sur des XML écrits à la main**

`packages/ib-parsers/src/flex.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseFlexXml } from "./flex.ts";

const TARGET = { accountId: "test", ibAccountId: "U0000001" };

function flex(body: string, accountId = "U0000001"): string {
  return `<FlexQueryResponse queryName="global_export" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="${accountId}" fromDate="20250903" toDate="20260902" period="Last365CalendarDays" whenGenerated="20260903;010001">
${body}
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;
}

const STOCK_TRADE =
  '<Trade accountId="U0000001" currency="USD" assetCategory="STK" subCategory="COMMON" symbol="SYMA" description="SYMA HOLDINGS INC" tradeID="9000000001" dateTime="20260210;153000" putCall="" tradeDate="20260210" fifoPnlRealized="0" buySell="BUY" transactionType="BookTrade" quantity="150" transactionID="9500000001" multiplier="1" strike="" expiry="" ibCommission="0" ibCommissionCurrency="USD" netCash="-600" cost="600" tradePrice="4" proceeds="-600" />';
const OPTION_TRADE =
  '<Trade accountId="U0000001" currency="USD" assetCategory="OPT" subCategory="P" symbol="SYMB  260320P00020000" description="SYMB 20MAR26 20 P" tradeID="9000000002" dateTime="20260305;104500" putCall="P" tradeDate="20260305" buySell="SELL" transactionType="ExchTrade" quantity="-1" transactionID="9500000002" multiplier="100" strike="20" expiry="20260320" ibCommission="-0.65" ibCommissionCurrency="USD" netCash="249.35" cost="-249.35" tradePrice="2.5" proceeds="250" />';
const FOREX_TRADE =
  '<Trade accountId="U0000001" currency="USD" assetCategory="CASH" symbol="EUR.USD" description="EUR.USD" tradeID="9000000003" dateTime="20260115;110000" putCall="" buySell="SELL" quantity="-1000" transactionID="9500000003" multiplier="1" strike="" expiry="" ibCommission="-2" ibCommissionCurrency="EUR" tradePrice="1.1" proceeds="1100" />';
const DEPOSIT =
  '<CashTransaction accountId="U0000001" symbol="" description="CASH RECEIPTS / ELECTRONIC FUND TRANSFERS" dateTime="20260105" amount="2500" type="Deposits/Withdrawals" transactionID="9500000004" currency="EUR" assetCategory="" reportDate="20260106" />';
const TAX =
  '<CashTransaction accountId="U0000001" symbol="" description="WITHHOLDING @ 20% ON CREDIT INT FOR JAN-2026" dateTime="20260203" amount="-0.25" type="Withholding Tax" transactionID="9500000005" currency="USD" />';
const CORPORATE_ACTION =
  '<CorporateAction accountId="U0000001" symbol="TESTX" description="TESTX(US0000000000) SPLIT 2 FOR 1" assetCategory="STK" dateTime="20260530;200000" quantity="100" proceeds="0" transactionID="7000000001" currency="USD" />';

describe("parseFlexXml", () => {
  it("reads the statement header", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/>`), TARGET);
    expect(result.statement).toEqual({
      ibAccountId: "U0000001",
      fromDate: "2025-09-03",
      toDate: "2026-09-02",
      whenGenerated: "2026-09-03T01:00:01.000Z",
    });
  });

  it("normalizes a stock trade", () => {
    const [trade] = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/>`), TARGET).transactions;
    expect(trade).toEqual({
      accountId: "test",
      externalId: "flex:trade:9000000001",
      source: "flex",
      kind: "trade",
      symbol: "SYMA",
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      quantity: 150,
      price: 4,
      amount: -600,
      commission: 0,
      currency: "USD",
      when: "2026-02-10T15:30:00.000Z",
      description: "SYMA HOLDINGS INC",
    });
  });

  it("normalizes an option trade with its contract", () => {
    const [trade] = parseFlexXml(flex(`<Trades>${OPTION_TRADE}</Trades><CashTransactions/>`), TARGET).transactions;
    expect(trade).toMatchObject({
      symbol: "SYMB  260320P00020000",
      secType: "OPT",
      right: "P",
      strike: 20,
      expiry: "2026-03-20",
      quantity: -1,
      price: 2.5,
      amount: 250,
      commission: -0.65,
    });
  });

  it("keeps a currency conversion as a trade on the pair, quote currency on the row", () => {
    const [trade] = parseFlexXml(flex(`<Trades>${FOREX_TRADE}</Trades><CashTransactions/>`), TARGET).transactions;
    expect(trade).toMatchObject({ symbol: "EUR.USD", secType: "CASH", quantity: -1000, amount: 1100, commission: -2, currency: "USD" });
  });

  it("maps cash transactions by their type label, with a bare day stamped at midnight", () => {
    const { transactions } = parseFlexXml(flex(`<Trades/><CashTransactions>${DEPOSIT}${TAX}</CashTransactions>`), TARGET);
    expect(transactions).toEqual([
      expect.objectContaining({
        externalId: "flex:cash:9500000004",
        kind: "transfer",
        amount: 2500,
        currency: "EUR",
        when: "2026-01-05T00:00:00.000Z",
        description: "CASH RECEIPTS / ELECTRONIC FUND TRANSFERS",
        quantity: null,
        price: null,
        commission: null,
      }),
      expect.objectContaining({ externalId: "flex:cash:9500000005", kind: "tax", amount: -0.25 }),
    ]);
  });

  it("classes an unknown cash type as a fee and says so, instead of silently", () => {
    const odd = TAX.replace('type="Withholding Tax"', 'type="Something New"');
    const result = parseFlexXml(flex(`<Trades/><CashTransactions>${odd}</CashTransactions>`), TARGET);
    expect(result.transactions[0].kind).toBe("fee");
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "unknown-cash-type",
      detail: 'Cash transaction type "Something New" classed as fee',
    });
  });

  it("normalizes a corporate action", () => {
    const [action] = parseFlexXml(
      flex(`<Trades/><CashTransactions/><CorporateActions>${CORPORATE_ACTION}</CorporateActions>`),
      TARGET,
    ).transactions;
    expect(action).toMatchObject({
      externalId: "flex:ca:7000000001",
      kind: "corporate_action",
      symbol: "TESTX",
      quantity: 100,
      amount: 0,
      when: "2026-05-30T20:00:00.000Z",
    });
  });

  it("refuses a file of another account and returns no rows", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades>`, "U9999999"), TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toEqual([
      { severity: "error", code: "account-mismatch", detail: "File belongs to account U9999999, expected U0000001" },
    ]);
    expect(result.statement?.ibAccountId).toBe("U9999999");
  });

  it("reports missing sections as warnings and still returns the rows it has", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades>`), TARGET);
    expect(result.transactions).toHaveLength(1);
    expect(result.issues).toEqual([
      { severity: "warning", code: "section-missing", detail: "Cash Transactions" },
      { severity: "warning", code: "section-missing", detail: "Open Positions" },
    ]);
  });

  it("reports a money column missing from the query definition: absent on every row", () => {
    const bare = STOCK_TRADE.replace(' tradePrice="4"', "").replace(' proceeds="-600"', "");
    const result = parseFlexXml(flex(`<Trades>${bare}${bare.replace("9000000001", "2")}</Trades><CashTransactions/><OpenPositions/>`), TARGET);
    expect(result.transactions[0].price).toBeNull();
    expect(result.issues).toEqual([
      { severity: "warning", code: "column-missing", detail: "Trades: tradePrice" },
      { severity: "warning", code: "column-missing", detail: "Trades: proceeds" },
    ]);
  });

  it("does not flag option columns on a stock-only batch", () => {
    const noOptionCols = STOCK_TRADE.replace(' strike=""', "").replace(' expiry=""', "").replace(' putCall=""', "");
    const result = parseFlexXml(flex(`<Trades>${noOptionCols}</Trades><CashTransactions/><OpenPositions/>`), TARGET);
    expect(result.issues).toEqual([]);
  });

  it("flags option columns missing on every option row", () => {
    const noStrike = OPTION_TRADE.replace(' strike="20"', "");
    const result = parseFlexXml(flex(`<Trades>${noStrike}</Trades><CashTransactions/><OpenPositions/>`), TARGET);
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "Trades: strike" }]);
  });

  it("warns that a Transfers section is present but not read", () => {
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/><Transfers><Transfer transactionID="1"/></Transfers>`), TARGET);
    expect(result.issues).toEqual([{ severity: "warning", code: "section-unread", detail: "Transfers" }]);
  });

  it("cancels everything on an unreadable value", () => {
    const broken = STOCK_TRADE.replace('tradePrice="4"', 'tradePrice="six"');
    const result = parseFlexXml(flex(`<Trades>${broken}</Trades><CashTransactions/>`), TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "normalization" }));
  });

  it("cancels everything on a trade without any id", () => {
    const noId = STOCK_TRADE.replace(' tradeID="9000000001"', "").replace(' transactionID="9500000001"', "");
    const result = parseFlexXml(flex(`<Trades>${noId}</Trades><CashTransactions/>`), TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });

  it("rejects something that is not a Flex response", () => {
    const result = parseFlexXml("<html><body>nope</body></html>", TARGET);
    expect(result.statement).toBeNull();
    expect(result.issues).toEqual([
      { severity: "error", code: "normalization", detail: "Not a Flex query response" },
    ]);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

```bash
pnpm --filter @ib/ib-parsers test
```

- [ ] **Étape 3 : implémentation**

`packages/ib-parsers/src/flex.ts` :

```ts
import type { Transaction, TransactionKind } from "@ib/ledger";
import {
  NormalizationError,
  attr,
  flexDateToIsoDay,
  parseFlexDateTime,
  parseNumber,
} from "./common.ts";
import { error, warning, type ParseIssue, type ParseResult, type ParseTarget } from "./issues.ts";

export interface FlexStatementInfo {
  ibAccountId: string;
  /** YYYY-MM-DD */
  fromDate: string;
  toDate: string;
  /** ISO 8601 */
  whenGenerated: string;
}

export type FlexParseResult = ParseResult<FlexStatementInfo>;

/** Flex reports the cash transaction type as a label, not a code. */
const CASH_TYPE_KIND: Record<string, TransactionKind> = {
  Dividends: "dividend",
  "Payment In Lieu Of Dividends": "dividend",
  "Withholding Tax": "tax",
  "Broker Interest Paid": "interest",
  "Broker Interest Received": "interest",
  "Bond Interest Paid": "interest",
  "Bond Interest Received": "interest",
  "Other Fees": "fee",
  "Advisor Fees": "fee",
  "Commission Adjustments": "fee",
  "Deposits/Withdrawals": "transfer",
};

// Left out of the query *definition*, a column is absent on every row;
// merely empty, it is absent on some rows only. The all-rows test is what
// makes the signal reliable.
const MONEY_TRADE_COLUMNS = ["tradePrice", "proceeds", "ibCommission"] as const;
const OPTION_TRADE_COLUMNS = ["strike", "expiry", "putCall"] as const;

function children(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((el) => el.tagName === tagName);
}

function section(statement: Element, tagName: string): Element | null {
  return children(statement, tagName)[0] ?? null;
}

export function parseFlexXml(xml: string, target: ParseTarget): FlexParseResult {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const statementEl = doc.documentElement?.tagName === "FlexQueryResponse"
    ? doc.querySelector("FlexStatements > FlexStatement")
    : null;
  if (!statementEl) {
    return { transactions: [], statement: null, issues: [error("normalization", "Not a Flex query response")] };
  }

  const issues: ParseIssue[] = [];
  let statement: FlexStatementInfo;
  try {
    statement = {
      ibAccountId: attr(statementEl, "accountId") ?? "",
      fromDate: flexDateToIsoDay(attr(statementEl, "fromDate")) ?? "",
      toDate: flexDateToIsoDay(attr(statementEl, "toDate")) ?? "",
      whenGenerated: parseFlexDateTime(attr(statementEl, "whenGenerated"), "whenGenerated"),
    };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement: null, issues: [error("normalization", e.message)] };
    }
    throw e;
  }

  if (statement.ibAccountId !== target.ibAccountId) {
    issues.push(
      error("account-mismatch", `File belongs to account ${statement.ibAccountId}, expected ${target.ibAccountId}`),
    );
    return { transactions: [], statement, issues };
  }

  try {
    const transactions = [
      ...parseTrades(statementEl, target, issues),
      ...parseCashTransactions(statementEl, target, issues),
      ...parseCorporateActions(statementEl, target),
    ];
    checkSections(statementEl, issues);
    return { transactions, statement, issues };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement, issues: [...issues, error("normalization", e.message)] };
    }
    throw e;
  }
}

function parseTrades(statementEl: Element, target: ParseTarget, issues: ParseIssue[]): Transaction[] {
  const trades = section(statementEl, "Trades");
  if (!trades) return [];
  const rows = children(trades, "Trade");
  const transactions = rows.map((el) => {
    const tradeId = attr(el, "tradeID") || attr(el, "transactionID");
    if (!tradeId) {
      throw new NormalizationError(`Trade without tradeID nor transactionID (${attr(el, "symbol") ?? "?"})`);
    }
    const putCall = attr(el, "putCall");
    const right = putCall === "C" || putCall === "P" ? putCall : "";
    const what = `trade ${tradeId}`;
    return {
      accountId: target.accountId,
      externalId: `flex:trade:${tradeId}`,
      source: "flex",
      kind: "trade",
      symbol: attr(el, "symbol") ?? "",
      secType: attr(el, "assetCategory") ?? "",
      right,
      strike: parseNumber(attr(el, "strike"), `${what} strike`),
      expiry: flexDateToIsoDay(attr(el, "expiry")),
      quantity: parseNumber(attr(el, "quantity"), `${what} quantity`),
      price: parseNumber(attr(el, "tradePrice"), `${what} tradePrice`),
      amount: parseNumber(attr(el, "proceeds"), `${what} proceeds`),
      commission: parseNumber(attr(el, "ibCommission"), `${what} ibCommission`),
      currency: attr(el, "currency") ?? "",
      when: parseFlexDateTime(attr(el, "dateTime") || attr(el, "tradeDate"), what),
      description: attr(el, "description") ?? "",
    } satisfies Transaction;
  });

  reportMissingColumns("Trades", rows, MONEY_TRADE_COLUMNS, issues);
  reportMissingColumns(
    "Trades",
    rows.filter((el) => attr(el, "assetCategory") === "OPT"),
    OPTION_TRADE_COLUMNS,
    issues,
  );
  return transactions;
}

function reportMissingColumns(
  sectionName: string,
  rows: Element[],
  columns: readonly string[],
  issues: ParseIssue[],
): void {
  if (rows.length === 0) return;
  for (const column of columns) {
    if (rows.every((el) => !el.hasAttribute(column))) {
      issues.push(warning("column-missing", `${sectionName}: ${column}`));
    }
  }
}

function parseCashTransactions(statementEl: Element, target: ParseTarget, issues: ParseIssue[]): Transaction[] {
  const cash = section(statementEl, "CashTransactions");
  if (!cash) return [];
  const unknownTypes = new Set<string>();
  return children(cash, "CashTransaction").map((el) => {
    const id = attr(el, "transactionID");
    if (!id) throw new NormalizationError(`Cash transaction without transactionID (${attr(el, "description") ?? "?"})`);
    const type = attr(el, "type") ?? "";
    let kind = CASH_TYPE_KIND[type];
    if (!kind) {
      kind = "fee";
      if (!unknownTypes.has(type)) {
        unknownTypes.add(type);
        issues.push(warning("unknown-cash-type", `Cash transaction type "${type}" classed as fee`));
      }
    }
    const what = `cash transaction ${id}`;
    return {
      accountId: target.accountId,
      externalId: `flex:cash:${id}`,
      source: "flex",
      kind,
      symbol: attr(el, "symbol") ?? "",
      secType: attr(el, "assetCategory") ?? "",
      right: "",
      strike: null,
      expiry: null,
      quantity: null,
      price: null,
      amount: parseNumber(attr(el, "amount"), `${what} amount`),
      commission: null,
      currency: attr(el, "currency") ?? "",
      when: parseFlexDateTime(attr(el, "dateTime") || attr(el, "reportDate") || attr(el, "settleDate"), what),
      description: attr(el, "description") ?? "",
    } satisfies Transaction;
  });
}

function parseCorporateActions(statementEl: Element, target: ParseTarget): Transaction[] {
  const actions = section(statementEl, "CorporateActions");
  if (!actions) return [];
  return children(actions, "CorporateAction").map((el) => {
    const id = attr(el, "transactionID");
    if (!id) throw new NormalizationError(`Corporate action without transactionID (${attr(el, "description") ?? "?"})`);
    const what = `corporate action ${id}`;
    return {
      accountId: target.accountId,
      externalId: `flex:ca:${id}`,
      source: "flex",
      kind: "corporate_action",
      symbol: attr(el, "symbol") ?? "",
      secType: attr(el, "assetCategory") ?? "",
      right: "",
      strike: null,
      expiry: null,
      quantity: parseNumber(attr(el, "quantity"), `${what} quantity`),
      price: null,
      amount: parseNumber(attr(el, "proceeds"), `${what} proceeds`),
      commission: null,
      currency: attr(el, "currency") ?? "",
      when: parseFlexDateTime(attr(el, "dateTime") || attr(el, "reportDate"), what),
      description: attr(el, "description") ?? "",
    } satisfies Transaction;
  });
}

/** Sections the history needs, and the ones the next sub-projects will. */
function checkSections(statementEl: Element, issues: ParseIssue[]): void {
  const required: Array<[tag: string, label: string]> = [
    ["Trades", "Trades"],
    ["CashTransactions", "Cash Transactions"],
    ["OpenPositions", "Open Positions"],
  ];
  for (const [tag, label] of required) {
    if (!section(statementEl, tag)) issues.push(warning("section-missing", label));
  }
  if (section(statementEl, "Transfers")) issues.push(warning("section-unread", "Transfers"));
}
```

Ajouter à `index.ts` : `export * from "./flex.ts";`

Note : les tests « column-missing » construisent une section `OpenPositions` vide pour ne pas polluer la liste d'issues ; l'ordre des issues est « colonnes puis sections », c'est celui du code.

- [ ] **Étape 4 : vérifier et committer**

```bash
pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ib-parsers typecheck && pnpm lint
git add packages/ib-parsers
git commit -m "feat(ib-parsers): parseur Flex XML, trades, cash, opérations sur titres, manques

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 7 : script d'anonymisation et fixture Flex réelle

**Files:**
- Create: `packages/ib-parsers/scripts/anonymize-flex.mjs`
- Create: `packages/ib-parsers/tests/fixtures/flex_activity_sample.xml` (généré)
- Test: `packages/ib-parsers/src/flex.fixture.test.ts`

**Interfaces:**
- Consumes: `parseFlexXml`.
- Produces: la fixture, réutilisée par `apps/web` (tâche 13).

- [ ] **Étape 1 : script**

`packages/ib-parsers/scripts/anonymize-flex.mjs` :

```js
#!/usr/bin/env node
// Turn a real Flex query XML into a committable fixture: same structure,
// sections, types and dates; account, ids, tickers, ISINs and amounts rewritten.
//
//   node scripts/anonymize-flex.mjs ../../private/flex_<compte>_<date>.xml > tests/fixtures/flex_activity_sample.xml

import { readFileSync } from "node:fs";

const [, , input] = process.argv;
if (!input) {
  console.error("usage: anonymize-flex.mjs <flex.xml>");
  process.exit(1);
}
let xml = readFileSync(input, "utf8");

const MAX_ROWS_PER_SECTION = 40;
const MONEY = ["tradePrice", "proceeds", "ibCommission", "netCash", "cost", "amount", "fifoPnlRealized", "fxRateToBase"];
const BLANK = ["acctAlias", "conid", "securityID", "cusip", "isin", "figi", "underlyingConid", "underlyingSecurityID", "issuer", "clientReference", "serialNumber"];
const SCALE = 0.37;

// 1. Trim each section to a handful of rows.
xml = xml.replace(/<(Trades|CashTransactions|CorporateActions|Transfers|OpenPositions)>([\s\S]*?)<\/\1>/g, (_, tag, body) => {
  const rows = body.match(/<[A-Za-z]+ [^>]*\/>/g) ?? [];
  return `<${tag}>\n${rows.slice(0, MAX_ROWS_PER_SECTION).join("\n")}\n</${tag}>`;
});

// 2. Account id.
xml = xml.replace(/accountId="[^"]*"/g, 'accountId="U0000001"');

// 3. Ids: stable, sequential.
const ids = new Map();
for (const name of ["tradeID", "transactionID", "actionID"]) {
  xml = xml.replace(new RegExp(`${name}="(\\d+)"`, "g"), (_, id) => {
    if (!ids.has(id)) ids.set(id, String(1000000 + ids.size));
    return `${name}="${ids.get(id)}"`;
  });
}

// 4. Tickers: every distinct first token of a symbol, except currency pairs.
const tickers = new Map();
for (const [, symbol] of xml.matchAll(/ symbol="([^"]*)"/g)) {
  const ticker = symbol.trim().split(/\s+/)[0];
  if (!ticker || /^[A-Z]{3}\.[A-Z]{3}$/.test(ticker) || tickers.has(ticker)) continue;
  tickers.set(ticker, `SYM${tickers.size + 1}`);
}
for (const [ticker, alias] of tickers) {
  xml = xml.replace(new RegExp(`\\b${ticker.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}\\b`, "g"), alias);
}
// Company names live in description; keep the option contract descriptions ("SYM1 20FEB26 15 P").
xml = xml.replace(/ description="([^"]*)"/g, (_, d) => (/\d{2}[A-Z]{3}\d{2}/.test(d) || /^[A-Z]{3}\.[A-Z]{3}$/.test(d) ? ` description="${d}"` : ` description="${d.replace(/[A-Za-z]{4,}/g, (w) => (["CASH", "RECEIPTS", "ELECTRONIC", "FUND", "TRANSFERS", "WITHHOLDING", "CREDIT", "DIVIDEND", "INTEREST"].includes(w.toUpperCase()) ? w : "ANON"))}"`));

// 5. ISINs.
xml = xml.replace(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g, "XX0000000000");

// 6. Identifying attributes blanked, money scaled.
for (const name of BLANK) xml = xml.replace(new RegExp(` ${name}="[^"]*"`, "g"), ` ${name}=""`);
for (const name of MONEY) {
  xml = xml.replace(new RegExp(` ${name}="(-?[\\d.]+)"`, "g"), (_, v) => ` ${name}="${(Number(v) * SCALE).toFixed(4).replace(/\.?0+$/, "")}"`);
}

process.stdout.write(xml);
```

- [ ] **Étape 2 : générer la fixture et la relire**

```bash
cd packages/ib-parsers
node scripts/anonymize-flex.mjs ../../private/flex_<compte>_<date>.xml > tests/fixtures/flex_activity_sample.xml
grep -c "<Trade " tests/fixtures/flex_activity_sample.xml
grep -o 'symbol="[^"]*"' tests/fixtures/flex_activity_sample.xml | sort -u | head
grep -o 'accountId="[^"]*"' tests/fixtures/flex_activity_sample.xml | sort -u
```

Attendu : 40 trades, symboles `SYM1`… et `EUR.USD`, un seul `accountId="U0000001"`. **Ouvrir la fixture et vérifier à l'œil** qu'aucun nom de société, ISIN ou montant réel ne subsiste avant de committer. Si un libellé réel reste, étendre la liste de mots conservés ou remplacer à la main.

- [ ] **Étape 3 : test d'intégration sur la fixture**

`packages/ib-parsers/src/flex.fixture.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFlexXml } from "./flex.ts";

const xml = readFileSync(new URL("../tests/fixtures/flex_activity_sample.xml", import.meta.url), "utf8");
const TARGET = { accountId: "test", ibAccountId: "U0000001" };

describe("parseFlexXml on the anonymized real file", () => {
  const result = parseFlexXml(xml, TARGET);

  it("reads every trade and cash row without error", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.transactions.filter((t) => t.kind === "trade").length).toBe(40);
    expect(result.transactions.filter((t) => t.kind === "transfer").length).toBeGreaterThan(0);
    expect(result.transactions.filter((t) => t.kind === "tax").length).toBeGreaterThan(0);
  });

  it("reports the sections the real query does not export yet", () => {
    expect(result.issues).toContainEqual({ severity: "warning", code: "section-missing", detail: "Open Positions" });
  });

  it("gives every row a unique externalId", () => {
    const ids = result.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never turns an absent money field into zero on option rows", () => {
    const options = result.transactions.filter((t) => t.secType === "OPT");
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.strike).not.toBeNull();
      expect(o.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.right === "C" || o.right === "P").toBe(true);
    }
  });
});
```

Si la fixture générée contient moins de lignes d'un type (par exemple aucune option dans les 40 premiers trades), monter `MAX_ROWS_PER_SECTION` ou ajuster l'assertion à la fixture réelle, jamais l'inverse.

- [ ] **Étape 4 : vérifier et committer**

```bash
pnpm --filter @ib/ib-parsers test
git add packages/ib-parsers/scripts packages/ib-parsers/tests/fixtures/flex_activity_sample.xml packages/ib-parsers/src/flex.fixture.test.ts
git commit -m "test(ib-parsers): fixture Flex anonymisée et son script de génération

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 8 : parseur du relevé HTML, en-tête et section Transactions

**Files:**
- Create: `packages/ib-parsers/src/hash.ts`, `packages/ib-parsers/src/statement.ts`
- Create: `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm` (copie adaptée)
- Modify: `packages/ib-parsers/src/index.ts`
- Test: `packages/ib-parsers/src/hash.test.ts`, `packages/ib-parsers/src/statement.test.ts`

**Interfaces:**
- Produces: `StatementInfo { ibAccountId, periodStart, periodEnd }`, `parseActivityStatement(html, target): ParseResult<StatementInfo>`, `statementExternalId(parts): string`, `suffixTwins(transactions): Transaction[]`.

- [ ] **Étape 1 : copier et adapter la fixture**

Reprendre `activity_statement_sample.htm`, la fixture de relevé de la première version, dans
`packages/ib-parsers/tests/fixtures/`, puis :

```bash
sed -i 's/_TESTBody/_U0000001Body/g' packages/ib-parsers/tests/fixtures/activity_statement_sample.htm
head -5 packages/ib-parsers/tests/fixtures/activity_statement_sample.htm
```

Ajouter un `<title>` dans le `<head>` du fichier (le créer s'il n'existe pas, juste après `<html>`), exactement :

```html
<head><title>U0000001 Activity Statement January 1, 2025 - December 31, 2025 - Interactive Brokers</title></head>
```

Ajouter dans la section `Transactions`, après la ligne TESTX du 2025-02-02 et dans le même `<tbody>` de catégorie Stocks / USD, deux lignes **jumelles** :

```html
<tr>
<td>TWINX</td>
<td>2025-02-03, 10:00:00</td>
<td align="right">10</td>
<td align="right">5.0000</td>
<td align="right">5.0000</td>
<td align="right">-50.00</td>
<td align="right">-1.00</td>
<td align="right">51.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">O</td>
</tr>
<tr>
<td>TWINX</td>
<td>2025-02-03, 10:00:00</td>
<td align="right">10</td>
<td align="right">5.0000</td>
<td align="right">5.0000</td>
<td align="right">-50.00</td>
<td align="right">-1.00</td>
<td align="right">51.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">O</td>
</tr>
```

Ajouter aussi, dans `Transactions`, un bloc Forex (nouveau `<tbody>` avec `header-asset` Forex puis `header-currency` USD), une ligne :

```html
<tr><td class="header-asset" align="left" valign="middle" colspan="11">Forex</td></tr>
<tr><td class="header-currency" align="left" valign="middle" colspan="11">USD</td></tr>
<tr>
<td>EUR.USD</td>
<td>2025-02-10, 10:00:00</td>
<td align="right">100</td>
<td align="right">1.10000</td>
<td align="right">&nbsp;</td>
<td align="right">-110.00</td>
<td align="right">-2.00</td>
<td align="right">&nbsp;</td>
<td align="right">&nbsp;</td>
<td align="right">-0.25</td>
<td align="right">&nbsp;</td>
</tr>
```

Et une section `OptionCashSettlement` entière, à placer après `CorporateActions`, calquée sur le relevé réel :

```html
<div id="tblOptionCashSettlement_U0000001Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered">
<thead>
<tr>
<th align="left">Date</th>
<th align="left">Description</th>
<th align="right">Amount</th>
<th align="right">MTM P/L</th>
<th align="right">Realized P/L</th>
</tr>
</thead>
<tr><td class="header-currency" align="left" valign="middle" colspan="5">USD</td></tr>
<tr>
<td>2025-08-15, 16:20:00</td>
<td>Exercise ( ZQX 15AUG25 500 P )</td>
<td align="right">250.00</td>
<td align="right">250.00</td>
<td align="right">0.00</td>
</tr>
<tr class="subtotal">
<td class="indent" colspan="2">Total</td>
<td align="right">250.00</td>
<td align="right">250.00</td>
<td align="right">0.00</td>
</tr>
</table>
</div>
</div>
```

Regarder la structure existante du fichier (`sed -n 1,60p`) pour respecter l'imbrication `div > div.table-responsive > table` des sections voisines.

- [ ] **Étape 2 : hash et jumelles**

`packages/ib-parsers/src/hash.ts` :

```ts
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Transaction } from "@ib/ledger";

export interface StatementIdParts {
  accountId: string;
  section: string;
  symbol: string;
  when: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
}

/** A statement has no stable id: key by a hash of the row's content. */
export function statementExternalId(parts: StatementIdParts): string {
  const raw = [parts.accountId, parts.section, parts.symbol, parts.when, parts.quantity, parts.price, parts.amount]
    .map((v) => String(v))
    .join("|");
  return `html:${bytesToHex(sha256(utf8ToBytes(raw)))}`;
}

/**
 * Two identical rows in one file are two real transactions (same contract,
 * same price, same second). Suffix the second and following so both survive,
 * and so a re-import of the same file lands on the same ids.
 */
export function suffixTwins(transactions: Transaction[]): Transaction[] {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    const n = (seen.get(tx.externalId) ?? 0) + 1;
    seen.set(tx.externalId, n);
    return n === 1 ? tx : { ...tx, externalId: `${tx.externalId}#${n}` };
  });
}
```

`packages/ib-parsers/src/hash.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { statementExternalId, suffixTwins } from "./hash.ts";
import type { Transaction } from "@ib/ledger";

const parts = { accountId: "a", section: "Transactions", symbol: "X", when: "2025-01-01T00:00:00.000Z", quantity: 1, price: 2, amount: -2 };

describe("statementExternalId", () => {
  it("is deterministic and prefixed", () => {
    expect(statementExternalId(parts)).toBe(statementExternalId({ ...parts }));
    expect(statementExternalId(parts)).toMatch(/^html:[0-9a-f]{64}$/);
  });

  it("changes with any field, including a null amount versus zero", () => {
    expect(statementExternalId({ ...parts, amount: 0 })).not.toBe(statementExternalId({ ...parts, amount: null }));
    expect(statementExternalId({ ...parts, section: "CombDiv" })).not.toBe(statementExternalId(parts));
  });
});

describe("suffixTwins", () => {
  it("keeps the first and numbers the following identical ids in file order", () => {
    const base = { externalId: "html:abc" } as Transaction;
    const ids = suffixTwins([base, { ...base }, { externalId: "html:other" } as Transaction, { ...base }]).map((t) => t.externalId);
    expect(ids).toEqual(["html:abc", "html:abc#2", "html:other", "html:abc#3"]);
  });
});
```

- [ ] **Étape 3 : tests du parseur, en-tête et trades**

`packages/ib-parsers/src/statement.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseActivityStatement } from "./statement.ts";

const html = readFileSync(new URL("../tests/fixtures/activity_statement_sample.htm", import.meta.url), "utf8");
const TARGET = { accountId: "test", ibAccountId: "U0000001" };

describe("parseActivityStatement header", () => {
  it("reads the account and the declared period from the title", () => {
    const { statement } = parseActivityStatement(html, TARGET);
    expect(statement).toEqual({ ibAccountId: "U0000001", periodStart: "2025-01-01", periodEnd: "2025-12-31" });
  });

  it("refuses a statement of another account", () => {
    const result = parseActivityStatement(html, { accountId: "test", ibAccountId: "U7777777" });
    expect(result.transactions).toEqual([]);
    expect(result.issues).toEqual([
      { severity: "error", code: "account-mismatch", detail: "File belongs to account U0000001, expected U7777777" },
    ]);
  });

  it("rejects a page without statement sections", () => {
    const result = parseActivityStatement("<html><head><title>x</title></head><body></body></html>", TARGET);
    expect(result.statement).toBeNull();
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });

  it("cancels everything when the period cannot be read", () => {
    const untitled = html.replace(/<title>.*<\/title>/, "<title>Nothing</title>");
    const result = parseActivityStatement(untitled, TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });
});

describe("parseActivityStatement trades", () => {
  const trades = parseActivityStatement(html, TARGET).transactions.filter((t) => t.kind === "trade");

  it("normalizes a stock buy with the currency of its block", () => {
    const buy = trades.find((t) => t.symbol === "TESTX" && t.when === "2025-01-02T09:30:00.000Z");
    expect(buy).toMatchObject({
      source: "statement_html",
      secType: "STK",
      quantity: 100,
      price: 10,
      amount: -1000,
      commission: -1,
      currency: "USD",
      description: "TESTX",
      right: "",
      strike: null,
      expiry: null,
    });
    expect(buy?.externalId).toMatch(/^html:[0-9a-f]{64}$/);
  });

  it("keeps a sale's negative quantity", () => {
    const sale = trades.find((t) => t.symbol === "TESTX" && t.quantity === -100);
    expect(sale?.amount).toBe(1200);
  });

  it("splits an option contract out of the Symbol cell", () => {
    const option = trades.find((t) => t.secType === "OPT");
    expect(option).toMatchObject({ right: expect.stringMatching(/^[CP]$/), strike: expect.any(Number), expiry: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(option?.description).toMatch(/\d{2}[A-Z]{3}\d{2}/);
  });

  it("keeps a forex conversion as a trade on the pair with a null close price, quote currency on the row", () => {
    const fx = trades.find((t) => t.symbol === "EUR.USD");
    expect(fx).toMatchObject({ secType: "CASH", quantity: 100, price: 1.1, amount: -110, commission: -2, currency: "USD" });
  });

  it("keeps both twin rows with distinct ids", () => {
    const twins = trades.filter((t) => t.symbol === "TWINX");
    expect(twins).toHaveLength(2);
    expect(twins[1].externalId).toBe(`${twins[0].externalId}#2`);
  });

  it("excludes subtotal and total rows", () => {
    expect(trades.some((t) => /total/i.test(t.symbol))).toBe(false);
  });

  it("cancels everything on an unreadable trade value", () => {
    const broken = html.replace("10.0000", "ten");
    const result = parseActivityStatement(broken, TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "normalization" }));
  });
});
```

- [ ] **Étape 4 : vérifier l'échec, puis implémenter**

```bash
pnpm --filter @ib/ib-parsers test
```

`packages/ib-parsers/src/statement.ts` (première version : en-tête, sections génériques, trades ; les autres sections arrivent à la tâche 9) :

```ts
import type { Transaction } from "@ib/ledger";
import {
  NormalizationError,
  parseNumber,
  parseStatementDateTime,
  splitOptionSymbol,
} from "./common.ts";
import { statementExternalId, suffixTwins } from "./hash.ts";
import { error, warning, type ParseIssue, type ParseResult, type ParseTarget } from "./issues.ts";

export interface StatementInfo {
  ibAccountId: string;
  /** YYYY-MM-DD, from the statement title. */
  periodStart: string;
  periodEnd: string;
}

export type StatementParseResult = ParseResult<StatementInfo>;

const SEC_TYPE_BY_CATEGORY: Record<string, string> = {
  Stocks: "STK",
  "Equity and Index Options": "OPT",
  Forex: "CASH",
  Warrants: "WAR",
};

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

interface SectionRow {
  cells: Record<string, string>;
  assetCategory: string;
  currency: string;
}

interface Section {
  key: string;
  columns: string[];
  rows: SectionRow[];
}

interface Context {
  target: ParseTarget;
  ibAccountId: string;
  doc: Document;
  issues: ParseIssue[];
  /** Asset categories already reported unknown, one warning each. */
  unknownCategories: Set<string>;
}

export function parseActivityStatement(html: string, target: ParseTarget): StatementParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const firstSection = Array.from(doc.querySelectorAll('div[id^="tbl"][id$="Body"]')).find((el) =>
    /^tbl[A-Za-z]+_.+Body$/.test(el.id),
  );
  if (!firstSection) {
    return { transactions: [], statement: null, issues: [error("normalization", "Not an activity statement")] };
  }
  const ibAccountId = /^tbl[A-Za-z]+_(.+)Body$/.exec(firstSection.id)![1];

  const period = readPeriod(doc.title);
  if (!period) {
    return {
      transactions: [],
      statement: null,
      issues: [error("normalization", `Statement period not found in title "${doc.title}"`)],
    };
  }
  const statement: StatementInfo = { ibAccountId, periodStart: period.start, periodEnd: period.end };

  if (ibAccountId !== target.ibAccountId) {
    return {
      transactions: [],
      statement,
      issues: [error("account-mismatch", `File belongs to account ${ibAccountId}, expected ${target.ibAccountId}`)],
    };
  }

  const ctx: Context = { target, ibAccountId, doc, issues: [], unknownCategories: new Set() };
  try {
    const transactions = suffixTwins([...parseTrades(ctx), ...parseOtherSections(ctx)]);
    return { transactions, statement, issues: ctx.issues };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement, issues: [...ctx.issues, error("normalization", e.message)] };
    }
    throw e;
  }
}

/** "U0000001 Activity Statement January 1, 2025 - December 31, 2025 - Interactive Brokers" */
function readPeriod(title: string): { start: string; end: string } | null {
  const match = /Activity Statement\s+([A-Z][a-z]+ \d{1,2}, \d{4})(?:\s+-\s+([A-Z][a-z]+ \d{1,2}, \d{4}))?/.exec(title);
  if (!match) return null;
  const start = longDateToIso(match[1]);
  const end = match[2] ? longDateToIso(match[2]) : start;
  return start && end ? { start, end } : null;
}

function longDateToIso(text: string): string | null {
  const match = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  if (!match) return null;
  const month = MONTHS[match[1]];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function cellText(el: Element): string {
  return (el.textContent ?? "").replace(/\u00a0/g, " ").trim();
}

/**
 * One IB section: header cells name the columns; `subtotal`/`total` rows are
 * skipped; single-cell `header-asset` / `header-currency` rows set the context
 * of the data rows that follow.
 */
function readSection(ctx: Context, key: string, required: boolean): Section | null {
  const body = ctx.doc.getElementById(`tbl${key}_${ctx.ibAccountId}Body`);
  const table = body?.querySelector("table");
  if (!table) return null;
  const columns = Array.from(table.querySelectorAll("thead th")).map(cellText);
  const rows: SectionRow[] = [];
  let assetCategory = "";
  let currency = "";
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    if (tr.closest("thead")) continue;
    if (tr.classList.contains("subtotal") || tr.classList.contains("total")) continue;
    const tds = Array.from(tr.children).filter((el) => el.tagName === "TD");
    if (tds.length === 1 && tds[0].classList.contains("header-asset")) {
      assetCategory = cellText(tds[0]);
      continue;
    }
    if (tds.length === 1 && tds[0].classList.contains("header-currency")) {
      currency = cellText(tds[0]);
      continue;
    }
    if (tds.length === 0) continue;
    const values = tds.map(cellText);
    if (values.length !== columns.length) {
      const detail = `${key}: row with ${values.length} cell(s), expected ${columns.length} (${values.join(" | ")})`;
      if (required) throw new NormalizationError(detail);
      ctx.issues.push(warning("row-skipped", detail));
      continue;
    }
    const cells: Record<string, string> = {};
    columns.forEach((column, i) => (cells[column] = values[i]));
    rows.push({ cells, assetCategory, currency });
  }
  return { key, columns, rows };
}

function secTypeOf(ctx: Context, category: string): string {
  if (category === "") return "";
  const known = SEC_TYPE_BY_CATEGORY[category];
  if (known) return known;
  if (!ctx.unknownCategories.has(category)) {
    ctx.unknownCategories.add(category);
    ctx.issues.push(warning("unknown-asset-category", category));
  }
  return category;
}

function parseTrades(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "Transactions", true);
  if (!sectionData) {
    ctx.issues.push(warning("section-missing", "Transactions"));
    return [];
  }
  return sectionData.rows.map((row) => {
    const symbolText = row.cells["Symbol"] ?? "";
    const { symbol, expiry, strike, right } = splitOptionSymbol(symbolText);
    const secType = secTypeOf(ctx, row.assetCategory);
    if (secType === "OPT" && right === "") {
      ctx.issues.push(warning("row-skipped", `Transactions: option contract not recognised in "${symbolText}" (row kept with the whole cell as symbol)`));
    }
    const what = `trade ${symbolText} ${row.cells["Date/Time"]}`;
    const when = parseStatementDateTime(row.cells["Date/Time"], what);
    const quantity = parseNumber(row.cells["Quantity"], `${what} quantity`);
    const price = parseNumber(row.cells["T. Price"], `${what} price`);
    const amount = parseNumber(row.cells["Proceeds"], `${what} proceeds`);
    return {
      accountId: ctx.target.accountId,
      externalId: statementExternalId({ accountId: ctx.target.accountId, section: "Transactions", symbol, when, quantity, price, amount }),
      source: "statement_html",
      kind: "trade",
      symbol,
      secType,
      right,
      strike,
      expiry,
      quantity,
      price,
      amount,
      commission: parseNumber(row.cells["Comm/Fee"], `${what} commission`),
      currency: row.currency,
      when,
      description: symbolText,
    } satisfies Transaction;
  });
}

// Cash sections, corporate actions and option cash settlements: task 9.
function parseOtherSections(_ctx: Context): Transaction[] {
  return [];
}
```

Ajouter à `index.ts` : `export * from "./statement.ts"; export * from "./hash.ts";`

- [ ] **Étape 5 : vérifier et committer**

```bash
pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ib-parsers typecheck && pnpm lint
git add packages/ib-parsers
git commit -m "feat(ib-parsers): relevé HTML, en-tête, garde-fou de compte et section Transactions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 9 : relevé HTML, sections de cash, opérations sur titres, Option Cash Settlement

**Files:**
- Modify: `packages/ib-parsers/src/statement.ts`
- Test: `packages/ib-parsers/src/statement.test.ts` (ajouts)

- [ ] **Étape 1 : tests**

Ajouter à `statement.test.ts` :

```ts
describe("parseActivityStatement cash sections", () => {
  const { transactions, issues } = parseActivityStatement(html, TARGET);
  const byKind = (kind: string) => transactions.filter((t) => t.kind === kind);

  it("reads a dividend with its ticker pulled from the description, at midnight", () => {
    const [dividend] = byKind("dividend");
    expect(dividend).toMatchObject({
      symbol: "TESTX",
      amount: 10,
      currency: "USD",
      when: "2025-03-15T00:00:00.000Z",
      quantity: null,
      price: null,
      commission: null,
      secType: "",
    });
    expect(dividend.description).toContain("Cash Dividend");
  });

  it("reads withholding tax, fees and interest", () => {
    expect(byKind("tax")[0]).toMatchObject({ symbol: "TESTX", amount: -1.5 });
    expect(byKind("fee").length).toBeGreaterThan(0);
    expect(byKind("interest").length).toBeGreaterThan(0);
  });

  it("reads deposits and withdrawals as transfers with an empty symbol", () => {
    const transfers = byKind("transfer");
    expect(transfers.map((t) => t.amount)).toEqual([10000, -2500.5]);
    expect(transfers[0]).toMatchObject({ symbol: "", currency: "EUR", description: "Electronic Fund Transfer" });
  });

  it("reads a corporate action with its quantity and zero proceeds kept as zero", () => {
    const [split] = byKind("corporate_action");
    expect(split).toMatchObject({ symbol: "TESTX", quantity: 100, amount: 0, secType: "STK", when: "2025-05-30T20:00:00.000Z" });
  });

  it("turns an option cash settlement into a trade on the contract, without quantity", () => {
    const settlement = transactions.find((t) => t.description.startsWith("Exercise"));
    expect(settlement).toMatchObject({
      kind: "trade",
      secType: "OPT",
      symbol: "ZQX",
      expiry: "2025-08-15",
      strike: 500,
      right: "P",
      quantity: null,
      price: null,
      commission: null,
      amount: 250,
      currency: "USD",
      when: "2025-08-15T16:20:00.000Z",
    });
  });

  it("does not warn about optional sections that are simply absent", () => {
    expect(issues.filter((i) => i.code === "section-missing")).toEqual([]);
  });

  it("gives every row a unique externalId", () => {
    const ids = transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("warns that a Transfers section is present but not read", () => {
    const withTransfers = html.replace(
      "</body>",
      '<div id="tblTransfers_U0000001Body"><table><thead><tr><th>Date</th></tr></thead></table></div></body>',
    );
    expect(parseActivityStatement(withTransfers, TARGET).issues).toContainEqual({
      severity: "warning",
      code: "section-unread",
      detail: "Transfers",
    });
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

```bash
pnpm --filter @ib/ib-parsers test
```

- [ ] **Étape 3 : implémentation**

Remplacer dans `statement.ts` la fonction `parseOtherSections` par :

```ts
const CASH_SECTION_KIND: Record<string, TransactionKind> = {
  CombDiv: "dividend",
  WithholdingTax: "tax",
  CombFees: "fee",
  CombInt: "interest",
  CombDepWith: "transfer",
};

function parseOtherSections(ctx: Context): Transaction[] {
  const out: Transaction[] = [];
  for (const key of Object.keys(CASH_SECTION_KIND)) out.push(...parseCashSection(ctx, key));
  out.push(...parseCorporateActions(ctx));
  out.push(...parseOptionCashSettlements(ctx));
  if (ctx.doc.getElementById(`tblTransfers_${ctx.ibAccountId}Body`)) {
    ctx.issues.push(warning("section-unread", "Transfers"));
  }
  return out;
}

function cashRow(
  ctx: Context,
  section: string,
  kind: TransactionKind,
  row: SectionRow,
  fields: { symbol: string; secType: string; right: "C" | "P" | ""; strike: number | null; expiry: string | null; quantity: number | null; when: string; description: string },
): Transaction {
  const amount = parseNumber(row.cells["Amount"] ?? row.cells["Proceeds"], `${section} ${fields.description} amount`);
  return {
    accountId: ctx.target.accountId,
    externalId: statementExternalId({
      accountId: ctx.target.accountId,
      section,
      symbol: fields.symbol,
      when: fields.when,
      quantity: fields.quantity,
      price: null,
      amount,
    }),
    source: "statement_html",
    kind,
    symbol: fields.symbol,
    secType: fields.secType,
    right: fields.right,
    strike: fields.strike,
    expiry: fields.expiry,
    quantity: fields.quantity,
    price: null,
    amount,
    commission: null,
    currency: row.currency,
    when: fields.when,
    description: fields.description,
  };
}

/** Date / Description / Amount sections under per-currency headers. */
function parseCashSection(ctx: Context, key: string): Transaction[] {
  const sectionData = readSection(ctx, key, false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    return cashRow(ctx, key, CASH_SECTION_KIND[key], row, {
      symbol: symbolFromDescription(description),
      secType: "",
      right: "",
      strike: null,
      expiry: null,
      quantity: null,
      when: parseStatementDateTime(row.cells["Date"], `${key} ${description}`),
      description,
    });
  });
}

function parseCorporateActions(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "CorporateActions", false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    return cashRow(ctx, "CorporateActions", "corporate_action", row, {
      symbol: symbolFromDescription(description),
      secType: secTypeOf(ctx, row.assetCategory),
      right: "",
      strike: null,
      expiry: null,
      quantity: parseNumber(row.cells["Quantity"], `corporate action ${description} quantity`),
      when: parseStatementDateTime(row.cells["Date/Time"], `corporate action ${description}`),
      description,
    });
  });
}

/**
 * A cash-settled index option (XSP, SPX) exercised or assigned delivers no
 * shares: the Transactions section closes the position at price 0 and this
 * section carries the cash actually paid. Without it every settlement is
 * missing from the running balance.
 */
function parseOptionCashSettlements(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "OptionCashSettlement", false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    const contractText = /\(\s*(.+?)\s*\)/.exec(description)?.[1] ?? "";
    const contract = splitOptionSymbol(contractText);
    if (contract.right === "") {
      ctx.issues.push(warning("row-skipped", `OptionCashSettlement: contract not recognised in "${description}" (kept with the description as symbol)`));
    }
    return cashRow(ctx, "OptionCashSettlement", "trade", row, {
      symbol: contract.right === "" ? description : contract.symbol,
      secType: "OPT",
      right: contract.right,
      strike: contract.strike,
      expiry: contract.expiry,
      quantity: null,
      when: parseStatementDateTime(row.cells["Date"], `option cash settlement ${description}`),
      description,
    });
  });
}
```

Compléter les imports en tête de `statement.ts` : `import type { Transaction, TransactionKind } from "@ib/ledger";` et ajouter `symbolFromDescription` à l'import depuis `./common.ts`.

- [ ] **Étape 4 : vérifier et committer**

```bash
pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ib-parsers typecheck && pnpm lint
git add packages/ib-parsers
git commit -m "feat(ib-parsers): relevé HTML, sections de cash, opérations sur titres et règlements d'options

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 10 : relevé réel de `alpha` en contrôle manuel

**Files:** aucun fichier versionné.

- [ ] **Étape 1 : script jetable**

Dans le scratchpad, un script qui charge le relevé réel sous jsdom et imprime les comptages. Il ne va pas dans le dépôt.

```bash
cat > /tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad/probe.test.ts <<'EOF'
import { readFileSync } from "node:fs";
import { it } from "vitest";
import { parseActivityStatement } from "../../../../../home/seb/IA/IB_Analyzer2/packages/ib-parsers/src/statement.ts";

it("probes the real statement", () => {
  const html = readFileSync("/home/seb/IA/IB_Analyzer2/private/SU10012345_2025_2025.htm", "utf8");
  const ibAccountId = /tbl[A-Za-z]+_(.+?)Body/.exec(html)![1];
  const result = parseActivityStatement(html, { accountId: "alpha", ibAccountId });
  const counts: Record<string, number> = {};
  for (const t of result.transactions) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
  console.log(result.statement, counts, result.issues);
});
EOF
cd packages/ib-parsers && npx vitest run --root / /tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad/probe.test.ts --environment jsdom
```

Si le chemin relatif d'import gêne, copier temporairement le script dans `packages/ib-parsers/src/probe.test.ts`, le lancer, puis **le supprimer avant tout commit** (`git status` doit être propre).

- [ ] **Étape 2 : lire le résultat**

Attendu : aucune issue `error`, un `trade` dont la description commence par `Exercise (` et porte un contrat d'option sur indice réglé en cash, des lignes Forex (`EUR.USD`), et éventuellement un avertissement `unknown-asset-category` pour une catégorie non listée. Si une erreur de normalisation apparaît, c'est un cas réel non couvert : l'ajouter à la fixture anonymisée (valeurs fictives, même forme) et corriger le parseur, en TDD. Ne jamais copier une ligne réelle dans la fixture.

Rien à committer.

---
## Tâche 11 : `packages/ui` et squelette `apps/web` avec thème et i18n

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/components.json`, `packages/ui/README.md`, `packages/ui/src/lib/utils.ts`, `packages/ui/src/hooks/use-mobile.ts`, `packages/ui/src/components/ui/*.tsx` (copiés)
- Create: `apps/web/package.json`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/tsconfig.node.json`, `apps/web/vitest.setup.ts`, `apps/web/public/favicon.svg`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/src/i18n/{index.ts,en.json,fr.json}`, `apps/web/src/lib/{format.ts,utils.ts}`, `apps/web/src/hooks/useTheme.ts`, `apps/web/src/components/{LanguageSwitcher,ThemeToggle}.tsx`, `apps/web/src/pages/PlaceholderPage.tsx`, `apps/web/src/routes/router.tsx`
- Test: copiés `format.test.ts`, `i18n/index.test.ts`, `LanguageSwitcher.test.tsx`, `ThemeToggle.test.tsx`, plus `App.test.tsx` réécrit

**Interfaces:**
- Produces: composants `@ib/ui/<name>` (`button`, `card`, `input`, `select`, `table`, `badge`, `separator`, `sheet`, `sidebar`, `skeleton`, `tooltip`), `formatAmount`, `formatPrice`, `formatDateTime`, `formatMoney`, `formatPercent`, i18n singleton `@/i18n`.

- [ ] **Étape 1 : `packages/ui`**

```bash
mkdir -p packages/ui/src/components/ui packages/ui/src/lib packages/ui/src/hooks
OLD=<racine du frontend de la première version>
cp $OLD/src/components/ui/*.tsx packages/ui/src/components/ui/
cp $OLD/src/lib/utils.ts packages/ui/src/lib/utils.ts
cp $OLD/src/hooks/use-mobile.ts packages/ui/src/hooks/use-mobile.ts
# The app's "@" alias must not leak into a shared package: relative imports.
sed -i 's#from "@/lib/utils"#from "../../lib/utils"#; s#from "@/hooks/use-mobile"#from "../../hooks/use-mobile"#; s#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' packages/ui/src/components/ui/*.tsx
grep -rn '"@/' packages/ui/src || echo "no alias left"
```

`packages/ui/package.json` :

```json
{
  "name": "@ib/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/components/ui/*.tsx",
    "./lib/utils": "./src/lib/utils.ts",
    "./hooks/use-mobile": "./src/hooks/use-mobile.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "peerDependencies": { "react": "^19.2.8", "react-dom": "^19.2.8" },
  "dependencies": {
    "@base-ui/react": "^1.7.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.35.0",
    "tailwind-merge": "^3.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.5",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "typescript": "~6.0.3"
  }
}
```

`packages/ui/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "types": [] },
  "include": ["src"]
}
```

`packages/ui/components.json` : copier `$OLD/components.json` et remplacer `"css": "src/index.css"` par `"css": "../../apps/web/src/index.css"`.

`packages/ui/README.md` :

````markdown
# @ib/ui

Composants shadcn (style base-nova, primitives base-ui) partagés par les applications.
Le thème et les jetons de couleur vivent dans `apps/web/src/index.css`.

Après un `pnpm dlx shadcn@latest add <composant>` dans ce dossier, réécrire les alias
`@/…` du fichier généré en imports relatifs, l'alias `@` appartient aux applications :

```bash
sed -i 's#from "@/lib/utils"#from "../../lib/utils"#; s#from "@/hooks/use-mobile"#from "../../hooks/use-mobile"#; s#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' src/components/ui/<composant>.tsx
```

Import côté application : `import { Button } from "@ib/ui/button";`.
````

- [ ] **Étape 2 : `apps/web`, configuration**

`apps/web/package.json` :

```json
{
  "name": "web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@base-ui/react": "^1.7.0",
    "@fontsource-variable/geist": "^5.3.0",
    "@fontsource-variable/geist-mono": "^5.3.0",
    "@ib/ib-parsers": "workspace:*",
    "@ib/ledger": "workspace:*",
    "@ib/ui": "workspace:*",
    "@tailwindcss/vite": "^4.3.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "dexie": "^4.4.5",
    "dexie-react-hooks": "^4.4.0",
    "i18next": "^23.16.8",
    "lucide-react": "^1.35.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-i18next": "^14.1.3",
    "react-router": "^8.3.0",
    "shadcn": "^4.20.1",
    "tailwind-merge": "^3.6.0",
    "tailwindcss": "^4.3.3",
    "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.6",
    "@types/node": "^24.13.3",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.5",
    "@vitejs/plugin-react": "^6.1.1",
    "fake-indexeddb": "^6.2.5",
    "jsdom": "^30.0.1",
    "playwright": "^1.62.1",
    "typescript": "~6.0.3",
    "vite": "^8.2.2",
    "vitest": "^4.1.11"
  }
}
```

`apps/web/vite.config.ts` :

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": `${import.meta.dirname}/src` },
  },
  server: { host: "127.0.0.1" },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

`apps/web/tsconfig.json` :

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`apps/web/tsconfig.app.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "paths": { "@/*": ["./src/*"] },
    "allowArbitraryExtensions": true
  },
  "include": ["src", "vitest.setup.ts"]
}
```

`apps/web/tsconfig.node.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "lib": ["ES2024"],
    "types": ["node"],
    "module": "nodenext",
    "moduleResolution": "nodenext"
  },
  "include": ["vite.config.ts"]
}
```

`apps/web/vitest.setup.ts` : copier `$OLD/vitest.setup.ts` puis ajouter en première ligne :

```ts
import "fake-indexeddb/auto";
```

`apps/web/index.html` : copier `$OLD/index.html`. `apps/web/public/favicon.svg` : copier `$OLD/public/favicon.svg`.

- [ ] **Étape 3 : `apps/web`, sources copiées**

```bash
mkdir -p apps/web/src/{i18n,lib,hooks,components,pages,routes,db,mocks}
cp $OLD/src/index.css apps/web/src/index.css
cp $OLD/src/i18n/index.ts $OLD/src/i18n/index.test.ts apps/web/src/i18n/
cp $OLD/src/i18n/en.json $OLD/src/i18n/fr.json apps/web/src/i18n/
cp $OLD/src/lib/format.ts $OLD/src/lib/format.test.ts $OLD/src/lib/utils.ts apps/web/src/lib/
cp $OLD/src/hooks/useTheme.ts apps/web/src/hooks/
cp $OLD/src/components/LanguageSwitcher.tsx $OLD/src/components/LanguageSwitcher.test.tsx $OLD/src/components/ThemeToggle.tsx $OLD/src/components/ThemeToggle.test.tsx apps/web/src/components/
cp $OLD/src/pages/PlaceholderPage.tsx apps/web/src/pages/
cp $OLD/src/main.tsx apps/web/src/main.tsx
# shadcn components now come from the shared package
sed -i 's#from "@/components/ui/\([a-z-]*\)"#from "@ib/ui/\1"#' apps/web/src/components/*.tsx apps/web/src/pages/*.tsx
```

Dans `apps/web/src/index.css`, juste après la ligne `@import "shadcn/tailwind.css";`, ajouter :

```css
@source "../../../packages/ui/src";
```

`apps/web/src/App.tsx` (sans TanStack Query) :

```tsx
import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "react-router";
import i18n from "@/i18n";
import { router } from "@/routes/router";

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  );
}
```

`apps/web/src/routes/router.tsx`, version provisoire remplacée à la tâche 14 :

```tsx
import { createBrowserRouter } from "react-router";
import { PlaceholderPage } from "@/pages/PlaceholderPage";

export const router = createBrowserRouter([
  { path: "/", element: <PlaceholderPage titleKey="nav.history" /> },
]);
```

`apps/web/src/App.test.tsx` :

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";

describe("App", () => {
  it("mounts with the shared i18n and router providers", async () => {
    render(<App />);
    expect(await screen.findByText("Bientôt disponible.")).toBeInTheDocument();
  });
});
```

Ajouter aux deux fichiers i18n, dans `nav`, les clés des deux nouvelles pages (les autres clés arrivent avec leurs pages) :

| Clé | en | fr |
|---|---|---|
| `nav.sources` | `Data sources` | `Sources de données` |
| `nav.settings` | `Settings` | `Paramètres` |

et retirer `nav.portfolios`.

- [ ] **Étape 4 : installer, lancer, vérifier le rendu**

```bash
pnpm install
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter @ib/ui typecheck
pnpm lint
```

Attendu : tests copiés verts (format, i18n, LanguageSwitcher, ThemeToggle, App). Puis un démarrage réel :

```bash
cd apps/web && npx vite --port 5173 --strictPort &
sleep 3 && curl -s http://127.0.0.1:5173 | grep -c root && kill %1
```

Attendu : `1`. Le rendu visuel est vérifié à la tâche 17 avec le skill.

- [ ] **Étape 5 : commit**

```bash
git add pnpm-lock.yaml packages/ui apps/web
git commit -m "feat(web): squelette Vite, paquet ui shadcn, thème et i18n copiés de la première version

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 12 : IndexedDB, comptes et hooks de lecture

**Files:**
- Create: `apps/web/src/db/schema.ts`, `apps/web/src/db/accounts.ts`, `apps/web/src/db/hooks.ts`, `apps/web/src/lib/accountStorage.ts`
- Test: `apps/web/src/db/accounts.test.ts`, `apps/web/src/db/hooks.test.tsx`

**Interfaces:**
- Consumes: `Transaction`, `TransactionKind`, `TransactionSource`, `DroppedCount`, `sortTransactions` de `@ib/ledger` ; `ParseIssue` de `@ib/ib-parsers`.
- Produces: `AppDatabase`, `db` (singleton), `AccountRecord`, `ImportRecord`, `createAccount(db, input)`, `deleteAccount(db, id)`, `slugify(label)`, `AccountError` (`code: "label-empty" | "ib-account-id-invalid" | "slug-taken"`), `IB_ACCOUNT_ID_RE`, `useAccounts()`, `useAccount(id)`, `useLedger(accountId)`, `useImports(accountId)`, `getLastAccountId()`, `setLastAccountId(id)`, `clearLastAccountId()`.

- [ ] **Étape 1 : schéma et stockage local**

`apps/web/src/db/schema.ts` :

```ts
import Dexie, { type EntityTable, type Table } from "dexie";
import type { DroppedCount, Transaction, TransactionKind, TransactionSource } from "@ib/ledger";
import type { ParseIssue } from "@ib/ib-parsers";

export interface AccountRecord {
  /** Slug of the label; the `:accountId` of every route. */
  id: string;
  label: string;
  ibAccountId: string;
  createdAt: string;
  /** Kinds already reported as dropped by a Flex sync: warn once per kind. */
  warnedDroppedKinds: TransactionKind[];
}

export interface ImportRecord {
  id?: number;
  accountId: string;
  source: TransactionSource;
  at: string;
  fileName: string;
  period: { start: string; end: string } | null;
  imported: number;
  skipped: number;
  dropped: DroppedCount[];
  issues: ParseIssue[];
}

export class AppDatabase extends Dexie {
  accounts!: EntityTable<AccountRecord, "id">;
  transactions!: Table<Transaction, [string, string]>;
  imports!: EntityTable<ImportRecord, "id">;

  constructor(name = "ib-analyzer") {
    super(name);
    this.version(1).stores({
      accounts: "id",
      transactions: "[accountId+externalId], accountId, [accountId+when]",
      imports: "++id, accountId",
    });
  }
}

/** The one database of the app. Tests wipe its tables between cases. */
export const db = new AppDatabase();
```

`apps/web/src/lib/accountStorage.ts` :

```ts
const STORAGE_KEY = "ib2:lastAccountId";

export function getLastAccountId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastAccountId(accountId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, accountId);
  } catch {
    // Best-effort only (e.g. storage disabled in private browsing).
  }
}

export function clearLastAccountId(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above.
  }
}
```

- [ ] **Étape 2 : tests des comptes**

`apps/web/src/db/accounts.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, createAccount, deleteAccount, slugify } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  window.localStorage.clear();
});

describe("slugify", () => {
  it("lowercases, strips accents and joins with dashes", () => {
    expect(slugify("Compte Élodie 2")).toBe("compte-elodie-2");
    expect(slugify("  beta ")).toBe("beta");
    expect(slugify("!!!")).toBe("");
  });
});

describe("createAccount", () => {
  it("stores the account under its slug with a normalized IB id", async () => {
    const account = await createAccount(db, { label: "Beta", ibAccountId: " u1234567 " });
    expect(account).toMatchObject({ id: "beta", label: "Beta", ibAccountId: "U1234567", warnedDroppedKinds: [] });
    expect(await db.accounts.get("beta")).toMatchObject({ label: "Beta" });
  });

  it("refuses an empty label", async () => {
    await expect(createAccount(db, { label: " ", ibAccountId: "U1234567" })).rejects.toMatchObject({ code: "label-empty" });
  });

  it("refuses an IB id that does not look like one", async () => {
    await expect(createAccount(db, { label: "x", ibAccountId: "hello" })).rejects.toMatchObject({ code: "ib-account-id-invalid" });
  });

  it("accepts a paper account id", async () => {
    await expect(createAccount(db, { label: "paper", ibAccountId: "DU1234567" })).resolves.toMatchObject({ ibAccountId: "DU1234567" });
  });

  it("refuses a second account with the same slug", async () => {
    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
    await expect(createAccount(db, { label: "beta", ibAccountId: "U7654321" })).rejects.toBeInstanceOf(AccountError);
    expect(await db.accounts.count()).toBe(1);
  });
});

describe("deleteAccount", () => {
  it("removes the account with its transactions and imports, and forgets it as last visited", async () => {
    await createAccount(db, { label: "a", ibAccountId: "U1111111" });
    await createAccount(db, { label: "b", ibAccountId: "U2222222" });
    await db.transactions.bulkAdd([
      { accountId: "a", externalId: "x" } as never,
      { accountId: "b", externalId: "y" } as never,
    ]);
    await db.imports.add({ accountId: "a", source: "flex", at: "", fileName: "", period: null, imported: 0, skipped: 0, dropped: [], issues: [] });
    setLastAccountId("a");

    await deleteAccount(db, "a");

    expect(await db.accounts.toArray()).toHaveLength(1);
    expect(await db.transactions.toArray()).toEqual([{ accountId: "b", externalId: "y" }]);
    expect(await db.imports.count()).toBe(0);
    expect(getLastAccountId()).toBeNull();
  });
});
```

- [ ] **Étape 3 : vérifier l'échec, implémenter**

```bash
pnpm --filter web test -- accounts
```

`apps/web/src/db/accounts.ts` :

```ts
import { clearLastAccountId, getLastAccountId } from "@/lib/accountStorage";
import type { AccountRecord, AppDatabase } from "./schema";

/** "U1234567", paper "DU1234567". */
export const IB_ACCOUNT_ID_RE = /^[A-Z]{1,2}\d{6,9}$/;

export type AccountErrorCode = "label-empty" | "ib-account-id-invalid" | "slug-taken";

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
    this.name = "AccountError";
  }
}

export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createAccount(
  db: AppDatabase,
  input: { label: string; ibAccountId: string },
): Promise<AccountRecord> {
  const label = input.label.trim();
  const id = slugify(label);
  if (!id) throw new AccountError("label-empty");
  const ibAccountId = input.ibAccountId.trim().toUpperCase();
  if (!IB_ACCOUNT_ID_RE.test(ibAccountId)) throw new AccountError("ib-account-id-invalid");

  const record: AccountRecord = {
    id,
    label,
    ibAccountId,
    createdAt: new Date().toISOString(),
    warnedDroppedKinds: [],
  };
  await db.transaction("rw", db.accounts, async () => {
    if (await db.accounts.get(id)) throw new AccountError("slug-taken");
    await db.accounts.add(record);
  });
  return record;
}

export async function deleteAccount(db: AppDatabase, id: string): Promise<void> {
  await db.transaction("rw", db.accounts, db.transactions, db.imports, async () => {
    await db.transactions.where("accountId").equals(id).delete();
    await db.imports.where("accountId").equals(id).delete();
    await db.accounts.delete(id);
  });
  if (getLastAccountId() === id) clearLastAccountId();
}
```

- [ ] **Étape 4 : hooks et leur test**

`apps/web/src/db/hooks.ts` :

```ts
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { sortTransactions, type Transaction } from "@ib/ledger";
import { db, type AccountRecord, type ImportRecord } from "./schema";

/** `undefined` while the query has not answered yet. */
export function useAccounts(): AccountRecord[] | undefined {
  return useLiveQuery(() => db.accounts.orderBy("id").toArray(), []);
}

/** `undefined` while loading, `null` when there is no such account. */
export function useAccount(id: string | undefined): AccountRecord | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.accounts.get(id)) ?? null) : null), [id]);
}

/** The whole ledger of one account, in reference order; `undefined` while loading. */
export function useLedger(accountId: string): Transaction[] | undefined {
  const rows = useLiveQuery(() => db.transactions.where("accountId").equals(accountId).toArray(), [accountId]);
  return useMemo(() => (rows ? sortTransactions(rows) : undefined), [rows]);
}

/** Past imports of one account, newest first. */
export function useImports(accountId: string): ImportRecord[] | undefined {
  return useLiveQuery(
    () => db.imports.where("accountId").equals(accountId).reverse().sortBy("at"),
    [accountId],
  );
}
```

`apps/web/src/db/hooks.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { db } from "@/db/schema";
import { useAccount, useLedger } from "@/db/hooks";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.imports.clear()]);
});

describe("useAccount", () => {
  it("resolves to null for an unknown account and to the record for a known one", async () => {
    await db.accounts.add({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
    const unknown = renderHook(() => useAccount("nope"));
    await waitFor(() => expect(unknown.result.current).toBeNull());
    const known = renderHook(() => useAccount("alpha"));
    await waitFor(() => expect(known.result.current).toMatchObject({ label: "alpha" }));
  });
});

describe("useLedger", () => {
  it("returns only the account's rows, in reference order, and follows writes", async () => {
    await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS);
    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], accountId: "other", externalId: "flex:trade:other" });
    const { result } = renderHook(() => useLedger("alpha"));
    await waitFor(() => expect(result.current).toHaveLength(SAMPLE_TRANSACTIONS.length));
    expect(result.current!.map((t) => t.symbol)).toEqual(["", "TSLA", "MSFT", "AAPL"]);

    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:new", when: "2026-09-01T00:00:00.000Z", symbol: "NEW" });
    await waitFor(() => expect(result.current!.at(-1)?.symbol).toBe("NEW"));
  });
});
```

`apps/web/src/mocks/ledger.ts` (échantillon partagé par les tests et le skill `run-frontend`) :

```ts
import type { Transaction } from "@ib/ledger";

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "alpha",
    externalId: "flex:trade:1",
    source: "flex",
    kind: "trade",
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity: 100,
    price: 180.5,
    amount: -18050,
    commission: -1.5,
    currency: "USD",
    when: "2026-08-28T14:30:00.000Z",
    description: "",
    ...overrides,
  };
}

/** Chronology DEPOSIT -> TSLA -> MSFT -> AAPL; USD ends at -18543.15, EUR at 10000. */
export const SAMPLE_DEPOSIT: Transaction = trade({
  externalId: "flex:cash:1",
  kind: "transfer",
  symbol: "",
  secType: "",
  quantity: null,
  price: null,
  amount: 10000,
  commission: null,
  currency: "EUR",
  when: "2026-08-12T00:00:00.000Z",
  description: "ELECTRONIC FUND TRANSFER",
});

export const SAMPLE_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:4" }),
  trade({ externalId: "flex:trade:3", symbol: "MSFT", quantity: -1, price: 6.1, amount: 610, commission: -0.65, when: "2026-08-27T10:15:00.000Z" }),
  trade({ externalId: "flex:trade:2", symbol: "TSLA", quantity: 5, price: 220, amount: -1100, commission: -1, when: "2026-08-20T09:05:00.000Z" }),
  SAMPLE_DEPOSIT,
];
```

- [ ] **Étape 5 : vérifier et committer**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm lint
git add apps/web
git commit -m "feat(web): base Dexie, comptes par slug, hooks de lecture réactifs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 13 : `importFile`, du fichier au ledger en une transaction

**Files:**
- Create: `apps/web/src/db/readFile.ts`, `apps/web/src/db/importFile.ts`
- Test: `apps/web/src/db/importFile.test.ts`

**Interfaces:**
- Consumes: `parseFlexXml`, `parseActivityStatement`, `hasErrors` (`@ib/ib-parsers`) ; `planImport` (`@ib/ledger`) ; `AppDatabase`, `AccountRecord`.
- Produces: `detectFormat(text): "flex" | "statement_html" | null`, `ImportReport`, `importFile(db, account, file): Promise<ImportReport>`.

- [ ] **Étape 1 : tests**

`apps/web/src/db/importFile.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import flexXml from "../../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml?raw";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import { detectFormat, importFile } from "@/db/importFile";
import { AppDatabase, type AccountRecord } from "@/db/schema";

const account: AccountRecord = { id: "test", label: "Test", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };
let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

const file = (content: string, name: string) => new File([content], name, { type: "text/plain" });

describe("detectFormat", () => {
  it("tells a Flex response from a statement from anything else", () => {
    expect(detectFormat(flexXml)).toBe("flex");
    expect(detectFormat(statementHtml)).toBe("statement_html");
    expect(detectFormat("{}")).toBeNull();
  });
});

describe("importFile", () => {
  it("imports a Flex file and records the import", async () => {
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", source: "flex", fileName: "flex.xml", skipped: 0, dropped: [] });
    expect(await db.transactions.where("accountId").equals("test").count()).toBe(report.status === "ok" ? report.imported : -1);
    const [record] = await db.imports.toArray();
    expect(record).toMatchObject({ accountId: "test", source: "flex", fileName: "flex.xml", period: { start: "2025-09-03", end: "2026-09-02" } });
  });

  it("is idempotent: the same file twice leaves the same rows", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const before = await db.transactions.count();
    await importFile(db, account, file(flexXml, "flex.xml"));
    expect(await db.transactions.count()).toBe(before);
    expect(await db.imports.count()).toBe(2);
  });

  it("imports a statement before Flex and skips the rows Flex owns", async () => {
    // The statement covers 2025; the Flex fixture starts in late 2025.
    await importFile(db, account, file(flexXml, "flex.xml"));
    const flexRows = await db.transactions.where("accountId").equals("test").toArray();
    const firstFlexDay = flexRows.map((t) => t.when).sort()[0].slice(0, 10);

    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report.status).toBe("ok");
    const htmlRows = (await db.transactions.toArray()).filter((t) => t.source === "statement_html");
    expect(htmlRows.length).toBeGreaterThan(0);
    for (const row of htmlRows) expect(row.when.slice(0, 10) < firstFlexDay).toBe(true);
    expect(await db.transactions.count()).toBe(flexRows.length + htmlRows.length);
  });

  it("re-importing an overlapping statement replaces, never duplicates", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await db.transactions.count();
    await importFile(db, account, file(statementHtml, "2025-again.htm"));
    expect(await db.transactions.count()).toBe(before);
  });

  it("reports what a Flex import dropped, once per kind, and remembers it on the account", async () => {
    await db.accounts.add(account);
    const inside = (externalId: string, when: string) => ({
      accountId: "test", externalId, source: "statement_html" as const, kind: "transfer" as const, symbol: "", secType: "",
      right: "" as const, strike: null, expiry: null, quantity: null, price: null, amount: 5, commission: null,
      currency: "USD", when, description: "statement row inside the Flex range",
    });
    await db.transactions.put(inside("html:inside", "2026-06-01T00:00:00.000Z"));

    const first = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(first).toMatchObject({ status: "ok", dropped: [{ kind: "transfer", count: 1 }] });
    expect(await db.transactions.get(["test", "html:inside"])).toBeUndefined();
    const updated = (await db.accounts.get("test"))!;
    expect(updated.warnedDroppedKinds).toEqual(["transfer"]);

    await db.transactions.put(inside("html:inside2", "2026-06-02T00:00:00.000Z"));
    const second = await importFile(db, updated, file(flexXml, "flex.xml"));
    expect(second).toMatchObject({ status: "ok", dropped: [] });
    const [, record] = await db.imports.orderBy("id").toArray();
    // The import record keeps the full count; only the report filters it.
    expect(record.dropped).toEqual([{ kind: "transfer", count: 1 }]);
  });

  it("writes nothing and reports the error on a file of another account", async () => {
    const report = await importFile(db, { ...account, ibAccountId: "U9999999" }, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "error", source: "flex" });
    expect(report.issues[0]).toMatchObject({ code: "account-mismatch" });
    expect(await db.transactions.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
  });

  it("writes nothing on an unrecognized file", async () => {
    const report = await importFile(db, account, file("hello", "notes.txt"));
    expect(report).toMatchObject({ status: "error", source: null });
    expect(await db.transactions.count()).toBe(0);
  });

  it("keeps the parser's warnings in the report and in the import record", async () => {
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report.issues).toContainEqual({ severity: "warning", code: "section-missing", detail: "Open Positions" });
    const [record] = await db.imports.toArray();
    expect(record.issues).toEqual(report.issues);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec, implémenter**

```bash
pnpm --filter web test -- importFile
```

`apps/web/src/db/readFile.ts` :

```ts
/** `File.text()` where available, `FileReader` otherwise (older jsdom). */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
```

`apps/web/src/db/importFile.ts` :

```ts
import { planImport, type DroppedCount, type TransactionSource } from "@ib/ledger";
import { hasErrors, parseActivityStatement, parseFlexXml, type ParseIssue } from "@ib/ib-parsers";
import { readFileText } from "./readFile";
import type { AccountRecord, AppDatabase } from "./schema";

export type ImportFormat = Extract<TransactionSource, "flex" | "statement_html">;

export type ImportReport =
  | { status: "error"; fileName: string; source: ImportFormat | null; issues: ParseIssue[] }
  | {
      status: "ok";
      fileName: string;
      source: ImportFormat;
      period: { start: string; end: string };
      imported: number;
      skipped: number;
      /** Only the kinds not yet reported on this account. */
      dropped: DroppedCount[];
      issues: ParseIssue[];
    };

export function detectFormat(text: string): ImportFormat | null {
  const head = text.slice(0, 4000);
  if (/<FlexQueryResponse\b/.test(head)) return "flex";
  if (/<html\b/i.test(head)) return "statement_html";
  return null;
}

/**
 * File -> parse -> plan -> one IndexedDB transaction. A parse error writes
 * nothing; a failure inside the transaction rolls everything back.
 */
export async function importFile(db: AppDatabase, account: AccountRecord, file: File): Promise<ImportReport> {
  const text = await readFileText(file);
  const source = detectFormat(text);
  if (!source) {
    return {
      status: "error",
      fileName: file.name,
      source: null,
      issues: [{ severity: "error", code: "normalization", detail: "Unrecognized file: expected a Flex query XML or an activity statement HTML" }],
    };
  }

  const target = { accountId: account.id, ibAccountId: account.ibAccountId };
  const parsed = source === "flex" ? parseFlexXml(text, target) : parseActivityStatement(text, target);
  if (hasErrors(parsed.issues) || !parsed.statement) {
    return { status: "error", fileName: file.name, source, issues: parsed.issues };
  }
  const period =
    "fromDate" in parsed.statement
      ? { start: parsed.statement.fromDate, end: parsed.statement.toDate }
      : { start: parsed.statement.periodStart, end: parsed.statement.periodEnd };

  const existing = await db.transactions.where("accountId").equals(account.id).toArray();
  const plan = planImport(existing, { source, transactions: parsed.transactions, period });
  const newlyDropped = plan.dropped.filter((d) => !account.warnedDroppedKinds.includes(d.kind));
  const at = new Date().toISOString();

  await db.transaction("rw", db.transactions, db.imports, db.accounts, async () => {
    await db.transactions.bulkDelete(plan.delete.map((externalId) => [account.id, externalId]));
    await db.transactions.bulkPut(plan.upsert);
    await db.imports.add({
      accountId: account.id,
      source,
      at,
      fileName: file.name,
      period,
      imported: plan.upsert.length,
      skipped: plan.skipped,
      dropped: plan.dropped,
      issues: parsed.issues,
    });
    if (newlyDropped.length > 0) {
      await db.accounts.update(account.id, {
        warnedDroppedKinds: [...account.warnedDroppedKinds, ...newlyDropped.map((d) => d.kind)],
      });
    }
  });

  return {
    status: "ok",
    fileName: file.name,
    source,
    period,
    imported: plan.upsert.length,
    skipped: plan.skipped,
    dropped: newlyDropped,
    issues: parsed.issues,
  };
}
```

Vite doit pouvoir servir les fixtures d'un autre paquet : si `?raw` échoue sous Vitest avec « outside of Vite serving allow list », ajouter à `vite.config.ts` :

```ts
server: { host: "127.0.0.1", fs: { allow: [`${import.meta.dirname}/../..`] } },
```

- [ ] **Étape 3 : vérifier et committer**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm lint
git add apps/web
git commit -m "feat(web): import d'un fichier Flex ou relevé dans le ledger, en une transaction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---
## Tâche 14 : coquille, navigation, comptes et routes

**Files:**
- Create: `apps/web/src/lib/navigation.ts`, `apps/web/src/components/AccountSwitcher.tsx`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/routes/RootRedirect.tsx`, `apps/web/src/pages/AccountsPage.tsx`, `apps/web/src/pages/UnknownAccountPage.tsx`
- Modify: `apps/web/src/routes/router.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`
- Test: `apps/web/src/routes/AppLayout.test.tsx`, `apps/web/src/routes/RootRedirect.test.tsx`, `apps/web/src/components/AccountSwitcher.test.tsx`, `apps/web/src/pages/AccountsPage.test.tsx`

**Interfaces:**
- Consumes: `useAccounts`, `useAccount`, `createAccount`, `AccountError`, `getLastAccountId`, `setLastAccountId`, `db`.
- Produces: `NAV_SECTIONS`, `findNavItem(pathname, accountId)`, routes du §6.2 du spec.

- [ ] **Étape 1 : i18n**

Ajouter aux deux fichiers (valeurs en puis fr) :

```json
"common": { "loading": "Loading…" | "Chargement…", "cancel": "Cancel" | "Annuler" },
"accounts": {
  "title": "Accounts" | "Comptes",
  "empty": "No account yet. Create the first one below." | "Aucun compte pour l'instant. Créez le premier ci-dessous.",
  "label": "Label" | "Libellé",
  "ibAccountId": "IB account id" | "Identifiant de compte IB",
  "ibAccountIdHint": "As shown in the Client Portal, e.g. U1234567" | "Tel qu'affiché dans le Client Portal, ex. U1234567",
  "create": "Create the account" | "Créer le compte",
  "open": "Open" | "Ouvrir",
  "add": "Add an account…" | "Ajouter un compte…",
  "errors": {
    "label-empty": "The label must contain at least one letter or digit." | "Le libellé doit contenir au moins une lettre ou un chiffre.",
    "ib-account-id-invalid": "This does not look like an IB account id." | "Ce n'est pas un identifiant de compte IB.",
    "slug-taken": "An account with this label already exists." | "Un compte porte déjà ce libellé."
  }
},
"unknownAccount": {
  "title": "Unknown account" | "Compte inconnu",
  "hint": "No account matches {{id}} on this device." | "Aucun compte ne correspond à {{id}} sur cet appareil.",
  "link": "Manage accounts" | "Gérer les comptes"
}
```

- [ ] **Étape 2 : navigation et sélecteur**

`apps/web/src/lib/navigation.ts` :

```ts
import {
  Bird,
  CalendarClock,
  CalendarRange,
  Coins,
  Database,
  History,
  LayoutDashboard,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  labelKey: string;
  icon: LucideIcon;
  /** Account-less entries (Settings) ignore the account id. */
  to: (accountId: string) => string;
}

export interface NavSection {
  labelKey: string;
  items: readonly NavItem[];
}

function accountPath(path: string) {
  return (accountId: string) => `/accounts/${accountId}/${path}`;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    labelKey: "nav.sections.overview",
    items: [
      { labelKey: "nav.dashboard", icon: LayoutDashboard, to: accountPath("dashboard") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions") },
      { labelKey: "nav.history", icon: History, to: accountPath("history") },
      { labelKey: "nav.today", icon: CalendarClock, to: accountPath("today") },
    ],
  },
  {
    labelKey: "nav.sections.strategies",
    items: [
      { labelKey: "nav.wheel", icon: Coins, to: accountPath("journal/wheel") },
      { labelKey: "nav.leaps", icon: CalendarRange, to: accountPath("journal/leaps") },
      { labelKey: "nav.condors", icon: Bird, to: accountPath("journal/condors") },
    ],
  },
  {
    labelKey: "nav.sections.configuration",
    items: [
      { labelKey: "nav.sources", icon: Database, to: accountPath("sources") },
      { labelKey: "nav.settings", icon: Settings, to: () => "/settings" },
    ],
  },
] as const;

/** The nav entry a path belongs to, used to title pages outside the account scope. */
export function findNavItem(pathname: string, accountId: string): NavItem | undefined {
  return NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.to(accountId) === pathname);
}
```

`apps/web/src/components/AccountSwitcher.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import type { AccountRecord } from "@/db/schema";

const ADD_ACCOUNT = "__add__";

interface AccountSwitcherProps {
  accountId: string;
  accounts: readonly AccountRecord[];
}

export function AccountSwitcher({ accountId, accounts }: AccountSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function handleChange(next: string | null) {
    if (next === ADD_ACCOUNT) navigate("/accounts");
    else if (next) navigate(`/accounts/${next}/dashboard`);
  }

  return (
    <Select value={accountId} onValueChange={handleChange}>
      <SelectTrigger className="w-full font-medium" aria-label={t("accountSwitcher.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.id}
          </SelectItem>
        ))}
        <SelectItem value={ADD_ACCOUNT}>{t("accounts.add")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

`apps/web/src/components/app-sidebar.tsx` : copier `$OLD/src/components/app-sidebar.tsx`, puis :
- remplacer les imports `@/components/ui/sidebar` par `@ib/ui/sidebar` ;
- remplacer `import type { AccountId } from "@/types/riskReport";` par `import type { AccountRecord } from "@/db/schema";` ;
- `interface AppSidebarProps { accountId: string; accounts: readonly AccountRecord[]; }` et `<AccountSwitcher accountId={accountId} accounts={accounts} />`.

Le reste du fichier est inchangé.

- [ ] **Étape 3 : layout, redirection, comptes**

`apps/web/src/routes/AppLayout.tsx` :

```tsx
import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Separator } from "@ib/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@ib/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAccounts } from "@/db/hooks";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";
import { findNavItem } from "@/lib/navigation";
import { UnknownAccountPage } from "@/pages/UnknownAccountPage";

export function AppLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const accounts = useAccounts();
  const scoped = accountId !== undefined && accounts?.some((a) => a.id === accountId) ? accountId : null;

  useEffect(() => {
    if (scoped) setLastAccountId(scoped);
  }, [scoped]);

  if (accounts === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // Configuration pages live outside the account scope; they still need an
  // account to point the rest of the nav at. Without any account there is
  // nothing to show but the accounts page.
  const remembered = getLastAccountId();
  const navAccountId =
    scoped ?? (remembered && accounts.some((a) => a.id === remembered) ? remembered : accounts[0]?.id) ?? null;
  if (navAccountId === null) return <Navigate to="/accounts" replace />;

  const pageLabelKey = findNavItem(location.pathname, navAccountId)?.labelKey;

  return (
    <SidebarProvider>
      <AppSidebar accountId={navAccountId} accounts={accounts} />
      <SidebarInset>
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
      </SidebarInset>
    </SidebarProvider>
  );
}
```

`apps/web/src/pages/UnknownAccountPage.tsx` :

```tsx
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";

export function UnknownAccountPage({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("unknownAccount.title")}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("unknownAccount.hint", { id })}</p>
          <Button variant="outline" render={<Link to="/accounts" />}>
            {t("unknownAccount.link")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

`apps/web/src/routes/RootRedirect.tsx` :

```tsx
import { Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAccounts } from "@/db/hooks";
import { getLastAccountId } from "@/lib/accountStorage";

export function RootRedirect() {
  const { t } = useTranslation();
  const accounts = useAccounts();
  if (accounts === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  const remembered = getLastAccountId();
  const target = accounts.find((a) => a.id === remembered) ?? accounts[0];
  return <Navigate to={target ? `/accounts/${target.id}/dashboard` : "/accounts"} replace />;
}
```

`apps/web/src/pages/AccountsPage.tsx`, page autonome sans barre latérale :

```tsx
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountError, createAccount } from "@/db/accounts";
import { useAccounts } from "@/db/hooks";
import { db } from "@/db/schema";

export function AccountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const [label, setLabel] = useState("");
  const [ibAccountId, setIbAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const account = await createAccount(db, { label, ibAccountId });
      navigate(`/accounts/${account.id}/sources`);
    } catch (e) {
      if (e instanceof AccountError) setError(t(`accounts.errors.${e.code}`));
      else throw e;
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("accounts.title")}</h1>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          {accounts && accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("accounts.empty")}</p>
          )}
          {accounts?.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{account.label}</div>
                <div className="font-mono text-xs text-muted-foreground">{account.ibAccountId}</div>
              </div>
              <Button variant="outline" size="sm" render={<Link to={`/accounts/${account.id}/dashboard`} />}>
                {t("accounts.open")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("accounts.create")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("accounts.label")}
              <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("accounts.ibAccountId")}
              <Input value={ibAccountId} onChange={(e) => setIbAccountId(e.target.value)} placeholder="U1234567" required />
            </label>
            <p className="-mt-2 text-xs text-muted-foreground">{t("accounts.ibAccountIdHint")}</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit">{t("accounts.create")}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

`apps/web/src/routes/router.tsx` :

```tsx
import { Navigate, createBrowserRouter } from "react-router";
import { AppLayout } from "@/routes/AppLayout";
import { RootRedirect } from "@/routes/RootRedirect";
import { AccountsPage } from "@/pages/AccountsPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { SourcesPage } from "@/pages/SourcesPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";

export const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },
  { path: "/accounts", element: <AccountsPage /> },
  {
    path: "/accounts/:accountId",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: "dashboard", element: <PlaceholderPage titleKey="nav.dashboard" /> },
      { path: "positions", element: <PlaceholderPage titleKey="nav.positions" /> },
      { path: "history", element: <HistoryPage /> },
      { path: "today", element: <PlaceholderPage titleKey="nav.today" /> },
      { path: "journal/wheel", element: <PlaceholderPage titleKey="nav.wheel" /> },
      { path: "journal/leaps", element: <PlaceholderPage titleKey="nav.leaps" /> },
      { path: "journal/condors", element: <PlaceholderPage titleKey="nav.condors" /> },
      { path: "sources", element: <SourcesPage /> },
      // Kept so bookmarks of the former "Primes" screen keep working.
      { path: "premiums", element: <Navigate to="../journal/wheel" replace /> },
    ],
  },
  {
    path: "/settings",
    element: <AppLayout />,
    children: [{ index: true, element: <PlaceholderPage titleKey="nav.settings" /> }],
  },
]);
```

`HistoryPage` et `SourcesPage` n'existent pas encore : créer deux fichiers provisoires qui rendent `<PlaceholderPage titleKey="nav.history" />` et `<PlaceholderPage titleKey="nav.sources" />`, remplacés aux tâches 15 et 16. Mettre à jour `App.test.tsx` : avec aucune base, `/` mène à `/accounts`, donc l'assertion devient `await screen.findByText("Comptes")`.

- [ ] **Étape 4 : tests**

`apps/web/src/routes/AppLayout.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { AppLayout } from "@/routes/AppLayout";

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounts" element={<div>accounts page</div>} />
          <Route path="/accounts/:accountId" element={<AppLayout />}>
            <Route path="dashboard" element={<div>dashboard content</div>} />
          </Route>
          <Route path="/settings" element={<AppLayout />}>
            <Route index element={<div>settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function navHrefs() {
  return screen.getAllByRole("link").map((el) => el.getAttribute("href"));
}

const account = (id: string, ib: string) => ({ id, label: id, ibAccountId: ib, createdAt: "", warnedDroppedKinds: [] });

beforeEach(async () => {
  window.localStorage.clear();
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.imports.clear()]);
  await db.accounts.bulkAdd([account("beta", "U0000002"), account("alpha", "U0000001")]);
});

describe("AppLayout", () => {
  it("renders the child route for a known account", async () => {
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
  });

  it("shows the nav entry for every screen, scoped to the current account", async () => {
    renderAt("/accounts/beta/dashboard");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
    expect(navHrefs()).toEqual([
      "/accounts/beta/dashboard",
      "/accounts/beta/positions",
      "/accounts/beta/history",
      "/accounts/beta/today",
      "/accounts/beta/journal/wheel",
      "/accounts/beta/journal/leaps",
      "/accounts/beta/journal/condors",
      "/accounts/beta/sources",
      "/settings",
    ]);
  });

  it("remembers the visited account", async () => {
    renderAt("/accounts/beta/dashboard");
    await screen.findByText("dashboard content");
    expect(window.localStorage.getItem("ib2:lastAccountId")).toBe("beta");
  });

  it("points the account-less settings route at the last visited account", async () => {
    window.localStorage.setItem("ib2:lastAccountId", "beta");
    renderAt("/settings");
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(navHrefs()[0]).toBe("/accounts/beta/dashboard");
  });

  it("shows the unknown-account page, with the nav, for an id that does not exist", async () => {
    renderAt("/accounts/nope/dashboard");
    expect(await screen.findByText("Compte inconnu")).toBeInTheDocument();
    expect(screen.queryByText("dashboard content")).toBeNull();
    expect(screen.getByRole("link", { name: "Gérer les comptes" })).toHaveAttribute("href", "/accounts");
  });

  it("sends the settings route to the accounts page when there is no account at all", async () => {
    await db.accounts.clear();
    renderAt("/settings");
    expect(await screen.findByText("accounts page")).toBeInTheDocument();
  });
});
```

`apps/web/src/routes/RootRedirect.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { RootRedirect } from "@/routes/RootRedirect";

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderRoot() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const account = (id: string) => ({ id, label: id, ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });

beforeEach(async () => {
  window.localStorage.clear();
  await db.accounts.clear();
});

describe("RootRedirect", () => {
  it("goes to the accounts page when there is no account", async () => {
    renderRoot();
    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts");
  });

  it("goes to the last visited account, else the first one", async () => {
    await db.accounts.bulkAdd([account("a"), account("b")]);
    window.localStorage.setItem("ib2:lastAccountId", "b");
    renderRoot();
    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts/b/dashboard");
  });

  it("ignores a remembered account that no longer exists", async () => {
    await db.accounts.bulkAdd([account("a")]);
    window.localStorage.setItem("ib2:lastAccountId", "gone");
    renderRoot();
    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts/a/dashboard");
  });
});
```

`apps/web/src/components/AccountSwitcher.test.tsx` :

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { AccountSwitcher } from "@/components/AccountSwitcher";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

const accounts = [
  { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] },
  { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] },
];

function renderSwitcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts/alpha/dashboard"]}>
        <LocationProbe />
        <Routes>
          <Route path="*" element={<AccountSwitcher accountId="alpha" accounts={accounts} />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("AccountSwitcher", () => {
  it("navigates to the other account's dashboard when selected", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("beta"));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts/beta/dashboard");
  });

  it("offers to add an account", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Ajouter un compte…"));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
  });
});
```

`apps/web/src/pages/AccountsPage.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { AccountsPage } from "@/pages/AccountsPage";

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts"]}>
        <Probe />
        <Routes>
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await db.accounts.clear();
});

describe("AccountsPage", () => {
  it("says there is no account yet", async () => {
    renderPage();
    expect(await screen.findByText(/Aucun compte pour l'instant/)).toBeInTheDocument();
  });

  it("creates an account and lands on its data sources", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Libellé"), "Beta");
    await user.type(screen.getByLabelText("Identifiant de compte IB"), "u1234567");
    await user.click(screen.getByRole("button", { name: "Créer le compte" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/accounts/beta/sources"));
    expect(await db.accounts.get("beta")).toMatchObject({ ibAccountId: "U1234567" });
  });

  it("shows the error for a bad IB id and creates nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Libellé"), "x");
    await user.type(screen.getByLabelText("Identifiant de compte IB"), "nope");
    await user.click(screen.getByRole("button", { name: "Créer le compte" }));
    expect(await screen.findByText("Ce n'est pas un identifiant de compte IB.")).toBeInTheDocument();
    expect(await db.accounts.count()).toBe(0);
  });

  it("lists existing accounts with a link to open them", async () => {
    await db.accounts.add({ id: "alpha", label: "Alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
    renderPage();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir" })).toHaveAttribute("href", "/accounts/alpha/dashboard");
  });
});
```

- [ ] **Étape 5 : vérifier et committer**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm lint
git add apps/web
git commit -m "feat(web): coquille copiée, navigation finale, comptes en IndexedDB et routes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 15 : page Historique sur le ledger

**Files:**
- Replace: `apps/web/src/pages/HistoryPage.tsx`
- Test: `apps/web/src/pages/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `useLedger`, `runningBalances`, `matchesFilter`, `TRANSACTION_KINDS`, `LedgerRow`, `formatAmount`, `formatDateTime`, `formatPrice`.

- [ ] **Étape 1 : tests**

`apps/web/src/pages/HistoryPage.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { HistoryPage } from "@/pages/HistoryPage";
import { SAMPLE_DEPOSIT, SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

function renderHistory(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/history`]}>
        <Routes>
          <Route path="/accounts/:accountId/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// Column order: date, type, symbol, quantity, price, total price, fee, cash,
// currency, USD cash, EUR cash.
const CASH_CELL = 7;
const CURRENCY_CELL = 8;
const USD_CASH_CELL = 9;
const EUR_CASH_CELL = 10;

async function rowFor(text: string | RegExp): Promise<HTMLTableRowElement> {
  const cell = await screen.findByText(text);
  return cell.closest("tr") as HTMLTableRowElement;
}

function rowSymbols(): string[] {
  return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent ?? "");
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.accounts.clear()]);
});

async function seed(rows: Transaction[] = SAMPLE_TRANSACTIONS) {
  await db.transactions.bulkAdd(rows);
}

// The shared `@/i18n` singleton defaults to French: page strings are asserted in French.
describe("HistoryPage", () => {
  it("renders every transaction of the account as a row, newest first", async () => {
    await seed();
    renderHistory();
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(rowSymbols()).toEqual(["AAPL", "MSFT", "TSLA", "ELECTRONIC FUND TRANSFER"]);
  });

  it("never shows another account's rows", async () => {
    await seed([{ ...SAMPLE_TRANSACTIONS[0], accountId: "beta" }]);
    renderHistory("alpha");
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
  });

  it("shows the cash impact and its currency, without a hardcoded dollar sign", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[CASH_CELL]).toHaveTextContent("-18,051.50");
    expect(cells[CASH_CELL]).not.toHaveTextContent("$");
    expect(cells[CURRENCY_CELL]).toHaveTextContent("USD");
  });

  it("computes the running balances over the whole ledger and carries both currencies on every row", async () => {
    await seed();
    renderHistory();
    const deposit = within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell");
    expect(deposit[USD_CASH_CELL]).toHaveTextContent("0.00");
    expect(deposit[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
    expect(aapl[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("keeps the balances of the whole ledger when a filter hides earlier rows", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Filtrer par symbole…"), "AAPL");
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL"]));
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
  });

  it("warns on the balance headers that the level is only as deep as the history", async () => {
    await seed();
    renderHistory();
    const usdHeader = await screen.findByRole("columnheader", { name: "Cash USD" });
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("décalé"));
    expect(screen.getByRole("columnheader", { name: "Cash EUR" })).toHaveAttribute("title", expect.stringContaining("décalé"));
  });

  it("labels each transaction with its translated kind and falls back to the description without a symbol", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("Dépôt/Retrait");
    expect(cells[CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("filters by kind and drops the filter again on All types", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Dépôt/Retrait" }));
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER"]));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Tous les types" }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("filters by date range, inclusive", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    fireEvent.change(screen.getByLabelText("Date de début"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Date de fin"), { target: { value: "2026-08-27" } });
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT", "TSLA"]));
  });

  it("paginates 30 rows per page and goes back to page 1 when a filter changes", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      ...SAMPLE_TRANSACTIONS[0],
      externalId: `flex:trade:${100 + i}`,
      symbol: `SYM${i}`,
      when: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    await seed(many);
    renderHistory();
    await screen.findByText("Page 1 / 2");
    expect(rowSymbols()).toHaveLength(30);
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await screen.findByText("Page 2 / 2")).toBeInTheDocument();
    expect(rowSymbols()).toHaveLength(15);
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Filtrer par symbole…"), "SYM1");
    expect(await screen.findByText("Page 1 / 1")).toBeInTheDocument();
  });

  it("renders a dash for an unknown amount instead of 0.00", async () => {
    await seed([{ ...SAMPLE_DEPOSIT, amount: 10000 }, { ...SAMPLE_TRANSACTIONS[0], symbol: "SNZA", price: null, amount: null, commission: null }]);
    renderHistory();
    const row = await rowFor("SNZA");
    const cells = within(row).getAllByRole("cell");
    expect(cells[4]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
    expect(cells[CASH_CELL]).toHaveTextContent("—");
    expect(cells[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("shows a no-results message on an empty ledger", async () => {
    renderHistory();
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
  });

  it("follows the ledger: a row written later appears without reloading", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:new", symbol: "NEW", when: "2026-09-01T00:00:00.000Z" });
    expect(await screen.findByText("NEW")).toBeInTheDocument();
  });
});
```

- [ ] **Étape 2 : vérifier l'échec, implémenter**

```bash
pnpm --filter web test -- HistoryPage
```

`apps/web/src/pages/HistoryPage.tsx` :

```tsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { TRANSACTION_KINDS, matchesFilter, runningBalances, type LedgerRow, type TransactionKind } from "@ib/ledger";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { useLedger } from "@/db/hooks";
import { formatAmount, formatDateTime, formatPrice } from "@/lib/format";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;
/** The two balance columns of the table; the ledger itself is currency-agnostic. */
const BALANCE_CURRENCIES = ["USD", "EUR"] as const;

export function HistoryPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const ledger = useLedger(accountId);
  const [searchInput, setSearchInput] = useState("");
  const [symbol, setSymbol] = useState("");
  // null means "every kind" — the history is a cash-flow view by default.
  const [kind, setKind] = useState<TransactionKind | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setSymbol(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [symbol, kind, startDate, endDate]);

  // Balances run over the whole ledger, oldest first; the table shows newest first.
  const rows = useMemo(
    () => (ledger ? runningBalances(ledger, BALANCE_CURRENCIES).reverse() : undefined),
    [ledger],
  );
  const filtered = useMemo(
    () =>
      rows?.filter((row) =>
        matchesFilter(row.transaction, {
          symbol: symbol || undefined,
          kind,
          from: startDate || undefined,
          to: endDate || undefined,
        }),
      ),
    [rows, symbol, kind, startDate, endDate],
  );

  if (!filtered) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.history")}</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("history.filterPlaceholder")}
          aria-label={t("history.filterPlaceholder")}
          className="max-w-xs"
        />
        <Select value={kind} onValueChange={(next: TransactionKind | null) => setKind(next)}>
          <SelectTrigger className="w-52" aria-label={t("history.kindFilter")}>
            <SelectValue>
              {(value: TransactionKind | null) => (value ? t(`history.kinds.${value}`) : t("history.allKinds"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>{t("history.allKinds")}</SelectItem>
            {TRANSACTION_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`history.kinds.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-label={t("history.startDate")} className="w-auto" />
        <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-label={t("history.endDate")} className="w-auto" />
      </div>

      {pageRows.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("history.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {pageRows.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("history.columns.dateTime")}</TableHead>
                  <TableHead>{t("history.columns.type")}</TableHead>
                  <TableHead>{t("history.columns.symbol")}</TableHead>
                  <TableHead className="text-right">{t("history.columns.quantity")}</TableHead>
                  <TableHead className="text-right">{t("history.columns.price")}</TableHead>
                  <TableHead className="text-right">{t("history.columns.totalPrice")}</TableHead>
                  <TableHead className="text-right">{t("history.columns.fee")}</TableHead>
                  <TableHead className="text-right">{t("history.columns.cash")}</TableHead>
                  <TableHead>{t("history.columns.currency")}</TableHead>
                  {/* The level of these two is only as deep as the imported
                      history; say so, or the gap against TWS reads as a bug. */}
                  <TableHead className="text-right" title={t("history.columns.balanceHint")}>
                    {t("history.columns.usdCash")}
                  </TableHead>
                  <TableHead className="text-right" title={t("history.columns.balanceHint")}>
                    {t("history.columns.eurCash")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TransactionRow key={row.transaction.externalId} row={row} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setPage((current) => current - 1)} disabled={page <= 1}>
          {t("history.pagination.previous")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("history.pagination.pageOf", { page, total: totalPages })}
        </span>
        <Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={page >= totalPages}>
          {t("history.pagination.next")}
        </Button>
      </div>
    </div>
  );
}

function TransactionRow({ row }: { row: LedgerRow }) {
  const { t } = useTranslation();
  const { transaction, cash, balances } = row;
  // Cash movements (deposits, dividends, fees) carry no symbol; IB's own
  // description is the only thing that tells two of them apart.
  const label = transaction.symbol || transaction.description;
  return (
    <TableRow>
      <TableCell>{formatDateTime(transaction.when)}</TableCell>
      <TableCell className="text-muted-foreground">
        {t(`history.kinds.${transaction.kind}`, { defaultValue: transaction.kind })}
      </TableCell>
      {/* IB descriptions run up to 512 chars; keep one from stretching the row. */}
      <TableCell className="max-w-xs truncate font-medium" title={label}>
        {label}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{transaction.quantity ?? "—"}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {transaction.price === null ? "—" : formatPrice(transaction.price)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {transaction.amount === null ? "—" : formatAmount(transaction.amount)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {transaction.commission === null ? "—" : formatAmount(transaction.commission)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{cash === null ? "—" : formatAmount(cash)}</TableCell>
      <TableCell className="text-muted-foreground">{transaction.currency}</TableCell>
      {/* Running balances, not this row's impact: they are shown on every
          row, including one that moves the other currency. */}
      <TableCell className="text-right font-mono tabular-nums">{formatAmount(balances.USD)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatAmount(balances.EUR)}</TableCell>
    </TableRow>
  );
}
```

`formatAmount` de `format.ts` formate `-0` en `-0.00` ; si un test échoue sur `0.00` contre `-0.00`, normaliser dans `runningBalances` du ledger avec `+ 0` n'est pas correct (`-0 + 0` vaut `0`, ce qui convient) : préférer corriger dans `formatAmount` par `AMOUNT_FORMATTER.format(value === 0 ? 0 : value)`.

- [ ] **Étape 3 : vérifier et committer**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm lint
git add apps/web
git commit -m "feat(web): page Historique sur le ledger IndexedDB, soldes cumulés en mémoire

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 16 : page Sources de données

**Files:**
- Replace: `apps/web/src/pages/SourcesPage.tsx`
- Create: `apps/web/src/components/ImportReportCard.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`
- Test: `apps/web/src/pages/SourcesPage.test.tsx`

**Interfaces:**
- Consumes: `useAccount`, `useImports`, `importFile`, `deleteAccount`, `ImportReport`, `ImportRecord`, `ParseIssue`.

- [ ] **Étape 1 : i18n**

Ajouter aux deux fichiers :

```json
"sources": {
  "account": { "title": "Account" | "Compte", "label": "Label" | "Libellé", "ibAccountId": "IB account id" | "Identifiant IB" },
  "import": {
    "title": "Import a file" | "Importer un fichier",
    "hint": "A Flex query response (XML) or an activity statement exported as HTML from the Client Portal. Flex owns its own date range; a statement only fills the history before it." | "Une réponse de Flex Query (XML) ou un relevé d'activité exporté en HTML depuis le Client Portal. Flex est propriétaire de sa plage de dates ; un relevé ne remplit que l'historique d'avant.",
    "button": "Import a file" | "Importer un fichier",
    "importing": "Importing…" | "Import en cours…"
  },
  "report": {
    "ok": "Import done." | "Import terminé.",
    "error": "Import cancelled, nothing was written." | "Import annulé, rien n'a été écrit.",
    "source": "Source" | "Source",
    "period": "Period" | "Période",
    "imported": "Imported rows" | "Lignes importées",
    "skipped": "Rows skipped (owned by Flex)" | "Lignes ignorées (plage Flex)",
    "dropped": "Rows removed from other sources" | "Lignes retirées des autres sources",
    "droppedHint": "Flex replaced this range. Kinds listed here are not exported by your Flex query: tick their sections in the Client Portal or they only live in statements." | "Flex a remplacé cette plage. Les types listés ne sont pas exportés par votre Flex Query : cochez leurs sections dans le Client Portal, sinon ils ne vivent que dans les relevés.",
    "issues": "Warnings" | "Avertissements",
    "sources": { "flex": "Flex query" | "Flex Query", "statement_html": "Activity statement" | "Relevé d'activité" }
  },
  "issues": {
    "account-mismatch": "File of another account" | "Fichier d'un autre compte",
    "section-missing": "Section missing" | "Section absente",
    "section-unread": "Section present but not read" | "Section présente mais non lue",
    "column-missing": "Column missing from the query" | "Colonne absente de la requête",
    "unknown-cash-type": "Unknown cash transaction type" | "Type de mouvement de cash inconnu",
    "unknown-asset-category": "Unknown asset category" | "Catégorie d'actif inconnue",
    "row-skipped": "Row skipped" | "Ligne ignorée",
    "normalization": "Unreadable value" | "Valeur illisible"
  },
  "history": {
    "title": "Past imports" | "Imports passés",
    "empty": "Nothing imported yet." | "Rien n'a encore été importé.",
    "columns": { "date": "Date" | "Date", "source": "Source" | "Source", "file": "File" | "Fichier", "period": "Period" | "Période", "rows": "Rows" | "Lignes", "warnings": "Warnings" | "Avertissements" }
  },
  "delete": {
    "title": "Delete this account" | "Supprimer ce compte",
    "hint": "Removes the account and every transaction imported for it on this device." | "Supprime le compte et toutes les transactions importées pour lui sur cet appareil.",
    "button": "Delete the account" | "Supprimer le compte",
    "confirm": "Delete account {{label}} and all its data on this device?" | "Supprimer le compte {{label}} et toutes ses données sur cet appareil ?"
  }
}
```

- [ ] **Étape 2 : tests**

`apps/web/src/pages/SourcesPage.test.tsx` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import flexXml from "../../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml?raw";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { SourcesPage } from "@/pages/SourcesPage";

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderSources(accountId = "test") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/sources`]}>
        <Probe />
        <Routes>
          <Route path="/accounts/:accountId/sources" element={<SourcesPage />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const account = { id: "test", label: "Test", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.imports.clear()]);
  await db.accounts.add(account);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function pickFile(content: string, name: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText("Importer un fichier") as HTMLInputElement;
  await user.upload(input, new File([content], name, { type: "text/xml" }));
}

describe("SourcesPage", () => {
  it("shows the account", async () => {
    renderSources();
    expect(await screen.findByText("U0000001")).toBeInTheDocument();
  });

  it("imports a Flex file and shows the report, then lists the import", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");

    expect(await screen.findByText("Import terminé.")).toBeInTheDocument();
    const report = screen.getByTestId("import-report");
    expect(within(report).getByText("Flex Query")).toBeInTheDocument();
    expect(within(report).getByText("2025-09-03 → 2026-09-02")).toBeInTheDocument();
    expect(within(report).getByText("Section absente")).toBeInTheDocument();
    expect(within(report).getByText("Open Positions")).toBeInTheDocument();

    const history = await screen.findByTestId("import-history");
    expect(within(history).getByText("flex.xml")).toBeInTheDocument();
    expect(await db.transactions.count()).toBeGreaterThan(0);
  });

  it("shows the error and writes nothing for a file of another account", async () => {
    await db.accounts.update("test", { ibAccountId: "U9999999" });
    renderSources();
    await screen.findByText("U9999999");
    await pickFile(flexXml, "flex.xml");

    expect(await screen.findByText("Import annulé, rien n'a été écrit.")).toBeInTheDocument();
    expect(screen.getByText("Fichier d'un autre compte")).toBeInTheDocument();
    expect(await db.transactions.count()).toBe(0);
    expect(screen.getByText("Rien n'a encore été importé.")).toBeInTheDocument();
  });

  it("deletes the account after confirmation and leaves for the accounts page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSources();
    await screen.findByText("U0000001");
    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer le compte" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/accounts"));
    expect(await db.accounts.count()).toBe(0);
  });

  it("keeps the account when the confirmation is refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSources();
    await screen.findByText("U0000001");
    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer le compte" }));
    expect(await db.accounts.count()).toBe(1);
  });
});
```

- [ ] **Étape 3 : vérifier l'échec, implémenter**

```bash
pnpm --filter web test -- SourcesPage
```

`apps/web/src/components/ImportReportCard.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import type { ParseIssue } from "@ib/ib-parsers";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import type { ImportReport } from "@/db/importFile";

export function formatPeriod(period: { start: string; end: string } | null): string {
  if (!period) return "—";
  return period.start === period.end ? period.start : `${period.start} → ${period.end}`;
}

export function IssueList({ issues }: { issues: readonly ParseIssue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {issues.map((issue, index) => (
        <li key={index} className={issue.severity === "error" ? "text-destructive" : "text-warning-foreground"}>
          <span className="font-medium">{t(`sources.issues.${issue.code}`)}</span>
          {" : "}
          <span className="font-mono text-xs">{issue.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function ImportReportCard({ report }: { report: ImportReport }) {
  const { t } = useTranslation();
  return (
    <Card data-testid="import-report">
      <CardHeader>
        <CardTitle className={report.status === "error" ? "text-destructive" : undefined}>
          {t(report.status === "ok" ? "sources.report.ok" : "sources.report.error")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("sources.report.source")}</dt>
          <dd>{report.source ? t(`sources.report.sources.${report.source}`) : "—"}</dd>
          {report.status === "ok" && (
            <>
              <dt className="text-muted-foreground">{t("sources.report.period")}</dt>
              <dd className="font-mono">{formatPeriod(report.period)}</dd>
              <dt className="text-muted-foreground">{t("sources.report.imported")}</dt>
              <dd className="font-mono">{report.imported}</dd>
              <dt className="text-muted-foreground">{t("sources.report.skipped")}</dt>
              <dd className="font-mono">{report.skipped}</dd>
              {report.dropped.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t("sources.report.dropped")}</dt>
                  <dd>
                    <span className="font-mono">
                      {report.dropped.map((d) => `${t(`history.kinds.${d.kind}`)}: ${d.count}`).join(", ")}
                    </span>
                    <p className="text-xs text-muted-foreground">{t("sources.report.droppedHint")}</p>
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        {report.issues.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">{t("sources.report.issues")}</div>
            <IssueList issues={report.issues} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

`apps/web/src/pages/SourcesPage.tsx` :

```tsx
import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { ImportReportCard, formatPeriod } from "@/components/ImportReportCard";
import { deleteAccount } from "@/db/accounts";
import { useAccount, useImports } from "@/db/hooks";
import { importFile, type ImportReport } from "@/db/importFile";
import { db } from "@/db/schema";
import { formatDateTime } from "@/lib/format";

export function SourcesPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const account = useAccount(accountId);
  const imports = useImports(accountId);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!account) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !account) return;
    setImporting(true);
    try {
      setReport(await importFile(db, account, file));
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete() {
    if (!account) return;
    if (!window.confirm(t("sources.delete.confirm", { label: account.label }))) return;
    await deleteAccount(db, account.id);
    navigate("/accounts");
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.sources")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("sources.account.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("sources.account.label")}</dt>
            <dd>{account.label}</dd>
            <dt className="text-muted-foreground">{t("sources.account.ibAccountId")}</dt>
            <dd className="font-mono">{account.ibAccountId}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sources.import.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("sources.import.hint")}</p>
          <input
            ref={fileInput}
            type="file"
            accept=".xml,.htm,.html,text/xml,application/xml,text/html"
            aria-label={t("sources.import.button")}
            className="sr-only"
            onChange={handleFile}
          />
          <div>
            <Button onClick={() => fileInput.current?.click()} disabled={importing}>
              {t(importing ? "sources.import.importing" : "sources.import.button")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {report && <ImportReportCard report={report} />}

      <Card data-testid="import-history">
        <CardHeader>
          <CardTitle>{t("sources.history.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {imports && imports.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("sources.history.empty")}</p>
          )}
          {imports && imports.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sources.history.columns.date")}</TableHead>
                  <TableHead>{t("sources.history.columns.source")}</TableHead>
                  <TableHead>{t("sources.history.columns.file")}</TableHead>
                  <TableHead>{t("sources.history.columns.period")}</TableHead>
                  <TableHead className="text-right">{t("sources.history.columns.rows")}</TableHead>
                  <TableHead className="text-right">{t("sources.history.columns.warnings")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{formatDateTime(record.at)}</TableCell>
                    <TableCell>{t(`sources.report.sources.${record.source}`)}</TableCell>
                    <TableCell className="max-w-xs truncate" title={record.fileName}>{record.fileName}</TableCell>
                    <TableCell className="font-mono">{formatPeriod(record.period)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{record.imported}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{record.issues.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sources.delete.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("sources.delete.hint")}</p>
          <div>
            <Button variant="destructive" onClick={handleDelete}>
              {t("sources.delete.button")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

Si `Button` de `@ib/ui/button` n'a pas de variante `destructive`, utiliser `variant="outline"` avec `className="text-destructive"`.

- [ ] **Étape 4 : vérifier et committer**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm lint
git add apps/web
git commit -m "feat(web): page Sources de données, import de fichier avec compte rendu, suppression de compte

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 17 : skill `run-frontend` et contrôle visuel côte à côte

**Files:**
- Create: `.claude/skills/run-frontend/SKILL.md`, `.claude/skills/run-frontend/driver.mjs`, `apps/web/src/mocks/seed.ts`

- [ ] **Étape 1 : amorce de démonstration**

`apps/web/src/mocks/seed.ts`, importé dynamiquement par le driver à travers Vite :

```ts
import { db } from "@/db/schema";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

/** Two accounts and a small ledger on `alpha`, for screenshots without any file. */
export async function seedDemo(): Promise<void> {
  await db.accounts.bulkPut([
    { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
    { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
  ]);
  await db.transactions.bulkPut(SAMPLE_TRANSACTIONS);
}
```

- [ ] **Étape 2 : driver**

Reprendre le driver `run-frontend` de la première version dans `.claude/skills/run-frontend/driver.mjs`, puis :

- remplacer l'en-tête d'options `--mock` par `--seed  seed IndexedDB with two demo accounts and a sample ledger (src/mocks/seed.ts)` ;
- `BASE` devient `http://127.0.0.1:${PORT}` et le commentaire CORS disparaît (plus de backend) ;
- `spawn("npx", ["vite", ...])` devient `spawn("pnpm", ["--filter", "web", "exec", "vite", "--port", String(PORT), "--strictPort"], { cwd: <racine du dépôt>, ... })` où la racine est calculée par `new URL("../../..", import.meta.url).pathname` ;
- supprimer `loadFixtures` et `stubApi`, et remplacer le bloc `if (has("mock")) {...}` par :

```js
if (has("seed")) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedDemo()));
}
```

- la détection `apiOnly` devient `const apiOnly = false;` (il n'y a plus d'API : toute erreur console est fatale).

`.claude/skills/run-frontend/SKILL.md` : reprendre l'ancien, adapté :

- chemins depuis la racine du dépôt, `playwright` est devDependency de `apps/web` (`pnpm --filter web exec playwright install chromium` la première fois) ;
- `node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history --seed` ;
- section « Pièges » : garder thème et menu offcanvas, supprimer les entrées CORS et `--mock`, ajouter « IndexedDB est par origine : `--seed` remplit `http://127.0.0.1:5173`, pas `localhost` » et « dans un worktree, `pnpm install` suffit, pas de lien `node_modules` ».

- [ ] **Étape 3 : captures et comparaison**

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history /accounts/alpha/sources /accounts --seed --out=/tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad/shots
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history --seed --dark --out=/tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad/shots
```

**Ouvrir chaque PNG avec l'outil Read** et le comparer au rendu de la première version, page
Historique avec ses fixtures : barre latérale (mêmes sections, Sources de données et Paramètres à la place de Portefeuilles), en-tête, filtres, colonnes de la table, alignements, polices, thème sombre. Corriger tout écart de rendu avant de continuer ; les données diffèrent, pas la mise en page.

- [ ] **Étape 4 : commit**

```bash
git add .claude/skills apps/web/src/mocks/seed.ts
git commit -m "chore: skill run-frontend adapté au monorepo, amorce de démonstration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

---

## Tâche 18 : acceptation sur données réelles

**Files:** aucun fichier versionné. Résultat consigné dans le message de la PR ou du merge.

- [ ] **Étape 1 : oracle `beta`**

Lancer le serveur de dev (`pnpm dev`, sur `http://127.0.0.1:5173`). Seb importe depuis son navigateur ; sans écran, le driver Playwright fait la même chose :

```bash
cat > /tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad/accept.mjs <<'EOF'
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`${BASE}/accounts`);
await page.getByLabel("Libellé").fill("beta");
await page.getByLabel("Identifiant de compte IB").fill(process.env.IB_ACCOUNT_ID);
await page.getByRole("button", { name: "Créer le compte" }).click();
await page.waitForURL(/\/accounts\/beta\/sources/);
await page.getByLabel("Importer un fichier").setInputFiles(process.env.FLEX_FILE);
await page.getByText("Import terminé.").waitFor();
await page.screenshot({ path: process.env.OUT + "/beta-sources.png", fullPage: true });
await page.goto(`${BASE}/accounts/beta/history`);
await page.getByLabel("Date de fin").fill("2026-09-01");
await page.waitForTimeout(500);
const firstRow = page.getByRole("row").nth(1);
console.log("last USD balance:", await firstRow.getByRole("cell").nth(9).textContent());
await page.screenshot({ path: process.env.OUT + "/beta-history.png", fullPage: true });
await browser.close();
EOF
cd apps/web && IB_ACCOUNT_ID=$(grep -o 'accountId="[^"]*"' ../../private/flex_<compte>_<date>.xml | head -1 | cut -d'"' -f2) \
  FLEX_FILE=$(realpath ../../private/flex_<compte>_<date>.xml) \
  OUT=/tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad \
  node /tmp/claude-1001/-home-seb-IA-IB-Analyzer2/f14ce816-9eef-425c-9968-5b7ce6092366/scratchpad/accept.mjs
```

Attendu : `last USD balance: 16,284.37`. Tout autre chiffre est un bug du port (ordre, conversion, section manquante), jamais de l'oracle : le corriger en TDD avec un cas ajouté aux fixtures anonymisées. **Ne pas coller de valeur réelle dans un test ni dans un commit.**

- [ ] **Étape 2 : chemin HTML sur `alpha`**

Même script, compte `alpha`, identifiant lu dans le relevé (`grep -o 'tbl[A-Za-z]*_[^"]*Body' private/SU10012345_2025_2025.htm | head -1`), fichier `private/SU10012345_2025_2025.htm`. Attendu : « Import terminé. », aucune erreur, et dans l'Historique une ligne `XSP` datée du 29 juillet 2025 avec `191.00` en cash. Pas d'oracle de niveau sur ce compte.

- [ ] **Étape 3 : rapport**

Noter dans le scratchpad les deux résultats et les avertissements affichés par la page Sources de données (sections manquantes de la Flex Query réelle) : ils sont repris dans le message de merge et servent de liste à cocher pour la Flex Query avant le sous-projet 2.

---

## Tâche 19 : documentation et fin de branche

**Files:**
- Modify: `CLAUDE.md`
- Create: `README.md`

- [ ] **Étape 1 : `README.md`**

````markdown
# IB Options Analyzer 2

Analyse de portefeuilles Interactive Brokers (actions + options) dans le navigateur.
Le serveur ne stocke aucune donnée de portefeuille. Architecture : `docs/specs/2026-09-03-architecture-design.md`.

## Démarrer

```bash
corepack enable --install-directory ~/.local/bin   # une fois, donne pnpm sans sudo
pnpm install
pnpm dev            # http://127.0.0.1:5173
pnpm check          # lint, typecheck, tests de tout l'espace de travail
```

## Utiliser sans serveur (palier 2)

1. Ouvrir l'application, créer un compte avec son libellé et son identifiant IB.
2. Sources de données : importer la réponse XML d'une Flex Query (Activity, Last 365 Days,
   sections Trades, Cash Transactions, Corporate Actions, Open Positions) et, pour l'historique
   antérieur, des relevés d'activité exportés en HTML depuis le Client Portal.
3. Historique : toutes les transactions, filtres, soldes cumulés USD et EUR.

Les données restent dans IndexedDB du navigateur. Rien ne quitte la machine.

## Structure

`apps/web` (SPA), `packages/ledger` (modèle et calculs), `packages/ib-parsers` (Flex XML,
relevé HTML), `packages/ui` (composants shadcn). Détail dans `CLAUDE.md`.
````

- [ ] **Étape 2 : `CLAUDE.md`**

- Table des sous-projets : ligne 1 passe à `fait (2026-09-xx)` avec la date du merge.
- Section « Outillage » : ajouter `corepack enable --install-directory ~/.local/bin` (node système, pas de sudo), `pnpm check` avant tout merge, et la règle de `packages/ui` : après `shadcn add`, réécrire les imports `@/` en relatifs (voir `packages/ui/README.md`).
- Section « Règles qui mordent » : ajouter « Un relevé HTML remplace ses propres lignes sur sa période déclarée ; les jumelles d'un même fichier sont suffixées `#2`, `#3` » et « `OptionCashSettlement` est importé en `trade` `OPT` sans quantité ; côté Flex ce cas n'est pas encore observé ».
- Section « Tests » : ajouter « `apps/web` teste sur `fake-indexeddb` avec un ledger semé en base, jamais en moquant les hooks ».
- Skill : `.claude/skills/run-frontend/` piloté depuis la racine, `--seed` à la place de `--mock`.

- [ ] **Étape 3 : vérification complète et commit**

```bash
pnpm check
git status
git add README.md CLAUDE.md
git commit -m "docs: README de démarrage, CLAUDE.md à jour du sous-projet 1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TpMePkmtKDUowT2gMLfEZF"
```

- [ ] **Étape 4 : fin de branche**

Invoquer `superpowers:finishing-a-development-branch` : revue de la branche complète, `pnpm check` vert, merge sur `main`, suppression du worktree.

---

## Auto-revue du plan

- **Couverture du spec** : §2 outillage → tâche 1 et 11 ; §3 ledger → tâches 1 à 4 ; §4.1 issues et garde-fou → tâches 5, 6, 8 ; §4.2 Flex → tâche 6 et 7 ; §4.3 et §4.4 relevé → tâches 8 et 9 ; §4.5 fixtures → tâches 7 et 8 ; §5 IndexedDB, comptes, import, hooks → tâches 12 et 13 ; §6 coquille, routes, Historique, Sources, création de compte → tâches 14 à 16 ; §7.1 tests → chaque tâche ; §7.2 manuel → tâches 17 et 18 ; skill `run-frontend` → tâche 17.
- **Hors périmètre respecté** : pas de Transfers, pas de Python, pas de Playwright de bout en bout, pas de renommage.
- **Cohérence des noms** : `planImport`, `runningBalances`, `matchesFilter`, `useLedger`, `importFile`, `ImportReport`, `AccountRecord`, `ImportRecord`, `statementExternalId`, `suffixTwins`, `parseFlexXml`, `parseActivityStatement`, `hasErrors` sont définis avant d'être consommés et portent le même nom partout.
