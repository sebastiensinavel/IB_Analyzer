# Sous-projet 9 — L'application complète avec un seul fichier : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'un relevé HTML seul, une réponse Flex seule, ou les deux, suffisent à remplir toute l'application : positions et cash lus dans le relevé, solde cumulé de l'Historique calé sur le cash de fin et vérifié contre le cash de début.

**Architecture:** Quatre couches, de bas en haut. (1) *Parseurs* : `parseActivityStatement` lit *Open Positions* et *Cash Report* ; les deux parseurs rendent un `cashReport` à deux points (début, fin) par devise, et un `FileSnapshot` partagé. (2) *Calcul* : `anchoredBalances` dans `packages/ledger/src/cash.ts` décale le solde brut pour finir sur le point de fin et mesure l'écart au point de début. (3) *Stockage* : le snapshot accepte la source `statement_html` ; une table Dexie `cashPoints` (version 6) garde la fin la plus récente et le début le plus ancien par devise ; import, relecture et purges les tiennent à jour. (4) *Pages* : une carte « Cohérence du cash » dans l'Historique, des textes d'état vide qui citent le relevé, un driver capable de simuler la première visite.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, Playwright (driver). Node 22, pnpm.

**Spec:** `docs/specs/2026-09-10-fichier-seul-design.md` (lire aussi `CLAUDE.md`, et `docs/specs/2026-09-03-couverture-positions-design.md` §5 pour le snapshot Flex existant).

## Global Constraints

- **Le serveur ne voit jamais** transactions, positions ni cash. Aucun modèle, endpoint ni migration dans `apps/api`. Une tâche qui semble en réclamer un est un signal d'arrêt.
- **Le §13 du spec d'architecture n'est pas rouvert** : les positions sont *lues* dans un fichier IB, jamais dérivées du ledger.
- **Propriété de plage inchangée** (spec d'architecture §6.2) : ce sous-projet n'écrit aucune transaction nouvelle et ne touche pas `planImport`.
- **Seuls les fichiers écrivent des points de cash**, jamais l'agent (spec §4.2).
- **Point de fin : le plus récent gagne (`>=`) ; point de début : le plus ancien gagne (`<=`)** ; à égalité, le fichier entrant l'emporte (spec §4.2).
- **Un snapshot de relevé suit exactement la règle d'un fichier Flex** : `shouldReplaceSnapshot` (spec §4.1).
- **Une ligne illisible d'*Open Positions* supprime le snapshot, jamais le fichier** (spec §3.2).
- **`CASH_CHECK_TOLERANCE = 1`** est défini une seule fois, dans `packages/ledger/src/cash.ts` (spec §5).
- **L'écart est arrondi au centime, et jamais `-0`** (spec §5).
- **Les écarts des options renommées sans Flex sont figés, pas corrigés** (spec §2.5) : 4 différences et 1 orphelin sur alpha, relevés seuls. Le sous-projet 10 les traitera ; ici, ne pas y toucher.
- **Aucun identifiant de compte, jeton, montant réel ni ticker réel dans un fichier versionné.** Les tests privés lisent l'identifiant dans le fichier ; les commandes désignent les relevés réels par un motif shell (`private/U*_2026*.htm`), jamais par leur nom.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ». Un point de cash absent n'est pas un montant nul.
- **`packages/ledger` n'émet aucun texte visible** ; toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`, avec les mêmes clés dans les deux langues.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, jamais en moquant les hooks.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K
  ```
- Le travail se fait dans un worktree `.claude/worktrees/fichier-seul` (skill `superpowers:using-git-worktrees`), branche `fichier-seul`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
packages/ib-parsers/
  src/snapshot.ts                           NOUVEAU  FileSnapshot, CashPointValues, CashReport,
                                                     CURRENCY_CODE_RE
  src/index.ts                                       + export de snapshot.ts
  src/flex.ts (+ test)                               FlexSnapshot -> FileSnapshot, cashReport
  src/statement.ts (+ test)                          readSection(summaryRowsOnly), cashReport,
                                                     snapshot (Open Positions)
  src/corpus.test.ts                                 positions et Cash Report du corpus
  src/corpus.oracle.test.ts                          commentaire devenu faux, corrigé
  src/cash.oracle.test.ts                   NOUVEAU  corpus rejoué, écart USD ≤ tolérance
  src/cash.private.test.ts                  NOUVEAU  beta, Flex seul, écart nul au centime
  tests/fixtures/activity_statement_sample.htm       + Open Positions, + Cash Report (en fin de fichier)

packages/ledger/src/
  cash.ts (+ test)                                   CashPoint, CashCheck, CASH_CHECK_TOLERANCE,
                                                     anchoredBalances, isCashCheckOk

apps/web/src/
  db/schema.ts (+ test)                              SnapshotRecord.source, CashPointRecord,
                                                     version 6 (cashPoints)
  db/cashPoints.ts (+ test)                 NOUVEAU  mergeCashPoints
  db/importFile.ts (+ test)                          snapshot de relevé, points de cash
  db/replayStatements.ts (+ test)                    snapshot et points reconstruits
  db/clearDerived.ts (+ test)                        purge cashPoints
  db/accounts.ts (+ test)                            deleteAccount purge cashPoints
  db/hooks.ts                                        useCashPoints
  db/alpha.private.test.ts                         relevés seuls, relevé récent seul
  components/CashCheckCard.tsx (+ test)     NOUVEAU  carte « Cohérence du cash »
  pages/HistoryPage.tsx (+ test)                     soldes calés, carte
  pages/PositionsPage.test.tsx, DashboardPage.test.tsx   textes d'état vide
  components/SnapshotStatus.test.tsx                 snapshot de relevé daté
  pages/SourcesPage.test.tsx                         purge des points
  mocks/seed.ts (+ test)                             seedAccounts, points de démo cohérents
  i18n/fr.json, i18n/en.json                         cashCheck.*, balanceHint, positions.empty,
                                                     reconciliation.none, sources.import.hint,
                                                     sources.purge.*

.claude/skills/run-frontend/
  driver.mjs                                         --empty, --import= répétable
  SKILL.md                                           options et scénarios « un seul fichier »

docs/
  specs/2026-09-03-architecture-design.md            note du 2026-09-10 au §2
  specs/2026-09-10-fichier-seul-design.md            statut
  points-reportes.md                                 section du sous-projet 9
CLAUDE.md                                            sous-projets 9 et 10, règles, oracle, outillage
```

## Commandes

Depuis la racine du worktree.

```bash
pnpm install                                                   # une fois, à la création du worktree
pnpm --filter @ib/ib-parsers test src/statement.test.ts        # un fichier des parseurs
pnpm --filter @ib/ledger test src/cash.test.ts                 # un fichier du ledger
pnpm --filter web test src/db/importFile.test.ts               # un fichier de l'app (garde TZ=Asia/Kolkata)
pnpm --filter @ib/ib-parsers test                              # tout le paquet
pnpm --filter @ib/ledger test
pnpm --filter web test
pnpm --filter web typecheck                                    # tsc -b, silencieux si OK
pnpm check                                                     # lint + typecheck + build + tous les Vitest
```

Toujours passer par le script `test` de `web` (jamais `exec vitest`) : il fixe `TZ=Asia/Kolkata`, qui fait échouer tout calcul de jour dépendant du fuseau. `pnpm check` ne lance ni Python, ni Django, ni Playwright. Les tests `*.private.test.ts` tournent avec le reste quand `private/` est présent.

---

## Tâche 1 : worktree, types partagés, Cash Report Flex

**Files:**
- Create: `packages/ib-parsers/src/snapshot.ts`
- Modify: `packages/ib-parsers/src/flex.ts:21-34,120-170`, `packages/ib-parsers/src/index.ts`
- Test: `packages/ib-parsers/src/flex.test.ts`

**Interfaces:**
- Consomme : rien.
- Produit :
  - `CURRENCY_CODE_RE: RegExp` (`/^[A-Z]{3}$/`)
  - `interface FileSnapshot { asOf: string; positions: Position[]; cashAvailable: number | null }`
  - `interface CashPointValues { asOf: string; balances: Record<string, number> }`
  - `interface CashReport { start: CashPointValues; end: CashPointValues }`
  - `FlexParseResult.snapshot: FileSnapshot | null` et `FlexParseResult.cashReport: CashReport | null`

- [x] **Step 1 : créer le worktree**

Invoquer la skill `superpowers:using-git-worktrees` pour créer `.claude/worktrees/fichier-seul` sur une branche `fichier-seul` partant de `main`, puis :

```bash
cd .claude/worktrees/fichier-seul
pnpm install
pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ledger test && pnpm --filter web test
```

Attendu : tout vert. C'est la ligne de base. Toutes les commandes suivantes partent de ce répertoire.

`private/` a reçu un relevé 2026 (du 1er janvier au 9 septembre) après le sous-projet 8 : si un test `*.private.test.ts` échoue **déjà** ici, s'arrêter et le signaler avant toute modification, avec la sortie du test. Ce n'est pas un défaut de ce sous-projet et il ne faut pas le « corriger » en passant.

- [x] **Step 2 : écrire les tests du Cash Report Flex**

Ajouter à la fin de `packages/ib-parsers/src/flex.test.ts` :

```ts
describe("parseFlexXml: cash report points", () => {
  const CASH_REPORT_BOTH = CASH_REPORT.replace(
    "</CashReport>",
    '<CashReportCurrency accountId="U0000001" currency="EUR" levelOfDetail="Currency" fromDate="20250903" toDate="20260902" startingCash="10" endingCash="12.5" endingSettledCash="12.5" /></CashReport>',
  );

  it("reads Starting Cash and Ending Cash per currency, dated by the window, never the base summary", () => {
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT_BOTH}`), TARGET);
    expect(result.issues).toEqual([]);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-09-03", balances: { USD: 1000, EUR: 10 } },
      end: { asOf: "2026-09-02", balances: { USD: 12345.67, EUR: 12.5 } },
    });
  });

  it("has no cash report without the section", () => {
    expect(parseFlexXml(flex("<Trades/><CashTransactions/><OpenPositions/>"), TARGET).cashReport).toBeNull();
  });

  it("drops a currency line missing one of its two amounts, and says so", () => {
    const halfUsd = CASH_REPORT.replace(' startingCash="1000" endingCash="12345.67"', ' endingCash="12345.67"');
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${halfUsd}`), TARGET);
    expect(result.cashReport).toBeNull();
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "Cash Report: USD without startingCash or endingCash",
    });
  });

  it("has no cash report when the response declares no window to date it by", () => {
    const xml = flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT}`).replace(' toDate="20260902"', "");
    expect(parseFlexXml(xml, TARGET).cashReport).toBeNull();
  });

  it("returns no cash report on a file of another account", () => {
    expect(parseFlexXml(flex(CASH_REPORT, "U7777777"), TARGET).cashReport).toBeNull();
  });
});
```

- [x] **Step 3 : lancer les tests, les voir échouer**

Run: `pnpm --filter @ib/ib-parsers test src/flex.test.ts`
Expected: FAIL — `cashReport` est `undefined`, pas l'objet attendu ni `null`.

- [x] **Step 4 : écrire `packages/ib-parsers/src/snapshot.ts`**

```ts
import type { Position } from "@ib/ledger";

/** A currency line of a Cash Report, never its base-currency summary. */
export const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/** Positions and USD cash of one file, as of the close of `asOf`. */
export interface FileSnapshot {
  /** YYYY-MM-DD */
  asOf: string;
  positions: Position[];
  /** USD Ending Cash of the same file: TWS's TotalCashBalance at the close; `null` when absent. */
  cashAvailable: number | null;
}

export interface CashPointValues {
  /** YYYY-MM-DD */
  asOf: string;
  /** Per three-letter currency code; a currency the report does not list is absent, never 0. */
  balances: Record<string, number>;
}

/** Starting Cash at the start of the file's period, Ending Cash at its end. */
export interface CashReport {
  start: CashPointValues;
  end: CashPointValues;
}
```

Et dans `packages/ib-parsers/src/index.ts`, ajouter la ligne :

```ts
export * from "./snapshot.ts";
```

- [x] **Step 5 : brancher le Cash Report dans `flex.ts`**

1. Supprimer l'interface `FlexSnapshot` (lignes 21-28) et ajouter l'import :

```ts
import { CURRENCY_CODE_RE, type CashReport, type FileSnapshot } from "./snapshot.ts";
```

2. Remplacer `FlexParseResult` :

```ts
export interface FlexParseResult extends ParseResult<FlexStatementInfo> {
  /** Open Positions and USD cash; dated by the rows' reportDate, the statement's toDate when there is none. */
  snapshot: FileSnapshot | null;
  /** Starting and Ending Cash per currency over the declared window; `null` without the section. */
  cashReport: CashReport | null;
  /** Contract identities the file happened to carry; empty when no section has the column. */
  identities: ContractIdentity[];
}
```

3. Ajouter `cashReport: null` à **chacun** des cinq retours précoces de `parseFlexXml` (non-Flex, en-tête illisible, compte étranger, `NormalizationError` finale), à côté de `snapshot: null`.

4. Dans le bloc `try` de `parseFlexXml`, remplacer les deux dernières lignes par :

```ts
    const snapshot = parseSnapshot(statementEl, statement, issues);
    const cashReport = parseCashPoints(statementEl, statement, issues);
    checkSections(statementEl, issues);
    return { transactions, statement, snapshot, cashReport, identities: parseIdentities(statementEl), issues };
```

5. Changer le type de retour de `parseSnapshot` en `FileSnapshot | null`.

6. Ajouter, juste après `parseCashReport` :

```ts
/**
 * Both points of every currency line of the Cash Report, dated by the window the response
 * declares. The base summary is not a currency. A line missing one of its two amounts cannot be
 * checked, so it is dropped whole; without a declared window there is nothing to date them by.
 */
function parseCashPoints(statementEl: Element, statement: FlexStatementInfo, issues: ParseIssue[]): CashReport | null {
  const report = section(statementEl, "CashReport");
  if (!report || statement.fromDate === "" || statement.toDate === "") return null;
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  for (const el of children(report, "CashReportCurrency")) {
    const currency = attr(el, "currency") ?? "";
    if ((attr(el, "levelOfDetail") ?? "Currency") !== "Currency" || !CURRENCY_CODE_RE.test(currency)) continue;
    const starting = parseNumber(attr(el, "startingCash"), `cash report ${currency} startingCash`);
    const ending = parseNumber(attr(el, "endingCash"), `cash report ${currency} endingCash`);
    if (starting === null || ending === null) {
      issues.push(warning("row-skipped", `Cash Report: ${currency} without startingCash or endingCash`));
      continue;
    }
    start[currency] = starting;
    end[currency] = ending;
  }
  if (Object.keys(end).length === 0) return null;
  return { start: { asOf: statement.fromDate, balances: start }, end: { asOf: statement.toDate, balances: end } };
}
```

- [x] **Step 6 : lancer les tests, les voir passer**

Run: `pnpm --filter @ib/ib-parsers test`
Expected: PASS, y compris les tests existants de `flex.test.ts` dont les `issues` sont comparées à l'identique (aucun avertissement nouveau sur `CASH_REPORT` ni `CASH_REPORT_EUR_ONLY`).

Run: `pnpm --filter web typecheck`
Expected: silencieux.

- [x] **Step 7 : commit**

Cocher les cases de cette tâche dans `docs/plans/2026-09-10-fichier-seul.md`, puis :

```bash
git add packages/ib-parsers/src/snapshot.ts packages/ib-parsers/src/index.ts packages/ib-parsers/src/flex.ts packages/ib-parsers/src/flex.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(ib-parsers): le Cash Report Flex rend ses deux points par devise

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 2 : le Cash Report du relevé HTML

**Files:**
- Modify: `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm` (fin de fichier), `packages/ib-parsers/src/statement.ts:14-24,60-101`
- Test: `packages/ib-parsers/src/statement.test.ts`, `packages/ib-parsers/src/corpus.test.ts`

**Interfaces:**
- Consomme : `CashReport`, `FileSnapshot`, `CURRENCY_CODE_RE` (tâche 1).
- Produit : `StatementParseResult.cashReport: CashReport | null` et `StatementParseResult.snapshot: FileSnapshot | null` (toujours `null` jusqu'à la tâche 3). La fixture porte un Cash Report : USD 1 000,00 → 2 803,63, EUR 0,00 → 7 597,70, **exactement cohérent avec ses propres lignes** (solde brut USD 1 803,63, EUR 7 597,70).

- [x] **Step 1 : ajouter le Cash Report à la fixture, en fin de fichier**

Dans `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm`, insérer **juste avant la ligne `</body>`** (et surtout pas avant *Transactions* : plusieurs tests remplacent la première occurrence d'un en-tête ou d'une valeur) :

```html
<div id="tblCashReport_U0000001Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered">
<thead>
<tr>
<th align="left">&nbsp;</th>
<th align="right">Total</th>
<th align="right">Securities</th>
<th align="right">Futures</th>
</tr>
</thead>
<tr><td class="header-currency" align="left" valign="middle" colspan="4">Base Currency Summary</td>
</tr>
<tr>
<td>Starting Cash</td>
<td align="right">900.00</td>
<td align="right">900.00</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>Ending Cash</td>
<td align="right">9,999.99</td>
<td align="right">9,999.99</td>
<td align="right">0.00</td>
</tr>
<tr><td class="header-currency" align="left" valign="middle" colspan="4">EUR</td>
</tr>
<tr>
<td>Starting Cash</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>&nbsp;&nbsp;&nbsp;Deposits</td>
<td align="right">7,499.50</td>
<td align="right">7,499.50</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>Ending Cash</td>
<td align="right">7,597.70</td>
<td align="right">7,597.70</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>Ending Settled Cash</td>
<td align="right">7,597.70</td>
<td align="right">7,597.70</td>
<td align="right">0.00</td>
</tr>
<tr><td class="header-currency" align="left" valign="middle" colspan="4">USD</td>
</tr>
<tr>
<td>Starting Cash</td>
<td align="right">1,000.00</td>
<td align="right">1,000.00</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>&nbsp;&nbsp;&nbsp;Commissions</td>
<td align="right">-4.65</td>
<td align="right">-4.65</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>Ending Cash</td>
<td align="right">2,803.63</td>
<td align="right">2,803.63</td>
<td align="right">0.00</td>
</tr>
<tr>
<td>Ending Settled Cash</td>
<td align="right">2,803.63</td>
<td align="right">2,803.63</td>
<td align="right">0.00</td>
</tr>
</table>
</div>
</div>

```

- [x] **Step 2 : écrire les tests**

Ajouter à la fin de `packages/ib-parsers/src/statement.test.ts` :

```ts
describe("parseActivityStatement cash report", () => {
  it("reads Starting Cash and Ending Cash per currency, dated by the declared period, never the base summary", () => {
    const result = parseActivityStatement(html, TARGET);
    expect(result.issues).toEqual([]);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-01-01", balances: { EUR: 0, USD: 1000 } },
      end: { asOf: "2025-12-31", balances: { EUR: 7597.7, USD: 2803.63 } },
    });
  });

  it("drops a currency block missing one of its two lines, and says so", () => {
    const noUsdEnd = html.replace('Ending Cash</td>\n<td align="right">2,803.63', 'Closing Cash</td>\n<td align="right">2,803.63');
    expect(noUsdEnd).not.toBe(html);
    const result = parseActivityStatement(noUsdEnd, TARGET);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-01-01", balances: { EUR: 0 } },
      end: { asOf: "2025-12-31", balances: { EUR: 7597.7 } },
    });
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "CashReport: USD without Starting Cash or Ending Cash",
    });
  });

  it("has no cash report, and no warning, when the section is absent", () => {
    const result = parseActivityStatement(html.replace(/tblCashReport_U0000001Body/g, "tblGoneBody"), TARGET);
    expect(result.cashReport).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it("returns no cash report on a statement of another account", () => {
    expect(parseActivityStatement(html, { accountId: "test", ibAccountId: "U7777777" }).cashReport).toBeNull();
  });
});
```

Et dans `packages/ib-parsers/src/corpus.test.ts`, dans le `describe` existant, ajouter :

```ts
  it("reads a Cash Report in both currencies every year, the first one opening the account", () => {
    for (const result of parsed) {
      expect(Object.keys(result.cashReport!.end.balances).sort()).toEqual(["EUR", "USD"]);
    }
    expect(parsed[0].cashReport!.start.balances).toEqual({ EUR: 0, USD: 0 });
  });
```

- [x] **Step 3 : lancer les tests, les voir échouer**

Run: `pnpm --filter @ib/ib-parsers test src/statement.test.ts src/corpus.test.ts`
Expected: FAIL — `cashReport` est `undefined`.

- [x] **Step 4 : implémenter dans `statement.ts`**

1. Imports :

```ts
import { CURRENCY_CODE_RE, type CashReport, type FileSnapshot } from "./snapshot.ts";
```

2. Remplacer `StatementParseResult` :

```ts
export interface StatementParseResult extends ParseResult<StatementInfo> {
  /** Contract Information of this file; empty when the section is absent. */
  identities: ContractIdentity[];
  /** Open Positions and USD Ending Cash at `periodEnd`; `null` when absent or unreadable. */
  snapshot: FileSnapshot | null;
  /** Starting and Ending Cash per currency over the declared period; `null` without the section. */
  cashReport: CashReport | null;
}
```

3. Ajouter `snapshot: null, cashReport: null` aux **quatre** retours de `parseActivityStatement` qui ne sont pas le succès (pas de section, période illisible, compte étranger, `NormalizationError`).

4. Remplacer le retour du succès :

```ts
    const transactions = suffixTwins([...parseTrades(ctx), ...parseOtherSections(ctx)]);
    const identities = parseContractInfo(ctx);
    const cashReport = parseCashReport(ctx, statement);
    return { transactions, statement, identities, snapshot: null, cashReport, issues: ctx.issues };
```

5. Ajouter la fonction, après `parseOptionCashSettlements` :

```ts
/**
 * Cash Report: one block per currency after the base-currency summary, each opening on Starting
 * Cash and closing on Ending Cash in the Total column. The movements in between are the ledger's
 * own job. A block missing one of the two cannot be checked, so it is dropped whole.
 */
function parseCashReport(ctx: Context, statement: StatementInfo): CashReport | null {
  const sectionData = readSection(ctx, "CashReport", false);
  if (!sectionData) return null;
  const found = new Map<string, { start: number | null; end: number | null }>();
  for (const row of sectionData.rows) {
    if (!CURRENCY_CODE_RE.test(row.currency)) continue;
    // The label column has a blank header: `readSection` keys it by "".
    const label = row.cells[""] ?? "";
    if (label !== "Starting Cash" && label !== "Ending Cash") continue;
    const entry = found.get(row.currency) ?? { start: null, end: null };
    const value = parseNumber(row.cells["Total"], `CashReport ${row.currency} ${label}`);
    if (label === "Starting Cash") entry.start = value;
    else entry.end = value;
    found.set(row.currency, entry);
  }
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  for (const [currency, entry] of found) {
    if (entry.start === null || entry.end === null) {
      ctx.issues.push(warning("row-skipped", `CashReport: ${currency} without Starting Cash or Ending Cash`));
      continue;
    }
    start[currency] = entry.start;
    end[currency] = entry.end;
  }
  if (Object.keys(end).length === 0) return null;
  return { start: { asOf: statement.periodStart, balances: start }, end: { asOf: statement.periodEnd, balances: end } };
}
```

- [x] **Step 5 : lancer les tests, les voir passer**

Run: `pnpm --filter @ib/ib-parsers test`
Expected: PASS, tous fichiers confondus (la fixture modifiée ne casse aucun test existant : les nouvelles sections sont après les autres).

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS — l'application lit la fixture mais n'utilise pas encore le Cash Report.

- [x] **Step 6 : commit**

Cocher les cases, puis :

```bash
git add packages/ib-parsers docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(ib-parsers): le relevé HTML rend son Cash Report par devise

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 3 : les Open Positions du relevé HTML

**Files:**
- Modify: `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm` (fin de fichier), `packages/ib-parsers/src/statement.ts:1,137-199`, `packages/ib-parsers/src/corpus.oracle.test.ts:13-18`, `apps/web/src/db/importFile.ts:76`
- Test: `packages/ib-parsers/src/statement.test.ts`, `packages/ib-parsers/src/corpus.test.ts`

**Interfaces:**
- Consomme : tâche 2.
- Produit : `StatementParseResult.snapshot` rempli. La fixture porte trois positions au 2025-12-31 : `TESTE` (10, EUR), `TWINX` (20, USD), `TESTX 16JAN26 15 P` (−1, USD), et `cashAvailable = 2803.63`.

- [x] **Step 1 : ajouter Open Positions à la fixture, en fin de fichier**

Insérer **juste avant la ligne `</body>`** (donc après le Cash Report de la tâche 2) :

```html
<div id="tblOpenPositions_U0000001Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered" id="summaryDetailTable">
<thead>
<tr>
<th align="left">Symbol</th>
<th align="right">Quantity</th>
<th align="right">Mult</th>
<th align="right">Cost Price</th>
<th align="right">Cost Basis</th>
<th align="right">Close Price</th>
<th align="right">Value</th>
<th align="right">Unrealized P/L</th>
<th align="right">Code</th>
</tr>
</thead>
<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="9">Stocks</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="9">EUR</td></tr>
</tbody>
<tbody>
<tr>
<td>TESTE</td>
<td align="right">10</td>
<td align="right">1</td>
<td align="right">20.5</td>
<td align="right">205.00</td>
<td align="right">21.0000</td>
<td align="right">210.00</td>
<td align="right">5.00</td>
<td align="right">&nbsp;</td>
</tr>
</tbody>
<tbody>
<tr class="subtotal">
<td class="indent" colspan="2">Total</td>
<td align="right">&nbsp;</td>
<td>&nbsp;</td>
<td align="right">205.00</td>
<td>&nbsp;</td>
<td align="right">210.00</td>
<td align="right">5.00</td>
<td>&nbsp;</td>
</tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="9">USD</td></tr>
</tbody>
<tbody>
<tr class="row-summary no-details">
<td>TWINX</td>
<td align="right">20</td>
<td align="right">1</td>
<td align="right">5.1</td>
<td align="right">102.00</td>
<td align="right">6.0000</td>
<td align="right">120.00</td>
<td align="right">18.00</td>
<td align="right">&nbsp;</td>
</tr>
</tbody>
<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="9">Equity and Index Options</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="9">USD</td></tr>
</tbody>
<tbody>
<tr>
<td>TESTX 16JAN26 15 P</td>
<td align="right">-1</td>
<td align="right">100</td>
<td align="right">1.4935</td>
<td align="right">-149.35</td>
<td align="right">0.8000</td>
<td align="right">-80.00</td>
<td align="right">69.35</td>
<td align="right">&nbsp;</td>
</tr>
</tbody>
<tbody>
<tr class="total">
<td class="indent" colspan="2">Total in&nbsp;EUR</td>
<td align="right">&nbsp;</td>
<td>&nbsp;</td>
<td align="right">157.65</td>
<td>&nbsp;</td>
<td align="right">250.00</td>
<td align="right">92.35</td>
<td>&nbsp;</td>
</tr>
</tbody>
</table>
</div>
</div>

```

- [x] **Step 2 : écrire les tests**

Ajouter à la fin de `packages/ib-parsers/src/statement.test.ts` :

```ts
describe("parseActivityStatement open positions", () => {
  const TESTE = {
    symbol: "TESTE", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 10,
    avgPrice: 20.5, marketPrice: 21, marketValue: 210, unrealizedPnl: 5, currency: "EUR", conid: "", description: "TESTE",
  };
  const TWINX = {
    symbol: "TWINX", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 20,
    avgPrice: 5.1, marketPrice: 6, marketValue: 120, unrealizedPnl: 18, currency: "USD", conid: "", description: "TWINX",
  };
  const PUT = {
    symbol: "TESTX", secType: "OPT", right: "P", strike: 15, expiry: "2026-01-16", multiplier: 100, quantity: -1,
    avgPrice: 1.4935, marketPrice: 0.8, marketValue: -80, unrealizedPnl: 69.35, currency: "USD", conid: "",
    description: "TESTX 16JAN26 15 P",
  };

  it("reads the positions into a snapshot at the period's end, with the USD Ending Cash", () => {
    const result = parseActivityStatement(html, TARGET);
    expect(result.issues).toEqual([]);
    expect(result.snapshot).toEqual({ asOf: "2025-12-31", positions: [TESTE, TWINX, PUT], cashAvailable: 2803.63 });
  });

  it("keeps the summary row and skips a lot row: a lot repeats part of its summary's quantity", () => {
    const summary =
      '<td>TWINX</td>\n<td align="right">20</td>\n<td align="right">1</td>\n<td align="right">5.1</td>\n<td align="right">102.00</td>\n<td align="right">6.0000</td>\n<td align="right">120.00</td>\n<td align="right">18.00</td>\n<td align="right">&nbsp;</td>\n</tr>';
    const lot =
      '<tr class="row-detail">\n<td>TWINX</td>\n<td align="right">5</td>\n<td align="right">1</td>\n<td align="right">5.1</td>\n<td align="right">25.50</td>\n<td align="right">6.0000</td>\n<td align="right">30.00</td>\n<td align="right">4.50</td>\n<td align="right">&nbsp;</td>\n</tr>';
    const withLot = html.replace(summary, `${summary}\n${lot}`);
    expect(withLot).not.toBe(html);
    expect(parseActivityStatement(withLot, TARGET).snapshot?.positions).toEqual([TESTE, TWINX, PUT]);
  });

  it("drops the snapshot, never the file, on an unreadable quantity", () => {
    const broken = html.replace('<td align="right">-1</td>\n<td align="right">100</td>', '<td align="right">minus one</td>\n<td align="right">100</td>');
    expect(broken).not.toBe(html);
    const result = parseActivityStatement(broken, TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.transactions).toHaveLength(parseActivityStatement(html, TARGET).transactions.length);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "row-skipped", detail: expect.stringContaining("OpenPositions: Unreadable number") }),
    );
  });

  it("drops the snapshot on an option whose contract it cannot read: a missing leg is worse than none", () => {
    const broken = html.replace("<td>TESTX 16JAN26 15 P</td>", "<td>TESTX JAN26 15 P</td>");
    expect(broken).not.toBe(html);
    const result = parseActivityStatement(broken, TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: 'OpenPositions: option contract not recognised in "TESTX JAN26 15 P"',
    });
  });

  it("drops the snapshot on a row with the wrong cell count", () => {
    const broken = html.replace('<td>TWINX</td>\n<td align="right">20</td>', "<td>TWINX</td>");
    expect(broken).not.toBe(html);
    const result = parseActivityStatement(broken, TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "row-skipped", detail: expect.stringContaining("OpenPositions: row with 8 cell(s)") }),
    );
  });

  it("has no snapshot without the section, and says so", () => {
    const result = parseActivityStatement(html.replace(/tblOpenPositions_U0000001Body/g, "tblGoneBody"), TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "section-missing", detail: "Open Positions" }]);
  });

  it("reads an empty section as an account that held nothing", () => {
    const empty = html.replace(/(<div id="tblOpenPositions_U0000001Body"[\s\S]*?<\/thead>)[\s\S]*?(<\/table>)/, "$1\n$2");
    expect(empty).not.toBe(html);
    expect(parseActivityStatement(empty, TARGET).snapshot).toEqual({ asOf: "2025-12-31", positions: [], cashAvailable: 2803.63 });
  });

  it("warns column-missing on a renamed column and leaves the value unknown", () => {
    const renamed = html.replace('<th align="right">Close Price</th>', '<th align="right">Last Price</th>');
    const result = parseActivityStatement(renamed, TARGET);
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "OpenPositions: Close Price" }]);
    expect(result.snapshot?.positions.map((p) => p.marketPrice)).toEqual([null, null, null]);
  });

  it("leaves the cash unknown when the Cash Report is absent", () => {
    const result = parseActivityStatement(html.replace(/tblCashReport_U0000001Body/g, "tblGoneBody"), TARGET);
    expect(result.snapshot?.cashAvailable).toBeNull();
  });
});
```

Et dans `packages/ib-parsers/src/corpus.test.ts`, ajouter :

```ts
  it("reads every Open Positions row of every year", () => {
    // Counts exclude subtotal/total rows: only actual position data rows.
    expect(parsed.map((result) => result.snapshot?.positions.length)).toEqual([23, 34, 41]);
    for (const result of parsed) {
      expect(result.issues.filter((i) => i.code === "row-skipped" && i.detail.startsWith("OpenPositions"))).toEqual([]);
    }
  });
```

Les trois nombres ont été relevés sur les fixtures avant ce plan (lignes de données hors sous-totaux). S'ils diffèrent, **ne pas les ajuster** : trouver la ligne que le parseur rejette ou compte en trop, et le dire. Décision du contrôleur (tâche 3) : le 42 initialement relevé pour 2024 venait d'un script de comptage antérieur au plan qui comptait à tort la ligne `<tr class="total">` « Total Stocks in EUR » comme une position ; le compte correct est 41, aucune ligne n'est rejetée ni comptée en trop par le parseur.

- [x] **Step 3 : lancer les tests, les voir échouer**

Run: `pnpm --filter @ib/ib-parsers test src/statement.test.ts src/corpus.test.ts`
Expected: FAIL — `snapshot` vaut `null` partout.

- [x] **Step 4 : `readSection` apprend à ne garder que les lignes de synthèse**

Dans `statement.ts`, changer la signature :

```ts
function readSection(ctx: Context, key: string, required: boolean, options: { summaryRowsOnly?: boolean } = {}): Section | null {
```

et, dans la boucle, **juste après** `if (tds.length === 0) continue;` et avant le contrôle du nombre de cellules :

```ts
      // A lot row repeats part of its summary row's quantity, like a Flex LOT row: where asked,
      // keep only the rows IB leaves unclassed or marks as a summary.
      if (options.summaryRowsOnly && tr.classList.length > 0 && !tr.classList.contains("row-summary")) continue;
```

- [x] **Step 5 : lire Open Positions**

1. Changer l'import de types de la première ligne :

```ts
import type { Position, Transaction, TransactionKind } from "@ib/ledger";
```

2. Remplacer le retour du succès de `parseActivityStatement` :

```ts
    const transactions = suffixTwins([...parseTrades(ctx), ...parseOtherSections(ctx)]);
    const identities = parseContractInfo(ctx);
    const cashReport = parseCashReport(ctx, statement);
    const snapshot = parseOpenPositions(ctx, statement, cashReport);
    return { transactions, statement, identities, snapshot, cashReport, issues: ctx.issues };
```

3. Ajouter, après `parseCashReport` :

```ts
const OPEN_POSITIONS_WATCHED_COLUMNS: readonly WatchedColumn[] = [
  "Symbol",
  "Quantity",
  "Mult",
  "Cost Price",
  "Close Price",
  "Value",
  "Unrealized P/L",
];

/**
 * Open Positions, as of the close of the statement's last day. One unreadable row drops the
 * snapshot but never the file: a snapshot missing a leg could show a short leg as uncovered, or
 * lose the stock that covers it (same rule as `parseSnapshot` in `flex.ts`).
 */
function parseOpenPositions(ctx: Context, statement: StatementInfo, cashReport: CashReport | null): FileSnapshot | null {
  let positions: Position[];
  try {
    const sectionData = readSection(ctx, "OpenPositions", true, { summaryRowsOnly: true });
    if (!sectionData) {
      ctx.issues.push(warning("section-missing", "Open Positions"));
      return null;
    }
    reportMissingColumns(ctx, sectionData, OPEN_POSITIONS_WATCHED_COLUMNS);
    positions = sectionData.rows.map((row) => openPosition(ctx, row));
  } catch (e) {
    if (e instanceof NormalizationError) {
      const detail = e.message.startsWith("OpenPositions:") ? e.message : `OpenPositions: ${e.message}`;
      ctx.issues.push(warning("row-skipped", detail));
      return null;
    }
    throw e;
  }
  return { asOf: statement.periodEnd, positions, cashAvailable: cashReport?.end.balances.USD ?? null };
}

function openPosition(ctx: Context, row: SectionRow): Position {
  const text = row.cells["Symbol"] ?? "";
  const what = `open position ${text}`;
  const { symbol, expiry, strike, right } = splitOptionSymbol(text);
  const secType = secTypeOf(ctx, row.assetCategory);
  if (secType === "OPT" && right === "") throw new NormalizationError(`option contract not recognised in "${text}"`);
  const quantity = parseNumber(row.cells["Quantity"], `${what} quantity`);
  if (quantity === null) throw new NormalizationError(`Open position without quantity (${text})`);
  return {
    // Coverage groups by underlying: `splitOptionSymbol` gives it for an option, the ticker otherwise.
    symbol,
    secType,
    right,
    strike,
    expiry,
    multiplier: parseNumber(row.cells["Mult"], `${what} multiplier`),
    quantity,
    // Already per unit: quantity × Mult × Cost Price is the Cost Basis column.
    avgPrice: parseNumber(row.cells["Cost Price"], `${what} cost price`),
    marketPrice: parseNumber(row.cells["Close Price"], `${what} close price`),
    marketValue: parseNumber(row.cells["Value"], `${what} value`),
    unrealizedPnl: parseNumber(row.cells["Unrealized P/L"], `${what} unrealized P/L`),
    currency: row.currency,
    // The section carries no conid.
    conid: "",
    description: text,
  };
}
```

- [x] **Step 6 : garder l'application sur son comportement actuel jusqu'à la tâche 7**

Le relevé rend désormais un snapshot, et `importFile` l'écrirait sous l'étiquette `flex`. Dans `apps/web/src/db/importFile.ts`, remplacer la ligne :

```ts
  const snapshot = "snapshot" in parsed ? parsed.snapshot : null;
```

par :

```ts
  // Statement snapshots are written from task 7 of the sub-project 9 plan on, with their own source.
  const snapshot = source === "flex" ? parsed.snapshot : null;
```

- [x] **Step 7 : corriger le commentaire devenu faux de l'oracle du corpus**

Dans `packages/ib-parsers/src/corpus.oracle.test.ts`, remplacer le commentaire au-dessus de `openStockPositions` par :

```ts
/**
 * The Open Positions of a statement, read here with a deliberately naive reader rather than
 * `parseActivityStatement`'s own snapshot: an oracle must not share the code it checks.
 * A fixture we generate ourselves needs no tolerance.
 */
```

- [x] **Step 8 : lancer les tests, les voir passer**

Run: `pnpm --filter @ib/ib-parsers test`
Expected: PASS.

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 9 : commit**

Cocher les cases, puis :

```bash
git add packages/ib-parsers apps/web/src/db/importFile.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(ib-parsers): le relevé HTML rend ses Open Positions en snapshot

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 4 : `anchoredBalances`, le solde calé et vérifié

**Files:**
- Modify: `packages/ledger/src/cash.ts`
- Test: `packages/ledger/src/cash.test.ts`

**Interfaces:**
- Consomme : `runningBalances`, `LedgerRow`, `dayOf` (existants).
- Produit :
  - `CASH_CHECK_TOLERANCE = 1`
  - `interface CashPoint { currency: string; kind: "start" | "end"; asOf: string; amount: number }`
  - `interface CashCheck { currency: string; offset: number; end: { asOf: string; amount: number } | null; start: { asOf: string; amount: number; balance: number; gap: number } | null }`
  - `anchoredBalances(transactions: readonly Transaction[], currencies: readonly string[], points: readonly CashPoint[]): { rows: LedgerRow[]; checks: CashCheck[] }` — `checks` dans l'ordre de `currencies`
  - `isCashCheckOk(check: CashCheck): boolean | null`

- [x] **Step 1 : écrire les tests**

Dans `packages/ledger/src/cash.test.ts`, changer l'import :

```ts
import { CASH_CHECK_TOLERANCE, anchoredBalances, cashImpact, isCashCheckOk, runningBalances, type CashCheck, type CashPoint } from "./cash.ts";
```

et ajouter à la fin du fichier :

```ts
describe("anchoredBalances", () => {
  const deposit = tx({ externalId: "a:1", kind: "transfer", symbol: "", amount: 10000, commission: null, currency: "EUR", when: "2026-08-12T00:00:00.000Z" });
  const tsla = tx({ externalId: "a:2", symbol: "TSLA", amount: -1100, commission: -1, when: "2026-08-20T09:05:00.000Z" });
  const msft = tx({ externalId: "a:3", symbol: "MSFT", amount: 610, commission: -0.65, when: "2026-08-27T10:15:00.000Z" });
  const aapl = tx({ externalId: "a:4", symbol: "AAPL", amount: -18050, commission: -1.5, when: "2026-08-28T14:30:00.000Z" });
  const ledger = [aapl, deposit, msft, tsla];
  // Raw USD after each row, in reference order: 0, -1101, -491.65, -18543.15.
  const end = (asOf: string, amount: number, currency = "USD"): CashPoint => ({ currency, kind: "end", asOf, amount });
  const start = (asOf: string, amount: number, currency = "USD"): CashPoint => ({ currency, kind: "start", asOf, amount });

  it("shifts every balance of a currency so that it ends on the end point, and leaves the others raw", () => {
    const { rows, checks } = anchoredBalances(ledger, ["USD", "EUR"], [end("2026-08-28", 1456.85)]);
    // The offset is itself a float difference: every shifted balance is compared approximately.
    expect(rows.map((r) => r.balances.USD)).toEqual([
      expect.closeTo(20000, 6),
      expect.closeTo(18899, 6),
      expect.closeTo(19508.35, 6),
      expect.closeTo(1456.85, 6),
    ]);
    expect(rows.map((r) => r.balances.EUR)).toEqual([10000, 10000, 10000, 10000]);
    expect(checks).toEqual([
      { currency: "USD", offset: expect.closeTo(20000, 6), end: { asOf: "2026-08-28", amount: 1456.85 }, start: null },
      { currency: "EUR", offset: 0, end: null, start: null },
    ]);
  });

  it("counts the rows of the end point's own day, and none after it", () => {
    const { rows } = anchoredBalances(ledger, ["USD"], [end("2026-08-27", 1000)]);
    expect(rows[2].balances.USD).toBeCloseTo(1000, 6);
    expect(rows[3].balances.USD).toBeCloseTo(-17051.5, 6);
  });

  it("measures the start at the close of the day before it, the day's own rows left out", () => {
    const onTheDay = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.85), start("2026-08-20", 20000)]).checks[0];
    expect(onTheDay.start).toEqual({ asOf: "2026-08-20", amount: 20000, balance: expect.closeTo(20000, 6), gap: 0 });
    const dayAfter = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.85), start("2026-08-21", 20000)]).checks[0];
    expect(dayAfter.start?.gap).toBe(-1101);
  });

  it("rounds the gap to the cent, and never to minus zero", () => {
    const up = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.851), start("2026-08-20", 20000)]).checks[0];
    expect(up.start?.gap).toBe(0);
    const down = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.846), start("2026-08-20", 20000)]).checks[0];
    expect(down.start?.gap).toBe(0);
    expect(Object.is(down.start?.gap, -0)).toBe(false);
  });

  it("counts rows older than the start point in the measure, whatever their age", () => {
    const old = tx({ externalId: "a:0", symbol: "OLD", amount: 500, commission: null, when: "2019-01-02T00:00:00.000Z" });
    const check = anchoredBalances([...ledger, old], ["USD"], [end("2026-08-28", 1956.85), start("2026-08-20", 20500)]).checks[0];
    expect(check.start?.gap).toBe(0);
  });

  it("checks a start without an end on the raw balances", () => {
    const check = anchoredBalances(ledger, ["USD"], [start("2026-08-21", -1101)]).checks[0];
    expect(check).toEqual({ currency: "USD", offset: 0, end: null, start: { asOf: "2026-08-21", amount: -1101, balance: -1101, gap: 0 } });
  });

  it("anchors the base side of a currency conversion too", () => {
    const conversion = tx({ externalId: "a:5", symbol: "EUR.USD", quantity: -1000, amount: 1100, commission: -2, currency: "USD", when: "2026-08-15T10:00:00.000Z" });
    const { rows } = anchoredBalances([...ledger, conversion], ["USD", "EUR"], [end("2026-08-28", 9000, "EUR")]);
    // Raw EUR ends on 10000 - 1000 - 2 = 8998: the offset is 2.
    expect(rows[rows.length - 1].balances.EUR).toBeCloseTo(9000, 6);
    expect(rows[0].balances.EUR).toBeCloseTo(10002, 6);
  });

  it("returns no row and raw checks for an empty ledger", () => {
    expect(anchoredBalances([], ["USD"], [end("2026-08-28", 5), start("2026-01-01", 5)])).toEqual({
      rows: [],
      checks: [{ currency: "USD", offset: 5, end: { asOf: "2026-08-28", amount: 5 }, start: { asOf: "2026-01-01", amount: 5, balance: 5, gap: 0 } }],
    });
  });
});

describe("isCashCheckOk", () => {
  const withGap = (gap: number): CashCheck => ({ currency: "USD", offset: 0, end: null, start: { asOf: "2026-01-01", amount: 0, balance: gap, gap } });

  it("has no verdict without a start point", () => {
    expect(isCashCheckOk({ currency: "USD", offset: 0, end: { asOf: "2026-01-01", amount: 1 }, start: null })).toBeNull();
  });

  it("accepts a gap up to the tolerance, in either direction, and refuses one beyond it", () => {
    expect(CASH_CHECK_TOLERANCE).toBe(1);
    expect(isCashCheckOk(withGap(1))).toBe(true);
    expect(isCashCheckOk(withGap(-1))).toBe(true);
    expect(isCashCheckOk(withGap(1.01))).toBe(false);
    expect(isCashCheckOk(withGap(-1.01))).toBe(false);
  });
});
```

- [x] **Step 2 : lancer les tests, les voir échouer**

Run: `pnpm --filter @ib/ledger test src/cash.test.ts`
Expected: FAIL — `anchoredBalances` n'est pas exporté.

- [x] **Step 3 : implémenter**

En tête de `packages/ledger/src/cash.ts`, ajouter l'import :

```ts
import { dayOf } from "./filter.ts";
```

et à la fin du fichier :

```ts
/**
 * Largest gap, in the currency itself, still read as "the history comes back to the Starting
 * Cash". HTML statements round every amount to the cent, and a year of them was measured drifting
 * by up to 0.13; Flex amounts are exact. Defined here only.
 */
export const CASH_CHECK_TOLERANCE = 1;

/** One point of a Cash Report: Starting Cash at the start of a file's period, Ending Cash at its end. */
export interface CashPoint {
  currency: string;
  kind: "start" | "end";
  /** YYYY-MM-DD */
  asOf: string;
  amount: number;
}

export interface CashCheck {
  currency: string;
  /** Added to every raw balance of this currency; 0 without an end point. */
  offset: number;
  end: { asOf: string; amount: number } | null;
  /** `balance` is the anchored balance at the close of the day before `asOf`; `gap` is rounded to the cent. */
  start: { asOf: string; amount: number; balance: number; gap: number } | null;
}

/** Raw balance of one currency after the last row whose day passes `accept`, rows in reference order. */
function rawBalanceUpTo(rows: readonly LedgerRow[], currency: string, accept: (day: string) => boolean): number {
  let balance = 0;
  for (const row of rows) {
    if (!accept(dayOf(row.transaction.when))) break;
    balance = row.balances[currency];
  }
  return balance;
}

/** Rounded to the cent; `+ 0` turns a rounded -0 into 0. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/**
 * Running balances anchored on the Cash Reports of the files: each currency is shifted so that
 * its balance at the close of the end point's day is that point's Ending Cash, then checked
 * against the start point's Starting Cash at the close of the day before it. A gap left over is
 * what the history misses or has too much of. Currencies without an end point stay raw.
 *
 * Pure: the points come from the caller, never from a store.
 */
export function anchoredBalances(
  transactions: readonly Transaction[],
  currencies: readonly string[],
  points: readonly CashPoint[],
): { rows: LedgerRow[]; checks: CashCheck[] } {
  const raw = runningBalances(transactions, currencies);
  const checks = currencies.map((currency): CashCheck => {
    const endPoint = points.find((point) => point.currency === currency && point.kind === "end");
    const startPoint = points.find((point) => point.currency === currency && point.kind === "start");
    const offset = endPoint ? endPoint.amount - rawBalanceUpTo(raw, currency, (day) => day <= endPoint.asOf) : 0;
    let start: CashCheck["start"] = null;
    if (startPoint) {
      const balance = rawBalanceUpTo(raw, currency, (day) => day < startPoint.asOf) + offset;
      start = { asOf: startPoint.asOf, amount: startPoint.amount, balance, gap: toCents(balance - startPoint.amount) };
    }
    return { currency, offset, end: endPoint ? { asOf: endPoint.asOf, amount: endPoint.amount } : null, start };
  });
  const offsets = new Map(checks.map((check) => [check.currency, check.offset]));
  const rows = raw.map((row) => ({
    ...row,
    balances: Object.fromEntries(Object.entries(row.balances).map(([currency, value]) => [currency, value + (offsets.get(currency) ?? 0)])),
  }));
  return { rows, checks };
}

/** `null` without a start point to check against; otherwise whether the gap stays within the tolerance. */
export function isCashCheckOk(check: CashCheck): boolean | null {
  if (check.start === null) return null;
  return Math.abs(check.start.gap) <= CASH_CHECK_TOLERANCE;
}
```

`packages/ledger/src/index.ts` exporte déjà `./cash.ts` : rien à y ajouter.

- [x] **Step 4 : lancer les tests, les voir passer**

Run: `pnpm --filter @ib/ledger test`
Expected: PASS.

- [x] **Step 5 : commit**

Cocher les cases, puis :

```bash
git add packages/ledger/src/cash.ts packages/ledger/src/cash.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(ledger): anchoredBalances cale le solde sur le cash de fin et mesure l'écart au début

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 5 : oracles du cash côté paquets

**Files:**
- Create: `packages/ib-parsers/src/cash.oracle.test.ts`, `packages/ib-parsers/src/cash.private.test.ts`

**Interfaces:**
- Consomme : `parseActivityStatement` et `parseFlexXml` avec `cashReport` (tâches 1-2), `anchoredBalances`, `isCashCheckOk`, `planImport` (`@ib/ledger`).
- Produit : deux oracles, rien d'exporté.

- [x] **Step 1 : écrire l'oracle versionné**

`packages/ib-parsers/src/cash.oracle.test.ts` :

```ts
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anchoredBalances, isCashCheckOk, planImport, type CashPoint, type Transaction } from "@ib/ledger";
import type { CashReport } from "./snapshot.ts";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const YEARS = ["2022", "2023", "2024"] as const;

/**
 * The corpus replayed as `importFile` would, anchored on its own Cash Reports. USD only: the
 * anonymizer rewrites EUR amounts of the ledger without rewriting the Cash Report the same way
 * (spec of sub-project 9, §2.3), so an EUR check here would test the anonymizer.
 */
describe("the anonymized corpus, anchored on its own Cash Reports", () => {
  it("comes back to the Starting Cash of the account's opening in USD, within the tolerance", () => {
    const ledger = new Map<string, Transaction>();
    const reports: CashReport[] = [];
    for (const year of YEARS) {
      const html = readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8");
      const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(html)![1];
      const parsed = parseActivityStatement(html, { accountId: "corpus", ibAccountId });
      const period = { start: parsed.statement!.periodStart, end: parsed.statement!.periodEnd };
      const plan = planImport([...ledger.values()], { source: "statement_html", transactions: parsed.transactions, period });
      for (const externalId of plan.delete) ledger.delete(externalId);
      for (const tx of plan.upsert) ledger.set(tx.externalId, tx);
      reports.push(parsed.cashReport!);
    }
    const points: CashPoint[] = [
      { currency: "USD", kind: "start", asOf: reports[0].start.asOf, amount: reports[0].start.balances.USD },
      { currency: "USD", kind: "end", asOf: reports[2].end.asOf, amount: reports[2].end.balances.USD },
    ];
    const [usd] = anchoredBalances([...ledger.values()], ["USD"], points).checks;
    expect(usd.start?.amount).toBe(0);
    expect(isCashCheckOk(usd)).toBe(true);
  });
});
```

- [x] **Step 2 : écrire l'oracle privé de beta**

`packages/ib-parsers/src/cash.private.test.ts` :

```ts
/// <reference types="node" />
// The real Flex of beta, on the author's machine only. The account id is read from the file
// itself, never written here, and no amount is: the check is a gap, and it must be nil.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anchoredBalances, planImport, type CashPoint } from "@ib/ledger";
import { parseFlexXml } from "./flex.ts";

const PRIVATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../private/flex_<compte>_<date>.xml");

// Vitest still runs a skipped describe's factory body: every read happens inside the it().
describe.skipIf(!existsSync(PRIVATE_PATH))("the cash of beta, from its Flex alone", () => {
  it("comes back to its Starting Cash to the cent, the response reaching the account's opening", () => {
    const xml = readFileSync(PRIVATE_PATH, "utf8");
    const ibAccountId = /accountId="([^"]+)"/.exec(xml)?.[1] ?? "";
    const result = parseFlexXml(xml, { accountId: "beta", ibAccountId });
    const period = { start: result.statement!.fromDate, end: result.statement!.toDate };
    // What importFile writes: planImport leaves out a late adjustment dated before the window.
    const { upsert } = planImport([], { source: "flex", transactions: result.transactions, period });
    const report = result.cashReport!;
    const points: CashPoint[] = [
      { currency: "USD", kind: "start", asOf: report.start.asOf, amount: report.start.balances.USD },
      { currency: "USD", kind: "end", asOf: report.end.asOf, amount: report.end.balances.USD },
    ];
    const [usd] = anchoredBalances(upsert, ["USD"], points).checks;
    expect(usd.start?.gap).toBe(0);
  });
});
```

- [x] **Step 3 : lancer les deux oracles**

Run: `pnpm --filter @ib/ib-parsers test src/cash.oracle.test.ts src/cash.private.test.ts`
Expected: PASS (le test privé est sauté sur une machine sans `private/`, et doit passer sur celle de l'auteur).

Ces oracles portent sur du code déjà écrit : ils doivent passer d'emblée. **S'ils échouent, ne pas toucher à la tolérance ni aux fixtures** : un écart est un défaut du parseur ou du calcul, à trouver et à signaler.

- [x] **Step 4 : commit**

Cocher les cases, puis :

```bash
git add packages/ib-parsers/src/cash.oracle.test.ts packages/ib-parsers/src/cash.private.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "test(ib-parsers): le corpus et beta retrouvent leur cash d'ouverture

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 6 : schéma version 6 et fusion des points de cash

**Files:**
- Create: `apps/web/src/db/cashPoints.ts`, `apps/web/src/db/cashPoints.test.ts`
- Modify: `apps/web/src/db/schema.ts:49-58,95-131`
- Test: `apps/web/src/db/schema.test.ts:30-72`

**Interfaces:**
- Consomme : `CashReport` (`@ib/ib-parsers`).
- Produit :
  - `SnapshotRecord.source: "flex" | "statement_html" | "agent"`
  - `interface CashPointRecord { accountId: string; currency: string; kind: "start" | "end"; asOf: string; amount: number; source: "flex" | "statement_html"; importedAt: string }`
  - `AppDatabase.cashPoints: Table<CashPointRecord, [string, string, string]>`, clé `[accountId+currency+kind]`, index `accountId`
  - `mergeCashPoints(accountId: string, current: readonly CashPointRecord[], report: CashReport, source: CashPointRecord["source"], at: string): CashPointRecord[]` — rend **seulement** les enregistrements à écrire

- [x] **Step 1 : écrire les tests de fusion**

`apps/web/src/db/cashPoints.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { CashReport } from "@ib/ib-parsers";
import { mergeCashPoints } from "./cashPoints";
import type { CashPointRecord } from "./schema";

const report = (startAsOf: string, endAsOf: string, balances: Record<string, [number, number]>): CashReport => ({
  start: { asOf: startAsOf, balances: Object.fromEntries(Object.entries(balances).map(([c, [s]]) => [c, s])) },
  end: { asOf: endAsOf, balances: Object.fromEntries(Object.entries(balances).map(([c, [, e]]) => [c, e])) },
});

const point = (currency: string, kind: "start" | "end", asOf: string, amount: number, source: CashPointRecord["source"] = "flex"): CashPointRecord => ({
  accountId: "test", currency, kind, asOf, amount, source, importedAt: "before",
});

describe("mergeCashPoints", () => {
  it("writes both points of every currency on an empty table, with the source and the instant", () => {
    const written = mergeCashPoints("test", [], report("2025-01-01", "2025-12-31", { USD: [1000, 2803.63], EUR: [0, 7597.7] }), "statement_html", "now");
    expect(written).toEqual([
      { accountId: "test", currency: "USD", kind: "start", asOf: "2025-01-01", amount: 1000, source: "statement_html", importedAt: "now" },
      { accountId: "test", currency: "EUR", kind: "start", asOf: "2025-01-01", amount: 0, source: "statement_html", importedAt: "now" },
      { accountId: "test", currency: "USD", kind: "end", asOf: "2025-12-31", amount: 2803.63, source: "statement_html", importedAt: "now" },
      { accountId: "test", currency: "EUR", kind: "end", asOf: "2025-12-31", amount: 7597.7, source: "statement_html", importedAt: "now" },
    ]);
  });

  it("moves the end point to a later or same-day file, never to an earlier one", () => {
    const current = [point("USD", "end", "2026-09-02", 5)];
    const later = mergeCashPoints("test", current, report("2026-01-01", "2026-09-09", { USD: [1, 6] }), "statement_html", "now");
    expect(later.filter((p) => p.kind === "end")).toEqual([expect.objectContaining({ asOf: "2026-09-09", amount: 6 })]);
    const sameDay = mergeCashPoints("test", current, report("2026-01-01", "2026-09-02", { USD: [1, 7] }), "statement_html", "now");
    expect(sameDay.filter((p) => p.kind === "end")).toEqual([expect.objectContaining({ asOf: "2026-09-02", amount: 7 })]);
    const earlier = mergeCashPoints("test", current, report("2025-01-01", "2025-12-31", { USD: [1, 8] }), "statement_html", "now");
    expect(earlier.filter((p) => p.kind === "end")).toEqual([]);
  });

  it("moves the start point to an earlier or same-day file, never to a later one", () => {
    const current = [point("USD", "start", "2025-09-03", 5)];
    const earlier = mergeCashPoints("test", current, report("2025-01-01", "2025-12-31", { USD: [1, 6] }), "statement_html", "now");
    expect(earlier.filter((p) => p.kind === "start")).toEqual([expect.objectContaining({ asOf: "2025-01-01", amount: 1 })]);
    const sameDay = mergeCashPoints("test", current, report("2025-09-03", "2026-09-02", { USD: [2, 6] }), "flex", "now");
    expect(sameDay.filter((p) => p.kind === "start")).toEqual([expect.objectContaining({ asOf: "2025-09-03", amount: 2, source: "flex" })]);
    const later = mergeCashPoints("test", current, report("2025-09-04", "2026-09-03", { USD: [3, 6] }), "flex", "now");
    expect(later.filter((p) => p.kind === "start")).toEqual([]);
  });

  it("writes nothing for a currency the report does not list: an older point stays true at its date", () => {
    const current = [point("EUR", "start", "2025-01-01", 0), point("EUR", "end", "2025-12-31", 7597.7)];
    const written = mergeCashPoints("test", current, report("2025-09-03", "2026-09-02", { USD: [0, 1] }), "flex", "now");
    expect(written.map((p) => p.currency)).toEqual(["USD", "USD"]);
  });
});
```

- [x] **Step 2 : adapter le test de migration**

Dans `apps/web/src/db/schema.test.ts`, renommer le `describe` en `"AppDatabase upgrades"`, remplacer `expect(upgraded.verno).toBe(5);` par `expect(upgraded.verno).toBe(6);` et ajouter, après l'assertion sur `statements` :

```ts
      // Version 6 adds the cash points: none until a file with a Cash Report is imported.
      expect(await upgraded.cashPoints.count()).toBe(0);
```

- [x] **Step 3 : lancer les tests, les voir échouer**

Run: `pnpm --filter web test src/db/cashPoints.test.ts src/db/schema.test.ts`
Expected: FAIL — module `./cashPoints` introuvable, `verno` à 5.

- [x] **Step 4 : implémenter le schéma**

Dans `apps/web/src/db/schema.ts` :

1. Remplacer `SnapshotRecord` :

```ts
/** The current positions of one account: one document, replaced whole. */
export interface SnapshotRecord {
  accountId: string;
  source: "flex" | "statement_html" | "agent";
  /** Flex or statement: YYYY-MM-DD of the close. Agent: the full ISO instant of the pass. */
  asOf: string;
  importedAt: string;
  positions: Position[];
  cashAvailable: number | null;
}

/**
 * One point of the Cash Reports of one account's files: per currency, the latest Ending Cash the
 * running balance is anchored on and the oldest Starting Cash it is checked against. Written by
 * file imports and statement replays only, never by the agent.
 */
export interface CashPointRecord {
  accountId: string;
  currency: string;
  kind: "start" | "end";
  /** YYYY-MM-DD */
  asOf: string;
  amount: number;
  source: "flex" | "statement_html";
  importedAt: string;
}
```

2. Dans la classe, déclarer la table après `contracts` :

```ts
  cashPoints!: Table<CashPointRecord, [string, string, string]>;
```

3. Après `this.version(5)…`, ajouter :

```ts
    // Additive: adds the `cashPoints` table and rewrites no existing row.
    this.version(6).stores({
      cashPoints: "[accountId+currency+kind], accountId",
    });
```

- [x] **Step 5 : implémenter la fusion**

`apps/web/src/db/cashPoints.ts` :

```ts
import type { CashReport } from "@ib/ib-parsers";
import type { CashPointRecord } from "./schema";

/**
 * Folds the Cash Report of one file into the points already held, and returns only the records
 * to write. The end point moves to a later or same-day file — it is what the balance is anchored
 * on; the start point moves to an earlier or same-day file — it is what the balance is checked
 * against, and a Flex window advancing every day must not push it forward, since the rows of the
 * earlier syncs stay in the ledger. On a tie the incoming file wins. A currency the report does
 * not list keeps its points: an older point is still true at its own date.
 */
export function mergeCashPoints(
  accountId: string,
  current: readonly CashPointRecord[],
  report: CashReport,
  source: CashPointRecord["source"],
  at: string,
): CashPointRecord[] {
  const written: CashPointRecord[] = [];
  for (const kind of ["start", "end"] as const) {
    const values = report[kind];
    for (const [currency, amount] of Object.entries(values.balances)) {
      const existing = current.find((point) => point.currency === currency && point.kind === kind);
      const wins = !existing || (kind === "end" ? values.asOf >= existing.asOf : values.asOf <= existing.asOf);
      if (wins) written.push({ accountId, currency, kind, asOf: values.asOf, amount, source, importedAt: at });
    }
  }
  return written;
}
```

- [x] **Step 6 : lancer les tests, les voir passer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 7 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/db/schema.ts apps/web/src/db/schema.test.ts apps/web/src/db/cashPoints.ts apps/web/src/db/cashPoints.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(web): table cashPoints (Dexie 6) et règle de fusion des points de cash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 7 : l'import écrit le snapshot d'un relevé et les points de cash

**Files:**
- Modify: `apps/web/src/db/importFile.ts:76-130`
- Test: `apps/web/src/db/importFile.test.ts:255-303`

**Interfaces:**
- Consomme : `parsed.snapshot`, `parsed.cashReport` (tâches 1-3), `mergeCashPoints`, `db.cashPoints` (tâche 6), `shouldReplaceSnapshot` (existant).
- Produit : `importFile` écrit un snapshot de source `statement_html` et les points de cash des deux formats, dans sa transaction.

- [x] **Step 1 : écrire les tests**

Dans `apps/web/src/db/importFile.test.ts` :

1. Sous la déclaration de `file`, ajouter :

```ts
/** The fixture again, declaring 2024: an older statement with the very same sections. */
const olderStatement = statementHtml.replace(
  "Activity Statement January 1, 2025 - December 31, 2025",
  "Activity Statement January 1, 2024 - December 31, 2024",
);

/** The account's cash points in a stable order, without the instant of the write. */
async function pointsOf() {
  const rows = await db.cashPoints.where("accountId").equals("test").toArray();
  return rows
    .map(({ importedAt: _importedAt, accountId: _accountId, ...rest }) => rest)
    .sort((a, b) => `${a.currency}|${a.kind}`.localeCompare(`${b.currency}|${b.kind}`));
}
```

2. Remplacer le test `"leaves the snapshot alone on a statement import and on a Flex without Open Positions"` par ces deux-là :

```ts
  it("keeps a newer Flex snapshot against an older statement, and says so", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report).toMatchObject({ status: "ok", positions: null, cashAvailable: null, staleSnapshot: true });
    expect(await db.snapshots.get("test")).toMatchObject({ source: "flex", asOf: "2026-09-02" });
  });

  it("leaves the snapshot alone on a Flex without Open Positions", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const noPositions = flexXml.replace(/<OpenPositions>[\s\S]*?<\/OpenPositions>/, "");
    const report = await importFile(db, account, file(noPositions, "bare.xml"));
    expect(report).toMatchObject({ status: "ok", positions: null, cashAvailable: null, staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.positions).toHaveLength(30);
  });
```

3. Ajouter à la fin du fichier :

```ts
describe("importFile: a statement alone", () => {
  it("writes the statement's positions and cash as the account's snapshot", async () => {
    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report).toMatchObject({ status: "ok", positions: 3, cashAvailable: 2803.63, staleSnapshot: false });
    const snapshot = await db.snapshots.get("test");
    expect(snapshot).toMatchObject({ accountId: "test", source: "statement_html", asOf: "2025-12-31", cashAvailable: 2803.63 });
    expect(snapshot?.positions.map((p) => p.description)).toEqual(["TESTE", "TWINX", "TESTX 16JAN26 15 P"]);
    const [record] = await db.imports.toArray();
    expect(record).toMatchObject({ positions: 3, cashAvailable: 2803.63 });
  });

  it("lets a newer Flex replace the statement's snapshot", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(flexXml, "flex.xml"));
    expect(await db.snapshots.get("test")).toMatchObject({ source: "flex", asOf: "2026-09-02" });
  });

  it("writes both cash points of every currency", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(await pointsOf()).toEqual([
      { currency: "EUR", kind: "end", asOf: "2025-12-31", amount: 7597.7, source: "statement_html" },
      { currency: "EUR", kind: "start", asOf: "2025-01-01", amount: 0, source: "statement_html" },
      { currency: "USD", kind: "end", asOf: "2025-12-31", amount: 2803.63, source: "statement_html" },
      { currency: "USD", kind: "start", asOf: "2025-01-01", amount: 1000, source: "statement_html" },
    ]);
  });

  it("moves the end point forward and the start point back as the files come in", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    expect(await pointsOf()).toEqual([
      { currency: "EUR", kind: "end", asOf: "2026-09-02", amount: 12.4587, source: "flex" },
      { currency: "EUR", kind: "start", asOf: "2024-01-01", amount: 0, source: "statement_html" },
      { currency: "USD", kind: "end", asOf: "2026-09-02", amount: 29959.4677, source: "flex" },
      { currency: "USD", kind: "start", asOf: "2024-01-01", amount: 1000, source: "statement_html" },
    ]);
  });

  it("keeps the statement's cash points through a Flex without Cash Report", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await pointsOf();
    const noCash = flexXml.replace(/<CashReport>[\s\S]*?<\/CashReport>/, "");
    await importFile(db, account, file(noCash, "flex.xml"));
    expect(await pointsOf()).toEqual(before);
  });

  it("rolls the cash points and the snapshot back with everything else", async () => {
    const spy = vi.spyOn(db.imports, "add").mockRejectedValueOnce(new Error("boom"));
    try {
      await expect(importFile(db, account, file(statementHtml, "2025.htm"))).rejects.toThrow("boom");
    } finally {
      spy.mockRestore();
    }
    expect(await db.cashPoints.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);
  });
});
```

- [x] **Step 2 : lancer les tests, les voir échouer**

Run: `pnpm --filter web test src/db/importFile.test.ts`
Expected: FAIL — pas de snapshot de relevé, aucun point de cash.

- [x] **Step 3 : implémenter**

Dans `apps/web/src/db/importFile.ts` :

1. Ajouter l'import :

```ts
import { mergeCashPoints } from "./cashPoints";
```

2. Remplacer la ligne provisoire de la tâche 3 par :

```ts
  const snapshot = parsed.snapshot;
```

3. Remplacer l'ouverture de la transaction :

```ts
  // Seven tables: past five, Dexie's typed overloads want the array form.
  await db.transaction(
    "rw",
    [db.transactions, db.imports, db.accounts, db.snapshots, db.statements, db.contracts, db.cashPoints],
    async () => {
```

(et fermer la parenthèse supplémentaire à la fin du bloc : `},\n  );`).

4. Dans le bloc du snapshot, remplacer `{ source: "flex", asOf: snapshot.asOf }` par `{ source, asOf: snapshot.asOf }` et `source: "flex",` dans `db.snapshots.put` par `source,`.

5. Juste après le bloc du snapshot, ajouter :

```ts
      if (parsed.cashReport) {
        const currentPoints = await db.cashPoints.where("accountId").equals(account.id).toArray();
        await db.cashPoints.bulkPut(mergeCashPoints(account.id, currentPoints, parsed.cashReport, source, at));
      }
```

- [x] **Step 4 : lancer les tests, les voir passer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. `SourcesPage.test.tsx` (« purges the derived rows ») et `clearDerived.test.ts` comptent toujours un seul snapshot : le Flex, plus récent, garde sa place.

- [x] **Step 5 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/db/importFile.ts apps/web/src/db/importFile.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(web): l'import d'un relevé écrit son snapshot, tout fichier ses points de cash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 8 : « Relire les relevés » reconstruit snapshot et points de cash

**Files:**
- Modify: `apps/web/src/db/replayStatements.ts`
- Test: `apps/web/src/db/replayStatements.test.ts`

**Interfaces:**
- Consomme : `FileSnapshot`, `CashReport` (`@ib/ib-parsers`), `mergeCashPoints`, `CashPointRecord` (tâche 6), `shouldReplaceSnapshot`.
- Produit : `replayStatements` et `deleteStatement` tiennent `snapshots` et `cashPoints` à jour (spec §4.1, §4.2).

- [x] **Step 1 : écrire les tests**

Dans `apps/web/src/db/replayStatements.test.ts`, ajouter sous `ledgerOf` :

```ts
async function pointsOf() {
  const rows = await db.cashPoints.where("accountId").equals("test").toArray();
  return rows
    .map(({ importedAt: _importedAt, accountId: _accountId, ...rest }) => rest)
    .sort((a, b) => `${a.currency}|${a.kind}`.localeCompare(`${b.currency}|${b.kind}`));
}
```

et à la fin du fichier :

```ts
describe("replayStatements: positions and cash points", () => {
  it("puts back the snapshot of the latest statement", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await db.snapshots.clear();

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html", asOf: "2025-12-31", cashAvailable: 2803.63 });
  });

  it("falls back on the statement that remains when the one holding the snapshot is deleted, and drops it with the last", async () => {
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const [older, newer] = (await db.statements.toArray()).sort((a, b) => a.period.start.localeCompare(b.period.start));

    await deleteStatement(db, account, newer.id);
    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html", asOf: "2024-12-31" });

    await deleteStatement(db, account, older.id);
    expect(await db.snapshots.get("test")).toBeUndefined();
  });

  it("never touches a newer Flex snapshot", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const flexSnapshot = await db.snapshots.get("test");

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toEqual(flexSnapshot);
  });

  it("replaces an older Flex snapshot, exactly as an import would", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await db.snapshots.put({ accountId: "test", source: "flex", asOf: "2025-06-30", importedAt: "", positions: [], cashAvailable: null });

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html", asOf: "2025-12-31" });
  });

  it("records the positions on the import of the statement that wrote the snapshot, and on no other", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await db.imports.clear();
    await db.snapshots.clear();

    await replayStatements(db, account);

    const records = await db.imports.orderBy("id").toArray();
    expect(records.map((r) => [r.fileName, r.positions, r.cashAvailable])).toEqual([
      ["2024.htm", null, null],
      ["2025.htm", 3, 2803.63],
    ]);
  });

  it("rebuilds the statement cash points over the Flex ones", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await pointsOf();
    const usdStart = (await db.cashPoints.get(["test", "USD", "start"]))!;
    await db.cashPoints.put({ ...usdStart, amount: 42 });

    await replayStatements(db, account);

    expect(await pointsOf()).toEqual(before);
    expect(before.filter((p) => p.kind === "end").map((p) => p.source)).toEqual(["flex", "flex"]);
  });

  it("moves the start points back to the statement that remains, and forgets them with the last one", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    const [older, newer] = (await db.statements.toArray()).sort((a, b) => a.period.start.localeCompare(b.period.start));

    await deleteStatement(db, account, older.id);
    expect((await pointsOf()).filter((p) => p.kind === "start").map((p) => p.asOf)).toEqual(["2025-01-01", "2025-01-01"]);

    await deleteStatement(db, account, newer.id);
    expect(await db.cashPoints.count()).toBe(0);
  });
});
```

- [x] **Step 2 : lancer les tests, les voir échouer**

Run: `pnpm --filter web test src/db/replayStatements.test.ts`
Expected: FAIL — snapshot absent après relecture, points non reconstruits.

- [x] **Step 3 : implémenter**

Dans `apps/web/src/db/replayStatements.ts` :

1. Remplacer les imports :

```ts
import { dayOf, planImport, type Transaction } from "@ib/ledger";
import {
  hasErrors,
  parseActivityStatement,
  type CashReport,
  type ContractIdentity,
  type FileSnapshot,
  type ParseIssue,
} from "@ib/ib-parsers";
import { mergeCashPoints } from "./cashPoints";
import { mergeContractRecords, type ContractRecord } from "./contracts";
import { statementId, type AccountRecord, type AppDatabase, type CashPointRecord, type StatementRecord } from "./schema";
import { shouldReplaceSnapshot } from "./snapshot";
```

2. Ajouter à `ParsedStatement` :

```ts
  snapshot: FileSnapshot | null;
  cashReport: CashReport | null;
```

et dans `parseAll`, au `parsed.push({...})` : `snapshot: result.snapshot, cashReport: result.cashReport,`.

3. Au début de `replayStatements`, juste après `const parsed = result.parsed;`, ajouter :

```ts
  // The statement snapshot a rebuild stands on: the one of the latest declared period, the last in
  // replay order on a tie — the very one an import of every file in that order would leave.
  let latest: ParsedStatement | null = null;
  for (const statement of parsed) {
    if (statement.snapshot && (!latest || statement.period.end >= latest.period.end)) latest = statement;
  }
```

4. Remplacer l'ouverture de la transaction par la forme tableau, avec les deux tables en plus :

```ts
  await db.transaction(
    "rw",
    [db.transactions, db.imports, db.statements, db.contracts, db.snapshots, db.cashPoints],
    async () => {
```

(fermer par `},\n  );`).

5. Au tout début du corps de la transaction, avant `const contracts = …`, ajouter :

```ts
    // A snapshot from a statement belongs to the statement layer and is rebuilt with it; a Flex or
    // agent snapshot is only replaced when an import of the latest statement would replace it.
    const currentSnapshot = await db.snapshots.get(account.id);
    const latestSnapshot = latest?.snapshot ?? null;
    const statementOwned = !currentSnapshot || currentSnapshot.source === "statement_html";
    const writeSnapshot =
      latestSnapshot !== null &&
      (statementOwned || shouldReplaceSnapshot(currentSnapshot, { source: "statement_html", asOf: latestSnapshot.asOf }));
    if (writeSnapshot) {
      await db.snapshots.put({
        accountId: account.id,
        source: "statement_html",
        asOf: latestSnapshot.asOf,
        importedAt: at,
        positions: latestSnapshot.positions,
        cashAvailable: latestSnapshot.cashAvailable,
      });
    } else if (statementOwned && currentSnapshot) {
      await db.snapshots.delete(account.id);
    }

    // Cash points: those of the other sources stand, those of the statements are laid again.
    const kept = (await db.cashPoints.where("accountId").equals(account.id).toArray()).filter(
      (point) => point.source !== "statement_html",
    );
    await db.cashPoints.where("accountId").equals(account.id).filter((point) => point.source === "statement_html").delete();
    let points: CashPointRecord[] = kept;
```

6. Dans la boucle `for (const statement of parsed)`, avant `await db.imports.add(...)`, ajouter :

```ts
      if (statement.cashReport) {
        const changed = mergeCashPoints(account.id, points, statement.cashReport, "statement_html", at);
        points = [...points.filter((p) => !changed.some((c) => c.currency === p.currency && c.kind === p.kind)), ...changed];
      }
```

et remplacer, dans `db.imports.add`, le commentaire et les deux champs de positions par :

```ts
        // A statement never retires another source's rows.
        dropped: [],
        issues: statement.issues,
        positions: writeSnapshot && statement === latest ? latestSnapshot!.positions.length : null,
        cashAvailable: writeSnapshot && statement === latest ? latestSnapshot!.cashAvailable : null,
```

7. Après `await db.contracts.bulkPut([...changedContracts.values()]);`, ajouter :

```ts
    await db.cashPoints.bulkPut(points.filter((point) => point.source === "statement_html"));
```

- [x] **Step 4 : lancer les tests, les voir passer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS, y compris les tests existants de `replayStatements.test.ts` et de `SourcesPage.test.tsx`.

- [x] **Step 5 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/db/replayStatements.ts apps/web/src/db/replayStatements.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(web): relire les relevés reconstruit leur snapshot et leurs points de cash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 9 : les purges effacent les points de cash

**Files:**
- Modify: `apps/web/src/db/clearDerived.ts`, `apps/web/src/db/accounts.ts:92-104`, `apps/web/src/i18n/fr.json` et `en.json` (`sources.purge`)
- Test: `apps/web/src/db/clearDerived.test.ts`, `apps/web/src/db/accounts.test.ts:48-90`, `apps/web/src/pages/SourcesPage.test.tsx:556-580`

**Interfaces:**
- Consomme : `db.cashPoints` (tâche 6), `replayStatements` (tâche 8).
- Produit : `ClearDerivedReport.cashPoints: number`.

- [x] **Step 1 : écrire les tests**

1. Dans `apps/web/src/db/clearDerived.test.ts`, test `"empties the four tables an import feeds"` : le renommer `"empties the five tables an import feeds"`, ajouter avant l'appel `expect(await db.cashPoints.count()).toBe(4);`, après l'appel `expect(await db.cashPoints.count()).toBe(0);`, et remplacer l'attente du compte rendu par :

```ts
    expect(report).toEqual({ transactions: expect.any(Number), contracts: expect.any(Number), snapshots: 1, cashPoints: 4, imports: 2 });
```

2. Dans `"touches no other account"`, ajouter `cashPoints: await db.cashPoints.where("accountId").equals("other").toArray(),` à `kept`, et après l'appel :

```ts
    expect(await db.cashPoints.where("accountId").equals("other").toArray()).toEqual(kept.cashPoints);
```

3. Ajouter à la fin du `describe` (en important `replayStatements` depuis `@/db/replayStatements`) :

```ts
  it("lets a statement replay bring the positions and the cash points back from the files", async () => {
    await db.accounts.put(account);
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await clearDerived(db, account);
    expect(await db.snapshots.count()).toBe(0);

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html" });
    expect(await db.cashPoints.count()).toBe(4);
  });
```

4. Dans `apps/web/src/db/accounts.test.ts`, test de `deleteAccount`, avant `setLastAccountId("a");` :

```ts
    const cashPoint = { currency: "USD", kind: "end" as const, asOf: "2025-12-31", amount: 1, source: "flex" as const, importedAt: "" };
    await db.cashPoints.bulkPut([
      { ...cashPoint, accountId: "a" },
      { ...cashPoint, accountId: "b" },
    ]);
```

et après les autres attentes :

```ts
    expect((await db.cashPoints.toArray()).map((p) => p.accountId)).toEqual(["b"]);
```

5. Dans `apps/web/src/pages/SourcesPage.test.tsx`, test `"purges the derived rows once confirmed…"`, ajouter avant le clic `expect(await db.cashPoints.count()).toBeGreaterThan(0);` et après `await screen.findByTestId("purge-report");` `expect(await db.cashPoints.count()).toBe(0);`.

- [x] **Step 2 : lancer les tests, les voir échouer**

Run: `pnpm --filter web test src/db/clearDerived.test.ts src/db/accounts.test.ts src/pages/SourcesPage.test.tsx`
Expected: FAIL — les points survivent aux purges.

- [x] **Step 3 : implémenter**

`apps/web/src/db/clearDerived.ts`, en entier :

```ts
import type { AccountRecord, AppDatabase } from "./schema";

/** What the purge actually removed, so the page can tell the user rather than guess. */
export interface ClearDerivedReport {
  transactions: number;
  contracts: number;
  snapshots: number;
  cashPoints: number;
  imports: number;
}

/**
 * Drops everything one account's imports have *derived* — the ledger, the contract identities,
 * the positions snapshot, the cash points and the import journal — and nothing else. The account
 * record (label, Flex credentials, TWS port), the statements kept for it and the shared sector
 * table all survive: the point is to recompute from the files already held, not to make the user
 * set the account up again.
 *
 * A statement replay brings back transactions, contracts, the statement snapshot and the
 * statement cash points; a Flex sync brings back its own; an agent pass only its transactions,
 * contracts and snapshot. Callers must hold `withImportLock` (see `importLock.ts`), as for an
 * import: these are the rows an import writes.
 */
export async function clearDerived(db: AppDatabase, account: AccountRecord): Promise<ClearDerivedReport> {
  const report: ClearDerivedReport = { transactions: 0, contracts: 0, snapshots: 0, cashPoints: 0, imports: 0 };
  await db.transaction("rw", [db.transactions, db.contracts, db.snapshots, db.cashPoints, db.imports], async () => {
    report.transactions = await db.transactions.where("accountId").equals(account.id).delete();
    report.contracts = await db.contracts.where("accountId").equals(account.id).delete();
    report.snapshots = await db.snapshots.where("accountId").equals(account.id).delete();
    report.cashPoints = await db.cashPoints.where("accountId").equals(account.id).delete();
    report.imports = await db.imports.where("accountId").equals(account.id).delete();
  });
  return report;
}
```

`apps/web/src/db/accounts.ts`, `deleteAccount` :

```ts
export async function deleteAccount(db: AppDatabase, id: string): Promise<void> {
  // Seven tables: Dexie's varargs overloads stop at five, so the list goes in as an array.
  await db.transaction(
    "rw",
    [db.accounts, db.transactions, db.imports, db.snapshots, db.statements, db.contracts, db.cashPoints],
    async () => {
      await db.transactions.where("accountId").equals(id).delete();
      await db.imports.where("accountId").equals(id).delete();
      await db.snapshots.delete(id);
      await db.statements.where("accountId").equals(id).delete();
      await db.contracts.where("accountId").equals(id).delete();
      await db.cashPoints.where("accountId").equals(id).delete();
      await db.accounts.delete(id);
    },
  );
  if (getLastAccountId() === id) clearLastAccountId();
}
```

`apps/web/src/i18n/fr.json`, dans `sources.purge`, remplacer `confirm`, `done_one`, `done_other` :

```json
      "confirm": "Supprimer l'historique ({{transactions}} lignes), les contrats, les positions, les points de cash et le journal d'import de ce compte ? Vos {{statements}} relevés conservés, la configuration Flex/TWS et la table sectorielle restent en place. « Relire les relevés » reconstruit l'historique, les contrats, les positions et le cash venus des relevés ; une synchronisation Flex reconstruit les siens.",
      "done_one": "{{count}} ligne d'historique et {{contracts}} contrats supprimés, avec les positions, les points de cash et le journal d'import.",
      "done_other": "{{count}} lignes d'historique et {{contracts}} contrats supprimés, avec les positions, les points de cash et le journal d'import.",
```

`apps/web/src/i18n/en.json`, mêmes clés :

```json
      "confirm": "Delete this account's history ({{transactions}} rows), contracts, positions, cash points and import journal? Your {{statements}} kept statements, the Flex/TWS settings and the sector table stay in place. “Replay statements” rebuilds the history, contracts, positions and cash the statements brought; a Flex sync rebuilds its own.",
      "done_one": "{{count}} history row and {{contracts}} contracts deleted, along with the positions, the cash points and the import journal.",
      "done_other": "{{count}} history rows and {{contracts}} contracts deleted, along with the positions, the cash points and the import journal.",
```

- [x] **Step 4 : lancer les tests, les voir passer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/db/clearDerived.ts apps/web/src/db/clearDerived.test.ts apps/web/src/db/accounts.ts apps/web/src/db/accounts.test.ts apps/web/src/pages/SourcesPage.test.tsx apps/web/src/i18n docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(web): les purges effacent les points de cash, la relecture les rend

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 10 : la carte « Cohérence du cash » et l'Historique calé

**Files:**
- Create: `apps/web/src/components/CashCheckCard.tsx`, `apps/web/src/components/CashCheckCard.test.tsx`
- Modify: `apps/web/src/db/hooks.ts`, `apps/web/src/pages/HistoryPage.tsx:1-60,140-160`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/HistoryPage.test.tsx`

**Interfaces:**
- Consomme : `anchoredBalances`, `isCashCheckOk`, `CashCheck` (tâche 4), `db.cashPoints` (tâche 6).
- Produit :
  - `useCashPoints(accountId: string): CashPointRecord[] | undefined`
  - `CashCheckCard({ accountId: string; checks: CashCheck[] })`
  - clés i18n `cashCheck.ok|gap|anchored|none|hint|noneHint|noneLink`

- [x] **Step 1 : écrire les tests de la carte**

`apps/web/src/components/CashCheckCard.test.tsx` :

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import type { CashCheck } from "@ib/ledger";
import i18n from "@/i18n";
import { CashCheckCard } from "@/components/CashCheckCard";

function renderCard(checks: CashCheck[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <CashCheckCard accountId="beta" checks={checks} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const END = { asOf: "2026-09-09", amount: 12345.67 };

describe("CashCheckCard", () => {
  it("says the balance comes back to the Starting Cash, within how much", () => {
    renderCard([{ currency: "USD", offset: 0.06, end: END, start: { asOf: "2022-01-01", amount: 0, balance: 0.06, gap: 0.06 } }]);
    expect(
      screen.getByText("USD : solde calé sur le cash de fin du 2026-09-09 (12,345.67), retrouvé au 2022-01-01 sur le Starting Cash (0.00) à 0.06 près"),
    ).toBeInTheDocument();
    expect(screen.getByText("OK")).toHaveClass("text-success");
    expect(screen.queryByText(/historique incomplet/)).not.toBeInTheDocument();
  });

  it("shows a gap beyond the tolerance, signed, with the hint", () => {
    renderCard([{ currency: "EUR", offset: 0, end: END, start: { asOf: "2025-01-01", amount: 1000, balance: 987.5, gap: -12.5 } }]);
    expect(screen.getByText("-12.50")).toHaveClass("text-warning");
    expect(
      screen.getByText("EUR : solde calé sur le cash de fin du 2026-09-09 (12,345.67), mais 987.50 au 2025-01-01 contre un Starting Cash de 1,000.00"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Un historique incomplet/)).toBeInTheDocument();
  });

  it("says when the start was never checked", () => {
    renderCard([{ currency: "USD", offset: 3, end: END, start: null }]);
    expect(screen.getByText("USD : solde calé sur le cash de fin du 2026-09-09 (12,345.67), début non vérifié")).toBeInTheDocument();
  });

  it("says when no Cash Report anchors a currency, and points at the data sources", () => {
    renderCard([{ currency: "USD", offset: 0, end: null, start: null }]);
    expect(screen.getByText("USD : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
    expect(screen.getByText(/Ajoutez la section Cash Report/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
  });
});
```

- [x] **Step 2 : écrire les tests de l'Historique**

Dans `apps/web/src/pages/HistoryPage.test.tsx` :

1. `beforeEach` : `await Promise.all([db.transactions.clear(), db.accounts.clear(), db.cashPoints.clear()]);`

2. Remplacer le test `"warns on the balance headers that the level is only as deep as the history"` par :

```tsx
  it("says on the balance headers what the balances are anchored on", async () => {
    await seed();
    renderHistory();
    const usdHeader = await screen.findByRole("columnheader", { name: "Cash USD" });
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
    expect(screen.getByRole("columnheader", { name: "Cash EUR" })).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
  });

  it("anchors the balances on the end point of the Cash Report", async () => {
    await seed();
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderHistory();
    // Raw USD ends on -18,543.15: the whole column moves by 20,000.
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("1,456.85");
    expect(within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("20,000.00");
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
    expect(screen.getByText("USD : solde calé sur le cash de fin du 2026-12-31 (1,456.85), début non vérifié")).toBeInTheDocument();
  });

  it("says when no Cash Report anchors the balances", async () => {
    await seed();
    renderHistory();
    expect(await screen.findByText("USD : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
    expect(screen.getByText("EUR : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
  });

  it("shows no cash card on an empty ledger", async () => {
    renderHistory();
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
    expect(screen.queryByText(/aucun Cash Report/)).not.toBeInTheDocument();
  });
```

- [x] **Step 3 : lancer les tests, les voir échouer**

Run: `pnpm --filter web test src/components/CashCheckCard.test.tsx src/pages/HistoryPage.test.tsx`
Expected: FAIL — composant absent, clés i18n absentes, soldes bruts.

- [x] **Step 4 : ajouter les textes**

`apps/web/src/i18n/fr.json` : remplacer `history.columns.balanceHint` par

```json
      "balanceHint": "Solde cumulé sur toutes les transactions en base — les filtres ne le modifient pas. Il est calé sur le cash de fin du fichier le plus récent qui porte un Cash Report ; la carte au-dessus du tableau dit s'il retombe sur le cash de début."
```

et ajouter, au premier niveau, après `"reconciliation": {…},` :

```json
  "cashCheck": {
    "ok": "{{currency}} : solde calé sur le cash de fin du {{end}} ({{endAmount}}), retrouvé au {{start}} sur le Starting Cash ({{startAmount}}) à {{gap}} près",
    "gap": "{{currency}} : solde calé sur le cash de fin du {{end}} ({{endAmount}}), mais {{balance}} au {{start}} contre un Starting Cash de {{startAmount}}",
    "anchored": "{{currency}} : solde calé sur le cash de fin du {{end}} ({{endAmount}}), début non vérifié",
    "none": "{{currency}} : aucun Cash Report, le solde part de 0",
    "hint": "Un historique incomplet, ou un relevé qui finit après la dernière synchro Flex, suffit à l'expliquer.",
    "noneHint": "Ajoutez la section Cash Report à la Flex Query, ou importez un relevé HTML.",
    "noneLink": "Aller aux sources de données"
  },
```

`apps/web/src/i18n/en.json` : mêmes emplacements :

```json
      "balanceHint": "Running balance over every transaction on record — filters do not change it. It is anchored on the ending cash of the latest file carrying a Cash Report; the card above the table says whether it comes back to the starting cash."
```

```json
  "cashCheck": {
    "ok": "{{currency}}: balance anchored on the ending cash of {{end}} ({{endAmount}}), back to the Starting Cash of {{start}} ({{startAmount}}) within {{gap}}",
    "gap": "{{currency}}: balance anchored on the ending cash of {{end}} ({{endAmount}}), but {{balance}} on {{start}} against a Starting Cash of {{startAmount}}",
    "anchored": "{{currency}}: balance anchored on the ending cash of {{end}} ({{endAmount}}), start not checked",
    "none": "{{currency}}: no Cash Report, the balance starts from 0",
    "hint": "An incomplete history, or a statement ending after the last Flex sync, is enough to explain it.",
    "noneHint": "Add the Cash Report section to the Flex Query, or import an HTML statement.",
    "noneLink": "Go to data sources"
  },
```

- [x] **Step 5 : écrire le hook et la carte**

Dans `apps/web/src/db/hooks.ts`, ajouter `CashPointRecord` à l'import de types depuis `./schema`, et après `useSnapshot` :

```ts
/** The cash points of one account; `undefined` while loading. */
export function useCashPoints(accountId: string): CashPointRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.cashPoints.where("accountId").equals(accountId).toArray(), [db, accountId]);
}
```

`apps/web/src/components/CashCheckCard.tsx` :

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isCashCheckOk, type CashCheck } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CashCheckCardProps {
  accountId: string;
  checks: CashCheck[];
}

/**
 * Spec §6.1 of sub-project 9: per currency, the running balance anchored on the latest Ending
 * Cash, checked against the oldest Starting Cash — the cash twin of `ReconciliationCard`.
 * Amounts carry no currency symbol: the currency code leads every line.
 */
export function CashCheckCard({ accountId, checks }: CashCheckCardProps) {
  const { t } = useTranslation();
  const anyGap = checks.some((check) => isCashCheckOk(check) === false);
  const anyUnanchored = checks.some((check) => check.end === null);
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        {checks.map((check) => (
          <CashCheckLine key={check.currency} check={check} />
        ))}
        {anyGap && <p className="text-xs text-muted-foreground">{t("cashCheck.hint")}</p>}
        {anyUnanchored && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("cashCheck.noneHint")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("cashCheck.noneLink")}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CashCheckLine({ check }: { check: CashCheck }) {
  const { t } = useTranslation();
  const { currency, end, start } = check;
  if (end === null) {
    return <Line badge={<Badge variant="outline">—</Badge>} text={t("cashCheck.none", { currency })} />;
  }
  const anchored = { currency, end: end.asOf, endAmount: formatAmount(end.amount) };
  if (start === null) {
    return <Line badge={<Badge variant="outline">{currency}</Badge>} text={t("cashCheck.anchored", anchored)} />;
  }
  const values = {
    ...anchored,
    start: start.asOf,
    startAmount: formatAmount(start.amount),
    balance: formatAmount(start.balance),
    gap: formatAmount(Math.abs(start.gap)),
  };
  return isCashCheckOk(check) ? (
    <Line badge={<Badge variant="success">OK</Badge>} text={t("cashCheck.ok", values)} />
  ) : (
    <Line badge={<Badge variant="warning">{formatAmount(start.gap)}</Badge>} text={t("cashCheck.gap", values)} />
  );
}

function Line({ badge, text }: { badge: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      {badge}
      <p className="text-sm">{text}</p>
    </div>
  );
}
```

- [x] **Step 6 : caler l'Historique**

Dans `apps/web/src/pages/HistoryPage.tsx` :

1. Imports :

```tsx
import { TRANSACTION_KINDS, anchoredBalances, matchesFilter, type LedgerRow, type TransactionKind } from "@ib/ledger";
```

```tsx
import { CashCheckCard } from "@/components/CashCheckCard";
import { useCashPoints, useLedger } from "@/db/hooks";
```

2. Sous `const ledger = useLedger(accountId);` : `const points = useCashPoints(accountId);`

3. Remplacer le `useMemo` de `rows` :

```tsx
  // Balances run over the whole ledger, oldest first, anchored on the cash points; the table
  // shows newest first.
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );
  const rows = useMemo(() => (anchored ? [...anchored.rows].reverse() : undefined), [anchored]);
```

4. Juste avant `{pageRows.length === 0 && (`, ajouter :

```tsx
      {anchored && anchored.rows.length > 0 && <CashCheckCard accountId={accountId} checks={anchored.checks} />}
```

5. Remplacer le commentaire JSX au-dessus des deux `TableHead` de solde par :

```tsx
                  {/* Anchored on the cash points when a file carries a Cash Report; the card
                      above says so, the title repeats it on the column itself. */}
```

- [x] **Step 7 : lancer les tests, les voir passer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS, dont `src/i18n/index.test.ts`.

- [x] **Step 8 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/components/CashCheckCard.tsx apps/web/src/components/CashCheckCard.test.tsx apps/web/src/db/hooks.ts apps/web/src/pages/HistoryPage.tsx apps/web/src/pages/HistoryPage.test.tsx apps/web/src/i18n docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(web): l'Historique cale ses soldes et dit s'ils retombent sur le cash de début

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 11 : textes d'état vide, snapshot de relevé à l'écran, graine de démonstration

**Files:**
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json` (`positions.empty`, `reconciliation.none`, `sources.import.hint`), `apps/web/src/mocks/seed.ts`
- Create: `apps/web/src/mocks/seed.test.ts`
- Test: `apps/web/src/pages/PositionsPage.test.tsx:111-118`, `apps/web/src/pages/DashboardPage.test.tsx:68-72`, `apps/web/src/components/SnapshotStatus.test.tsx`, `apps/web/src/components/ReconciliationCard.test.tsx`

**Interfaces:**
- Consomme : `SnapshotRecord.source` (tâche 6), `runningBalances`, `anchoredBalances`, `dayOf` (`@ib/ledger`).
- Produit : `seedAccounts(): Promise<void>` (les deux comptes de démo, sans aucune donnée) ; `seedDemo()` sème en plus des points de cash cohérents avec ses ledgers.

- [x] **Step 1 : écrire les tests**

1. `PositionsPage.test.tsx` et `DashboardPage.test.tsx` : remplacer le texte d'état vide attendu par `"Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions."`.

2. `PositionsPage.test.tsx`, ajouter dans le `describe` :

```tsx
  it("renders a snapshot read from a statement, dated by its period's end", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, source: "statement_html", asOf: "2025-12-31" });
    renderPositions();
    expect(await rowFor("XOM Mar20'26 100 Put")).toBeInTheDocument();
    expect(screen.getByText("Données du 2025-12-31")).toBeInTheDocument();
  });
```

3. `SnapshotStatus.test.tsx`, ajouter après le test Flex :

```tsx
  it("dates a statement snapshot exactly like a Flex one", async () => {
    await db.snapshots.put({ ...flexSnapshot, source: "statement_html", asOf: "2025-12-31" });
    renderStatus();
    const badge = await screen.findByText("Données du 2025-12-31");
    expect(badge).toHaveClass("text-warning");
  });
```

Ce test-là fige un comportement déjà juste (la branche non-agent) : il passe d'emblée, c'est voulu.

4. `ReconciliationCard.test.tsx`, test `"points at the data sources without a snapshot"` : remplacer la regex par `/Aucun snapshot de positions : importez un relevé HTML ou une réponse Flex/`.

5. `apps/web/src/mocks/seed.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { anchoredBalances } from "@ib/ledger";
import { db } from "@/db/schema";
import { seedAccounts, seedDemo } from "@/mocks/seed";

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("seedAccounts", () => {
  it("creates the two demo accounts and nothing else: a first visit", async () => {
    await seedAccounts();
    expect((await db.accounts.toArray()).map((a) => a.id).sort()).toEqual(["beta", "alpha"]);
    for (const table of [db.transactions, db.snapshots, db.cashPoints, db.statements, db.sectors, db.imports, db.contracts]) {
      expect(await table.count()).toBe(0);
    }
  });
});

describe("seedDemo", () => {
  it("seeds cash points that match each demo ledger exactly", async () => {
    await seedDemo();
    for (const accountId of ["alpha", "beta"]) {
      const ledger = await db.transactions.where("accountId").equals(accountId).toArray();
      const points = await db.cashPoints.where("accountId").equals(accountId).toArray();
      const { checks } = anchoredBalances(ledger, ["USD", "EUR"], points);
      for (const check of checks) {
        expect(check.end).not.toBeNull();
        expect(check.start?.gap).toBe(0);
      }
    }
  });
});
```

- [x] **Step 2 : lancer les tests, les voir échouer**

Run: `pnpm --filter web test src/pages/PositionsPage.test.tsx src/pages/DashboardPage.test.tsx src/components/ReconciliationCard.test.tsx src/mocks/seed.test.ts`
Expected: FAIL — anciens textes, `seedAccounts` absent, aucun point semé.

- [x] **Step 3 : écrire les textes**

`fr.json` :

```json
    "empty": "Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions.",
```

(dans `positions`)

```json
    "none": "Aucun snapshot de positions : importez un relevé HTML ou une réponse Flex, ou lancez l'agent.",
```

(dans `reconciliation`)

```json
      "hint": "Une réponse de Flex Query (XML) avec les sections Trades, Cash Transactions, Corporate Actions, Open Positions et Cash Report, ou un relevé d'activité exporté en HTML depuis le Client Portal, qui apporte aussi positions et cash à sa date de fin. Flex est propriétaire de sa plage de dates ; un relevé ne remplit que l'historique d'avant.",
```

(dans `sources.import`)

`en.json` :

```json
    "empty": "No positions yet — import an HTML statement or a Flex query response with Open Positions.",
```

```json
    "none": "No positions snapshot: import an HTML statement or a Flex response, or run the agent.",
```

```json
      "hint": "A Flex query response (XML) with the sections Trades, Cash Transactions, Corporate Actions, Open Positions and Cash Report, or an activity statement exported as HTML from the Client Portal, which also brings positions and cash as of its end date. Flex owns its own date range; a statement only fills the history before it.",
```

- [x] **Step 4 : écrire la graine**

`apps/web/src/mocks/seed.ts`, en entier :

```ts
import { dayOf, runningBalances, type Transaction } from "@ib/ledger";
import { db, type CashPointRecord } from "@/db/schema";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

const DEMO_CURRENCIES = ["USD", "EUR"] as const;

/** The two demo accounts and nothing else: what a user sees before their first import. */
export async function seedAccounts(): Promise<void> {
  await db.accounts.bulkPut([
    { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
    { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
  ]);
}

/**
 * Cash points that match a demo ledger exactly: a Starting Cash of 0 on its first day, an Ending
 * Cash equal to its last raw balance, so the History shows the cash card in its OK state.
 */
function demoCashPoints(accountId: string, transactions: readonly Transaction[]): CashPointRecord[] {
  const rows = runningBalances(transactions, DEMO_CURRENCIES);
  if (rows.length === 0) return [];
  const first = dayOf(rows[0].transaction.when);
  const last = rows[rows.length - 1];
  const importedAt = new Date().toISOString();
  return DEMO_CURRENCIES.flatMap((currency): CashPointRecord[] => [
    { accountId, currency, kind: "start", asOf: first, amount: 0, source: "flex", importedAt },
    { accountId, currency, kind: "end", asOf: dayOf(last.transaction.when), amount: last.balances[currency], source: "flex", importedAt },
  ]);
}

/**
 * Two accounts, a small ledger, a positions snapshot and a few sectors on `alpha`, and on
 * `beta` a Wheel cycle, a covered LEAPS and a condor, with the snapshot that matches them,
 * and on both the cash points that match their ledgers, for screenshots without any file.
 */
export async function seedDemo(): Promise<void> {
  await seedAccounts();
  await db.transactions.bulkPut(SAMPLE_TRANSACTIONS);
  await db.snapshots.put(SAMPLE_SNAPSHOT);
  await db.sectors.bulkPut(SAMPLE_SECTORS);
  await db.transactions.bulkPut(SAMPLE_JOURNAL_TRANSACTIONS);
  await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
  await db.cashPoints.bulkPut([
    ...demoCashPoints("alpha", SAMPLE_TRANSACTIONS),
    ...demoCashPoints("beta", SAMPLE_JOURNAL_TRANSACTIONS),
  ]);
}
```

- [x] **Step 5 : lancer les tests, les voir passer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 6 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/i18n apps/web/src/mocks apps/web/src/pages/PositionsPage.test.tsx apps/web/src/pages/DashboardPage.test.tsx apps/web/src/components/SnapshotStatus.test.tsx apps/web/src/components/ReconciliationCard.test.tsx docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(web): les états vides citent le relevé, la démo sème des points de cash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 12 : oracles privés de alpha

**Files:**
- Modify: `apps/web/src/db/alpha.private.test.ts`

**Interfaces:**
- Consomme : tout ce qui précède, par `importFile`, exactement comme le navigateur.
- Produit : trois tests privés (sautés sans `private/`).

- [x] **Step 1 : réécrire le fichier**

`apps/web/src/db/alpha.private.test.ts`, en entier :

```ts
/// <reference types="node" />
// The real files of alpha, on the author's machine only: every yearly statement of the
// account, then the Flex response, imported through `importFile` exactly as the browser does and
// reconciled the way `useJournals` and the History do. This account's statements reach back to
// its opening, so the cash owes a Starting Cash of zero.
//
// No file is named here beyond the Flex response, whose name carries nothing: the statements are
// found by reading `private/` and keeping those that carry the Flex's own IB account id, and
// ordered by the period each one declares, exactly as `replayStatements` does. No ticker and no
// amount is written either: writing them down would commit the account's holdings.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { anchoredBalances, buildIdentities, buildJournals, CASH_CHECK_TOLERANCE, dayOf, isCashCheckOk, pairCorporateActions, runningBalances } from "@ib/ledger";
import { parseActivityStatement } from "@ib/ib-parsers";
import { readIdentityInputs } from "@/db/contracts";
import { importFile } from "@/db/importFile";
import { AppDatabase, type AccountRecord } from "@/db/schema";

const PRIVATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../private");
const FLEX = "flex_<compte>_<date>.xml";

// Names only, no content: vitest runs a skipped describe's factory body, so
// anything heavier belongs inside the it() itself.
const present = existsSync(path.join(PRIVATE_DIR, FLEX)) && readdirSync(PRIVATE_DIR).some((name) => name.endsWith(".htm"));

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`alpha-${crypto.randomUUID()}`);
});

const asFile = (name: string, text: string) => new File([text], name, { type: "text/plain" });

/** The account, created from the Flex's own IB account id. */
async function openAccount(): Promise<{ account: AccountRecord; flex: string }> {
  const flex = readFileSync(path.join(PRIVATE_DIR, FLEX), "utf8");
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

/** The cash checks the History would show. */
async function cashChecks() {
  const ledger = await db.transactions.where("accountId").equals("alpha").toArray();
  const points = await db.cashPoints.where("accountId").equals("alpha").toArray();
  return anchoredBalances(ledger, ["USD", "EUR"], points).checks;
}

describe.skipIf(!present)("the real ledger of alpha", () => {
  it("replays every statement and the Flex back to the snapshot: zero difference", { timeout: 300_000 }, async () => {
    const { account, flex } = await openAccount();
    for (const { name, text } of [...statementsOf(account.ibAccountId), { name: FLEX, text: flex }]) {
      const report = await importFile(db, account, asFile(name, text));
      expect(report.status).toBe("ok");
    }

    const { report, identities } = await journals();
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);
    expect(identities.issues).toEqual([]);
  });

  it("replays the statements alone: only the renamed options differ, and the cash comes back to zero", { timeout: 300_000 }, async () => {
    const { account } = await openAccount();
    for (const { name, text } of statementsOf(account.ibAccountId)) {
      expect((await importFile(db, account, asFile(name, text))).status).toBe("ok");
    }

    const { snapshot, report, identities } = await journals();
    expect(snapshot?.source).toBe("statement_html");
    // Spec of sub-project 9, §2.5: two options the statements name by their underlying, renamed
    // mid-life, each split in two opposite lots no snapshot holds. Sub-project 10 brings this to
    // zero; until then any change to the list, either way, must fail here.
    const { differences, orphans } = report.reconciliation;
    expect(differences).toHaveLength(4);
    expect(orphans).toHaveLength(1);
    expect(differences.every((d) => d.contract.secType === "OPT" && d.snapshotQty === 0)).toBe(true);
    expect(differences.reduce((sum, d) => sum + d.ledgerQty, 0)).toBe(0);
    expect(identities.issues).toEqual([]);

    for (const check of await cashChecks()) {
      expect(check.start?.amount).toBe(0);
      expect(isCashCheckOk(check)).toBe(true);
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
    for (const check of await cashChecks()) {
      expect(check.start).not.toBeNull();
      const before = ledger.filter((tx) => dayOf(tx.when) < check.start!.asOf);
      const backdated = runningBalances(before, [check.currency]).at(-1)?.balances[check.currency] ?? 0;
      expect(Math.abs(check.start!.gap - backdated)).toBeLessThanOrEqual(CASH_CHECK_TOLERANCE);
    }
    expect((await cashChecks()).some((check) => isCashCheckOk(check) === false)).toBe(true);
  });
});
```

- [x] **Step 2 : lancer les oracles**

Run: `pnpm --filter web test src/db/alpha.private.test.ts`
Expected: PASS, trois tests (sautés sans `private/`).

Mesures faites avant ce plan : relevés seuls, 4 différences et 1 orphelin, écart de cash +0,06 USD et −0,11 EUR ; relevé récent seul, un écart USD d'une dizaine de dollars qu'expliquent deux lignes d'impôt datées avant la période du relevé (limite reportée), 0,00 EUR. **Si un nombre diffère, ne pas ajuster l'attente** : trouver ce qui a changé, et le dire.

- [x] **Step 3 : commit**

Cocher les cases, puis :

```bash
git add apps/web/src/db/alpha.private.test.ts docs/plans/2026-09-10-fichier-seul.md
git commit -m "test(web): alpha, relevés seuls et relevé récent seul, portefeuille et cash

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 13 : le driver simule la première visite, vérification dans la vraie application

**Files:**
- Modify: `.claude/skills/run-frontend/driver.mjs`, `.claude/skills/run-frontend/SKILL.md`

**Interfaces:**
- Consomme : `seedAccounts` (tâche 11).
- Produit : options `--empty` et `--import=` répétable.

- [x] **Step 1 : modifier le driver**

Dans `.claude/skills/run-frontend/driver.mjs` :

1. En-tête, remplacer les lignes des options concernées par :

```js
//   --seed            seed IndexedDB with two demo accounts and a sample ledger (src/mocks/seed.ts)
//   --empty           create the two demo accounts with no data at all: a user's first visit (exclusive with --seed)
```

```js
//   --ib-account=<id> after --seed or --empty, set the IB account id of the first route's account (to import a real file)
//   --import=<file>   upload a Flex XML or statement HTML on the Sources page of the first route's account; repeatable, in order
```

2. Sous `const has = …`, ajouter :

```js
const flagsOf = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
if (has("seed") && has("empty")) throw new Error("--seed and --empty are exclusive");
```

3. Après le bloc `if (has("seed")) {…}`, ajouter :

```js
    if (has("empty")) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedAccounts()));
    }
```

4. Remplacer la condition d'erreur `if (!account && (ibAccount || flag("import") || flag("sectors")))` par :

```js
    if (!account && (ibAccount || flagsOf("import").length > 0 || flag("sectors"))) {
```

5. Remplacer la boucle d'import par :

```js
    for (const [name, label, reportId] of [
      ["import", /importer un fichier|import a file/i, "import-report"],
      ["sectors", /importer un csv|import a csv/i, "sector-report"],
    ]) {
      for (const file of flagsOf(name)) {
        await page.goto(`${BASE}/accounts/${account}/sources`, { waitUntil: "networkidle" });
        await page.getByLabel(label).setInputFiles(file);
        await page.getByTestId(reportId).waitFor();
      }
    }
```

- [x] **Step 2 : documenter dans `SKILL.md`**

Dans le tableau des options, remplacer les lignes `--ib-account=` et `--import=` et ajouter `--empty` :

```markdown
| `--empty` | Crée les deux comptes de démo sans aucune donnée (`seedAccounts`) : la première visite d'un utilisateur. Exclusif avec `--seed` |
| `--ib-account=<id>` | Après `--seed` ou `--empty`, remplace l'identifiant IB du compte de la première route, pour importer un vrai fichier |
| `--import=<fichier>` | Importe un Flex XML ou un relevé HTML sur Sources de données avant la capture ; se répète, dans l'ordre donné |
```

Et ajouter, après la section « Positions et Dashboard » :

````markdown
## Un seul fichier

Les trois scénarios du sous-projet 9, sur des comptes vides. L'identifiant IB se lit dans le
fichier et le relevé se désigne par un motif : ni l'un ni l'autre n'est écrit dans une commande
versionnée.

```bash
ALPHA=$(grep -o 'accountId="[^"]*"' private/flex_<compte>_<date>.xml | head -1 | cut -d'"' -f2)
LATEST=$(ls private/U*.htm | grep "$ALPHA" | sort | tail -1)
ROUTES="/accounts/alpha/dashboard /accounts/alpha/positions /accounts/alpha/history /accounts/alpha/journal/wheel /accounts/alpha/sources"
node .claude/skills/run-frontend/driver.mjs $ROUTES --empty --ib-account=$ALPHA --import=$LATEST --out=/tmp/ib-shots/html-seul
node .claude/skills/run-frontend/driver.mjs $ROUTES --empty --ib-account=$ALPHA --import=private/flex_<compte>_<date>.xml --out=/tmp/ib-shots/flex-seul
node .claude/skills/run-frontend/driver.mjs $ROUTES --empty --ib-account=$ALPHA --import=$LATEST --import=private/flex_<compte>_<date>.xml --out=/tmp/ib-shots/html-flex
```
````

- [x] **Step 3 : capturer les trois scénarios et la démo**

Lancer les trois commandes de la section ci-dessus, puis beta en Flex seul (sa Flex Query porte un Cash Report) et la démo :

```bash
BETA=$(grep -o 'accountId="[^"]*"' private/flex_<compte>_<date>.xml | head -1 | cut -d'"' -f2)
node .claude/skills/run-frontend/driver.mjs /accounts/beta/dashboard /accounts/beta/positions /accounts/beta/history \
  --empty --ib-account=$BETA --import=private/flex_<compte>_<date>.xml --out=/tmp/ib-shots/beta-flex
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history /accounts/beta/history --seed --out=/tmp/ib-shots/demo
```

Expected : chaque run sort en code 0 (aucune erreur console). **Ouvrir chaque PNG avec l'outil Read** et vérifier :

| Scénario | Ce qui doit se voir |
|---|---|
| `html-seul` | Dashboard avec jauge et « Disponible » ; Positions groupées, badge « Données du 2026-09-09 » ; Historique avec la carte : USD en écart d'une dizaine de dollars (lignes d'impôt antidatées, limite reportée), EUR à l'état OK ; Journal Wheel avec la carte de cohérence en écarts (historique d'un seul relevé, attendu) ; Sources avec le compte rendu « positions » |
| `flex-seul` | Positions et Dashboard remplis ; Historique avec « aucun Cash Report » en USD et EUR (la Flex Query de alpha n'a pas la section) |
| `html-flex` | Positions remplies ; Historique calé, carte OK ou écart transitoire (limite §10 du spec) : noter lequel |
| `beta-flex` | Historique, carte USD à l'état OK, écart 0.00 |
| `demo` | Carte OK sur les deux comptes |

Consigner dans le message de commit ce que montre chaque scénario, écart compris.

- [x] **Step 4 : commit**

Cocher les cases, puis :

```bash
git add .claude/skills/run-frontend/driver.mjs .claude/skills/run-frontend/SKILL.md docs/plans/2026-09-10-fichier-seul.md
git commit -m "feat(run-frontend): --empty et --import répétable pour la première visite

Captures relues, une ligne par scénario du tableau de l'étape 3 : html-seul,
flex-seul, html-flex (OK ou écart, et sa valeur), beta-flex, demo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

---

## Tâche 14 : documentation, dette, revue, merge

**Files:**
- Modify: `CLAUDE.md`, `docs/specs/2026-09-03-architecture-design.md:49-52`, `docs/specs/2026-09-10-fichier-seul-design.md:3`, `docs/points-reportes.md` (avant `## Sans échéance`)

- [x] **Step 1 : `CLAUDE.md`**

1. Remplacer le paragraphe « Oracle de réconciliation : sur `beta`… » par :

```markdown
Oracles du cash : sur `beta`, la réponse Flex seule retrouve son *Starting Cash* d'ouverture
au centime (`cash.private.test.ts`), et le solde USD de l'historique finit sur le
`TotalCashBalance` de TWS au centime (vérifié au 2026-09-01, montant jamais écrit dans le dépôt). `alpha`, dont les relevés remontent à
l'ouverture du compte (2022), retrouve un *Starting Cash* de 0 à `CASH_CHECK_TOLERANCE` près,
relevés seuls comme avec Flex. Relevés seuls, son portefeuille garde 4 écarts d'options
renommées, figés par `alpha.private.test.ts` jusqu'au sous-projet 10. Le relevé 2026 importé
seul garde un écart USD dû à deux corrections antidatées, figé par le même test.
```

2. Dans « Constantes métier », ajouter `CASH_CHECK_TOLERANCE` dans `packages/ledger/src/cash.ts` à la liste.

3. Remplacer la règle « Supprimer les transactions » par :

```markdown
- **« Supprimer les transactions » (`db/clearDerived.ts`) purge le dérivé, jamais la source** :
  `transactions`, `contracts`, `snapshots`, `cashPoints` et `imports` du compte, en une
  transaction. La fiche du compte (jeton Flex, port TWS), les relevés HTML et la table
  sectorielle restent : « Relire les relevés » reconstruit l'historique, les contrats, le
  snapshot et les points de cash venus des relevés, une synchro Flex les siens, l'agent ses
  transactions, ses contrats et son snapshot.
```

4. Remplacer la règle « Le snapshot de positions est un document par compte… » par :

```markdown
- **Le snapshot de positions est un document par compte**, remplacé quand le `asOf` du fichier
  est supérieur ou égal. **Un relevé HTML porte un snapshot** à sa fin de période (Open Positions,
  cash USD), soumis à la même règle qu'un Flex ; « Relire les relevés » remplace ou supprime un
  snapshot venu d'un relevé, et ne remplace un snapshot Flex ou agent que si un import le ferait.
```

5. Ajouter, après cette règle :

```markdown
- **Le solde cumulé de l'Historique est calé, jamais stocké** : `cashPoints` (Dexie 6) garde par
  devise le point de fin le plus récent et le point de début le plus ancien des Cash Report des
  fichiers — jamais de l'agent —, et `anchoredBalances` (`packages/ledger/src/cash.ts`) décale le
  solde pour finir sur l'*Ending Cash*, puis mesure l'écart au *Starting Cash* à la veille du
  point de début. La carte « Cohérence du cash » l'affiche ; sans Cash Report, le solde part de 0
  et la carte le dit.
```

6. Tableau des sous-projets, ajouter :

```markdown
| 9 | Application complète avec un seul fichier : positions du relevé, solde calé | livré (2026-09-11), en attente de merge |
| 10 | Identité des options sans Flex (relevés, agent) | à faire |
```

7. Paragraphe Outillage, remplacer « Il accepte aussi `--import=`, `--sectors=` et `--ib-account=` pour importer un fichier réel ou une table sectorielle avant la capture. » par :

```markdown
Il accepte aussi `--import=` (répétable, dans l'ordre), `--sectors=` et `--ib-account=` pour
importer des fichiers réels ou une table sectorielle avant la capture, et `--empty`, qui crée
les deux comptes sans aucune donnée pour simuler la première visite.
```

- [x] **Step 2 : le spec d'architecture**

Dans `docs/specs/2026-09-03-architecture-design.md`, après la note du 2026-09-06 du §2, ajouter :

```markdown
**Note du 2026-09-10** : un relevé HTML seul suffit désormais à tout sauf à l'intraday —
historique, positions et couverture à sa fin de période (Open Positions et Cash Report se lisent
aussi dans le relevé), journaux, et solde cumulé calé sur le cash de fin
(`2026-09-10-fichier-seul-design.md`). Le §13 ne change pas : les positions sont lues, jamais
dérivées du ledger.
```

- [x] **Step 3 : le spec du sous-projet et la dette**

Dans `docs/specs/2026-09-10-fichier-seul-design.md`, remplacer `Statut : conçu (2026-09-10).` par `Statut : implémenté (2026-09-11).`

Dans `docs/points-reportes.md`, insérer avant `## Sans échéance` (et le `---` qui le précède) :

```markdown
## Reporté par le sous-projet 9 (application complète avec un seul fichier)

- **Relevés seuls, une option renommée en cours de vie ouvre un écart de portefeuille** : une
  option ajustée (spin-off) ou dont le sous-jacent est converti est nommée par son sous-jacent
  dans les *Transactions* du relevé, sous deux noms successifs que la règle 7 ne réunit pas. Sur
  alpha, relevés seuls : 4 écarts et 1 orphelin, figés par `alpha.private.test.ts`. Avec
  Flex, qui écrit la forme OSI empaquetée, zéro écart. **Sous-projet 10**, avec l'entrée
  « Un split du sous-jacent ne renomme toujours pas les options qui le suivent » du sous-projet 7.
- **Un relevé seul qui porte des corrections antidatées montre un écart de cash au début.** IB
  compte une correction tardive (retenue à la source, par exemple) dans le Cash Report de la
  période qui la rapporte, mais la date du jour qu'elle corrige ; la mesure « à la veille du point
  de début » (spec §5) la range donc avant le début. Importé seul, le relevé 2026 de alpha porte
  deux lignes d'impôt de ce genre, dont celle du 2025-02-21 déjà connue côté Flex : la carte
  « Cohérence du cash » montre un écart USD égal à ces lignes. Ni les ignorer à l'import (le
  relevé précédent ne les porte pas, le cumul perdrait ces montants) ni mesurer avant la
  première ligne (les lignes Flex antérieures au relevé fausseraient alors relevé + Flex) ne
  corrige le cas ; la vraie réponse demanderait la date de comptabilisation, que le relevé ne
  donne pas. Figé par `alpha.private.test.ts` (l'écart doit égaler ces lignes à la tolérance
  près, et au moins une devise doit être en écart).
- **Un relevé qui finit après le dernier jour Flex**, importé ou relu alors que des lignes Flex
  sont en base, n'écrit pas ses derniers jours alors que son point de fin les compte : la carte
  montre un écart jusqu'à la synchro Flex suivante.
- **Supprimer le relevé qui avait remplacé un point de cash ou un snapshot Flex ne restaure pas
  celui-ci** : il revient à la synchro Flex suivante. Entre-temps, le point de début manque
  (« début non vérifié ») ou Positions est vide.
- **Un compte sans aucune position dont le relevé omet la section *Open Positions*** n'a pas de
  snapshot : Positions reste à l'état vide au lieu d'afficher un portefeuille vide.
- **« Relire les relevés » peut remplacer un snapshot Flex du même jour** par celui du relevé :
  même clôture, `conid` vides. Aucun code ne lit `Position.conid` aujourd'hui.
- **Les fixtures anonymisées ont un EUR incohérent** : l'anonymiseur réécrit des montants EUR du
  ledger sans réécrire le Cash Report. L'oracle versionné du cash ne vérifie que l'USD.
- **Le compte rendu de purge ne chiffre ni les positions ni les points de cash** : il les nomme
  seulement, comme avant pour les positions.
- Et tout ce que la revue de branche aura relevé.
```

- [x] **Step 4 : vérification complète**

```bash
pnpm check
pnpm --filter web test
```

Expected : `pnpm check` sort en 0, avec les tests privés présents et verts. Lire la sortie, ne rien supposer.

- [x] **Step 5 : commit des documents**

Cocher les cases, puis :

```bash
git add CLAUDE.md docs
git commit -m "docs: sous-projet 9 livré, règles du snapshot de relevé et du solde calé, dette

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X5aYFd4f2ysMwFpPdt9X8K"
```

- [x] **Step 6 : revue de branche et merge**

Invoquer `superpowers:requesting-code-review` sur la branche entière contre `main`. Traiter les retours avec `superpowers:receiving-code-review` ; ce qui est jugé non bloquant va dans la section du sous-projet 9 de `docs/points-reportes.md`. Puis `superpowers:finishing-a-development-branch` pour merger sur `main`, et passer la ligne 9 du tableau de `CLAUDE.md` à « fait (AAAA-MM-JJ du jour) ».

---

## Ce qui est délibéré

- **`formatAmount`, pas `formatMoney`, dans la carte** : `formatMoney` écrit un symbole dollar ; la carte affiche aussi l'EUR, et le code devise ouvre déjà chaque ligne.
- **Un état « début non vérifié »** que le spec ne listait pas : un point de fin sans point de début n'arrive pas depuis un seul fichier, mais arrive après la suppression du relevé qui portait le début (voir la dette). La carte le dit au lieu de se taire.
- **La ligne provisoire de la tâche 3** dans `importFile.ts` n'existe que pour garder chaque commit vert ; la tâche 7 la remplace.
- **Les nouvelles sections de la fixture sont en fin de fichier** : plusieurs tests remplacent la première occurrence d'un en-tête (`Quantity`) ou d'une valeur (`10.0000`) et viseraient sinon la mauvaise section.
- **L'oracle du corpus garde son lecteur naïf d'Open Positions** : un oracle ne partage pas le code qu'il vérifie.
