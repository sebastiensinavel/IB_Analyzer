# Sous-projet 7 — Opérations sur titres et identité de contrat : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que le rejeu du ledger comprenne les opérations sur titres — split, changement de CUSIP/ISIN, fusion en titres, fusion mixte cash et titres — et qu'un contrat reste le même contrat quand son ticker change, pour que le portefeuille reconstitué depuis les transactions retrouve celui d'Interactive Brokers.

**Architecture:** Deux couches indépendantes qui se rejoignent au rejeu. (1) *L'identité* : la section Contract Information du relevé HTML, le `conid` déjà présent chez l'agent et sur les positions Flex, alimentent un store Dexie `contracts` par compte ; `ContractIdentities` en dérive une fonction `canonical(ticker, when)` qui remplace un ticker par son canonique avant que `contractOf` ne construise la clé de contrat. (2) *Les événements* : les lignes `corporate_action` déjà dans le ledger sont appariées deux à deux en `CorporateActionEvent` et rejouées comme une substitution de contrat sur les lots ouverts, base de coût reportée. Le `conid` n'est **jamais** une clé de contrat : `contractId` reste sur le ticker, et une source sans indice se comporte exactement comme aujourd'hui.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, Playwright. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-09-operations-sur-titres-design.md` (lire aussi `docs/specs/2026-09-07-journaux-design.md` §3 et §4 pour le moteur existant, `docs/specs/2026-09-03-architecture-design.md` §3 et §6.2, et `CLAUDE.md`).

## Global Constraints

- **Le `conid` est un indice d'équivalence, jamais une clé de contrat** (spec §3.1). `contractId(key)` reste `ticker|secType|right|strike|expiry|currency`. Clé sur le `conid` et le même contrat vu une fois avec (relevé HTML) et une fois sans (Flex) scinde ses lots. C'est la contrainte dont dépendent les trois oracles de la tâche 11.
- **`buildJournals(transactions, snapshot?, identities?)` sans son troisième argument rend exactement ce qu'il rendait.** Aucune tâche n'a le droit de casser cette propriété ; la tâche 11 la vérifie sur trois oracles existants.
- **Le serveur ne voit jamais** transactions, positions, contrats ni opérations sur titres. Aucun modèle, aucune table, aucune migration côté `apps/api`.
- **Les opérations sur titres sont inférées à chaque rejeu**, jamais stockées : pas de table, pas de store, pas de migration Dexie pour elles. Seule l'*identité des contrats* est stockée, parce que c'est un attribut du contrat et non un événement.
- **La base de coût est reportée, jamais recalculée** (spec §3.3). `openAmount` et `openCommission` d'un lot converti sont inchangés ; `openPrice` se divise par le ratio, pour rester un prix hors commissions comme partout ailleurs dans le moteur. La colonne `Value` d'une ligne de CA est une valeur de marché et ne sert jamais de base.
- **Ce que la résolution ne sait pas trancher n'est jamais deviné** (spec §3.4) : le ticker reste lui-même, et un `IdentityIssue` part vers la page Sources.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ». `realizedPnl` est de surcroît **optionnel** (`realizedPnl?: number | null`) : une ligne stockée avant la version 4 du schéma n'a pas la clé du tout et rend `undefined`.
- **Comptes jamais combinés** : le store `contracts` est clé `[accountId+conid]`, jamais `conid` seul.
- **`packages/ledger` ne dépend de rien** : ni `coverage`, ni `ib-parsers`. `ContractIdentities` vit dans `packages/ledger` et reçoit des données déjà normalisées.
- **Constantes métier** définies une seule fois dans le paquet qui les possède ; ce sous-projet n'en ajoute aucune.
- shadcn ici est **base-ui**, pas Radix : `render={<X />}` au lieu de `asChild`, `onValueChange` typé `T | null`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français. Libellés de contrats en anglais.
- **Un test doit échouer si le comportement change.** `packages/ledger` compare des listes de lignes à l'identique ; `apps/web` teste sur `fake-indexeddb` avec une base semée, jamais en moquant les hooks.
- **`pnpm check` ne lance jamais de Python.** Rien ici n'en a besoin ; `pnpm oracle` n'est pas relancé par ce sous-projet.
- **Aucun identifiant de compte réel, aucun montant réel, aucun ISIN réel dans un fichier versionné.** Les tests sur `private/` lisent l'identifiant dans le fichier lui-même et sont ignorés quand le fichier est absent (`describe.skipIf(!existsSync(...))`).
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
  ```
- Le travail se fait dans un worktree `.claude/worktrees/operations-sur-titres` (skill `superpowers:using-git-worktrees`), branche `operations-sur-titres`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
packages/ib-parsers/src/
  common.ts (+ test)                      + legFromDescription(description)
  statement.ts (+ test)                   readSection accepte l'id sans tiret bas ;
                                          parseContractInfo -> ContractIdentity[] ;
                                          parseCorporateActions pose le ticker de la jambe
                                          et realizedPnl
  flex.ts (+ test)                        conid/isin sur Trade, CashTransaction,
                                          CorporateAction ; realizedPnl ; identities
  agent.ts (+ test)                       identities depuis conId + symbol
  identity.ts (+ test)                    ContractIdentity, mergeIdentities
  corpus.oracle.test.ts                   rejeu du corpus HTML : positions attendues
  ca.oracle.test.ts                       (tâche 11) les trois oracles existants inchangés
packages/ib-parsers/scripts/
  anonymize-statement.mjs                 anonymiseur de relevé HTML, conid/ISIN cohérents
packages/ib-parsers/tests/fixtures/
  activity_statement_sample.htm           + section ContractInformation
  statement_ca_corpus_{2022,2023,2024}.htm corpus anonymisé, les sept formes

packages/ledger/src/
  types.ts                                + Transaction.realizedPnl?
  journals/
    types.ts                              + CloseEvent "corporate_action"
    identities.ts (+ test)                ContractIdentities, IdentityIssue,
                                          buildIdentities, NO_IDENTITIES
    corporate.ts (+ test)                 CorporateActionEvent, pairCorporateActions,
                                          applyCorporateAction
    contract.ts                           contractOf(source, identities?)
    replay.ts (+ test)                    buildJournals prend identities?, applique les
                                          événements en tête de leur groupe

apps/web/src/
  db/schema.ts (+ test)                   ContractRecord, version 4, table contracts
  db/contracts.ts (+ test)                upsertIdentities, readIdentities
  db/importFile.ts (+ test)               écrit contracts dans la transaction d'import
  db/hooks.ts (+ test)                    useContractIdentities, useJournals l'utilise
  agent/sync.ts (+ test)                  écrit contracts dans la transaction de passe
  pages/SourcesPage.tsx (+ test)          carte « Identité des contrats »
  i18n/{en,fr}.json                       libellés de la carte et de l'événement
apps/web/e2e/
  corporate-actions.spec.ts               import des trois relevés, journaux, cohérence
```

## Commandes

Depuis la racine du worktree, sauf mention contraire.

```bash
pnpm install                                   # une fois, à la création du worktree
pnpm --filter @ib/ib-parsers test              # Vitest du paquet parseurs
pnpm --filter @ib/ledger test                  # Vitest du moteur
pnpm --filter web test                         # Vitest de l'application
pnpm --filter @ib/ledger exec vitest run src/journals/identities.test.ts   # un fichier
pnpm check                                     # lint + typecheck + tous les Vitest
pnpm --filter web e2e                          # Playwright, serveur Django requis
```

`pnpm check` ne lance ni Python, ni Django, ni pytest, ni Playwright.

---

## Tâche 1 : worktree, Contract Information

**Files:**
- Create: `packages/ib-parsers/src/identity.ts`
- Create: `packages/ib-parsers/src/identity.test.ts`
- Modify: `packages/ib-parsers/src/statement.ts:55-135` (`readSection`, `parseActivityStatement`)
- Modify: `packages/ib-parsers/src/statement.test.ts`
- Modify: `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm`
- Modify: `packages/ib-parsers/src/index.ts`

**Interfaces:**
- Produces: `ContractIdentity` (interface), `mergeIdentities(lists: ContractIdentity[][]): ContractIdentity[]`, `StatementParseResult.identities: ContractIdentity[]`.
- Consumes: rien.

- [x] **Step 1 : créer le worktree**

Invoquer le skill `superpowers:using-git-worktrees` pour créer `.claude/worktrees/operations-sur-titres` sur la branche `operations-sur-titres`, puis :

```bash
pnpm install
pnpm check
```

Attendu : `pnpm check` passe avant toute modification. S'il échoue, s'arrêter et le signaler : le plan suppose une base verte.

- [x] **Step 2 : écrire le test qui échoue — `ContractIdentity` et la fusion**

Créer `packages/ib-parsers/src/identity.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { mergeIdentities, type ContractIdentity } from "./identity.ts";

const base = { isin: "", secType: "STK", currency: "USD", description: "" };

describe("mergeIdentities", () => {
  it("unions the tickers of one conid seen in two files", () => {
    const a: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAB"] };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZXABQ"] };
    expect(mergeIdentities([[a], [b]])).toEqual([{ ...base, conid: "1", tickers: ["ZXAB", "ZXABQ"] }]);
  });

  it("keeps distinct conids apart and preserves first-seen order", () => {
    const a: ContractIdentity = { ...base, conid: "2", tickers: ["ZXAA"] };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAA"] };
    expect(mergeIdentities([[a], [b]]).map((i) => i.conid)).toEqual(["2", "1"]);
  });

  it("never repeats a ticker already known for that conid", () => {
    const a: ContractIdentity = { ...base, conid: "1", tickers: ["ZQA", "ZQA.OLD"] };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZQA"] };
    expect(mergeIdentities([[a], [b]])[0].tickers).toEqual(["ZQA", "ZQA.OLD"]);
  });

  it("fills a field left empty by the first sighting from a later one", () => {
    const a: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAI"], isin: "" };
    const b: ContractIdentity = { ...base, conid: "1", tickers: ["ZXAI"], isin: "US00653A1079", description: "EXAMPLE" };
    const [merged] = mergeIdentities([[a], [b]]);
    expect(merged.isin).toBe("US00653A1079");
    expect(merged.description).toBe("EXAMPLE");
  });

  it("drops an entry without a conid: it identifies nothing", () => {
    const a: ContractIdentity = { ...base, conid: "", tickers: ["EUR.USD"] };
    expect(mergeIdentities([[a]])).toEqual([]);
  });
});
```

- [x] **Step 3 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/identity.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./identity.ts"`.

- [x] **Step 4 : implémenter `identity.ts`**

Créer `packages/ib-parsers/src/identity.ts` :

```ts
/**
 * One IB contract as a source describes it, and every ticker string it has
 * been seen under. The `conid` is the only thing a ticker change never
 * touches; it is an equivalence hint, never a contract key (spec §3.1).
 */
export interface ContractIdentity {
  /** IB's stable contract id. An entry without one identifies nothing. */
  conid: string;
  isin: string;
  /** "STK", "OPT"… as the source names it. */
  secType: string;
  currency: string;
  description: string;
  /** Every spelling of this contract, first seen first. */
  tickers: string[];
}

/**
 * Folds identities of several files into one list per conid: tickers are
 * unioned in order of first sighting, and a field left empty by the first
 * sighting is filled by a later one. Entries without a conid are dropped —
 * they carry no identity, only a name we already have.
 */
export function mergeIdentities(lists: readonly (readonly ContractIdentity[])[]): ContractIdentity[] {
  const byConid = new Map<string, ContractIdentity>();
  for (const list of lists) {
    for (const identity of list) {
      if (identity.conid === "") continue;
      const current = byConid.get(identity.conid);
      if (!current) {
        byConid.set(identity.conid, { ...identity, tickers: [...identity.tickers] });
        continue;
      }
      for (const ticker of identity.tickers) {
        if (!current.tickers.includes(ticker)) current.tickers.push(ticker);
      }
      current.isin ||= identity.isin;
      current.secType ||= identity.secType;
      current.currency ||= identity.currency;
      current.description ||= identity.description;
    }
  }
  return [...byConid.values()];
}
```

- [x] **Step 5 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/identity.test.ts
```

Attendu : 5 tests PASS.

- [x] **Step 6 : écrire le test qui échoue — Contract Information dans le relevé**

Ajouter à la fin de `packages/ib-parsers/src/statement.test.ts` :

```ts
describe("parseActivityStatement contract information", () => {
  const { identities } = parseActivityStatement(html, TARGET);

  it("reads the section whose id has no underscore before the account", () => {
    expect(identities.length).toBeGreaterThan(0);
  });

  it("splits the Symbol cell into every alias of one conid", () => {
    const quanergy = identities.find((i) => i.conid === "900000106");
    expect(quanergy).toEqual({
      conid: "900000106",
      isin: "US7476000000",
      secType: "STK",
      currency: "USD",
      description: "QUANERGY SYSTEMS INC",
      tickers: ["ZXAB", "ZXABQ"],
    });
  });

  it("reads a single-alias row", () => {
    expect(identities.find((i) => i.conid === "900000105")?.tickers).toEqual(["TESTZ"]);
  });

  it("reads columns by their header, not their rank", () => {
    // The 2024 statement inserts `Underlying` between `Security ID` and
    // `Listing Exch`; the fixture carries that column on the option row.
    expect(identities.find((i) => i.conid === "700000001")).toMatchObject({ secType: "OPT", tickers: ["TESTX  251219C00020000"] });
  });

  it("yields an empty list when the section is absent", () => {
    const without = html.replace(/tblContractInfoU0000001Body/g, "tblGoneBody");
    expect(parseActivityStatement(without, TARGET).identities).toEqual([]);
  });
});
```

- [x] **Step 7 : ajouter la section au fixture**

Dans `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm`, insérer ce bloc **juste avant** `<div id="tblOptionCashSettlement_U0000001Body"`. Noter l'identifiant **sans tiret bas** avant le compte, et la colonne `Underlying` présente comme dans le relevé 2024 :

```html
<div id="tblContractInfoU0000001Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered">
<thead>
<tr>
<th align="left">Symbol</th>
<th align="left">Description</th>
<th align="right">Conid</th>
<th align="left">Security ID</th>
<th align="left">Underlying</th>
<th align="left">Listing Exch</th>
<th align="right">Multiplier</th>
<th align="left">Type</th>
<th align="left">Code</th>
</tr>
</thead>
<tr><td class="header-asset" align="left" valign="middle" colspan="9">Stocks</td></tr>
<tr><td class="header-currency" align="left" valign="middle" colspan="9">USD</td></tr>
<tr>
<td>ZXAB, ZXABQ</td><td>QUANERGY SYSTEMS INC</td><td align="right">900000106</td>
<td>US7476000000</td><td>ZXABQ</td><td>PINK</td><td align="right">1</td><td>COMMON</td><td>&nbsp;</td>
</tr>
<tr>
<td>TESTZ</td><td>TEST Z INC</td><td align="right">900000105</td>
<td>US7411000000</td><td>TESTZ</td><td>NASDAQ</td><td align="right">1</td><td>COMMON</td><td>&nbsp;</td>
</tr>
<tr><td class="header-asset" align="left" valign="middle" colspan="9">Equity and Index Options</td></tr>
<tr><td class="header-currency" align="left" valign="middle" colspan="9">USD</td></tr>
<tr>
<td>TESTX  251219C00020000</td><td>TESTX 19DEC25 20 C</td><td align="right">700000001</td>
<td>&nbsp;</td><td>TESTX</td><td>CBOE</td><td align="right">100</td><td>OPTION</td><td>&nbsp;</td>
</tr>
</table>
</div>
</div>
```

- [x] **Step 8 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/statement.test.ts
```

Attendu : ÉCHEC, `identities` n'existe pas sur le résultat (erreur de type au build Vitest, ou `undefined`).

- [x] **Step 9 : rendre `readSection` tolérant à l'identifiant sans tiret bas**

Dans `packages/ib-parsers/src/statement.ts`, remplacer le corps de `readSection` (ligne 130-133) :

```ts
function readSection(ctx: Context, key: string, required: boolean): Section | null {
  // IB is inconsistent: most sections are `tbl<Key>_<account>Body`, but
  // ContractInfo and FIFOPerfSumByUnderlying drop the separator entirely.
  const body =
    ctx.doc.getElementById(`tbl${key}_${ctx.ibAccountId}Body`) ??
    ctx.doc.getElementById(`tbl${key}${ctx.ibAccountId}Body`);
  const table = body?.querySelector("table");
  if (!table) return null;
```

Le reste de la fonction est inchangé.

- [x] **Step 10 : implémenter `parseContractInfo`**

Ajouter à `packages/ib-parsers/src/statement.ts`, à côté de `parseCorporateActions` :

```ts
/**
 * Contract Information: the statement's own Rosetta stone. `Symbol` is a
 * comma-separated list of every spelling this contract wore in this file, so
 * a ticker change that IB does not report as an event (ZXAB -> ZXABQ) is
 * still visible here, under one unchanged conid.
 */
function parseContractInfo(ctx: Context): ContractIdentity[] {
  const sectionData = readSection(ctx, "ContractInfo", false);
  if (!sectionData) return [];
  const identities: ContractIdentity[] = [];
  for (const row of sectionData.rows) {
    const conid = (row.cells["Conid"] ?? "").trim();
    if (conid === "") continue;
    const tickers = (row.cells["Symbol"] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tickers.length === 0) continue;
    identities.push({
      conid,
      isin: (row.cells["Security ID"] ?? "").trim(),
      secType: secTypeOf(ctx, row.assetCategory),
      currency: row.currency,
      description: (row.cells["Description"] ?? "").trim(),
      tickers,
    });
  }
  return identities;
}
```

Importer `ContractIdentity` en tête du fichier :

```ts
import type { ContractIdentity } from "./identity.ts";
```

- [x] **Step 11 : brancher la section sur le résultat**

Dans `packages/ib-parsers/src/statement.ts`, ajouter le champ à `StatementParseResult` :

```ts
export interface StatementParseResult extends ParseResult<StatementInfo> {
  /** Contract Information of this file; empty when the section is absent. */
  identities: ContractIdentity[];
}
```

Puis, dans `parseActivityStatement`, rendre `identities: parseContractInfo(ctx)` sur le chemin nominal, et `identities: []` sur **chacun** des trois retours anticipés (fichier non reconnu, période illisible, compte étranger). Un fichier refusé ne livre aucune identité : c'est la même règle que pour ses transactions.

- [x] **Step 12 : exporter le nouveau module**

Dans `packages/ib-parsers/src/index.ts`, ajouter après la ligne `export * from "./issues.ts";` :

```ts
export * from "./identity.ts";
```

- [x] **Step 13 : lancer les tests du paquet, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ib-parsers test
```

Attendu : tous PASS, dont les 5 nouveaux de `contract information` et les 5 de `mergeIdentities`. Les tests existants de `statement.test.ts` ne bougent pas : la section ajoutée au fixture n'a pas de colonne `Amount` ni `Proceeds` et ne produit aucune transaction.

- [x] **Step 14 : commit**

```bash
git add packages/ib-parsers/src/identity.ts packages/ib-parsers/src/identity.test.ts \
        packages/ib-parsers/src/statement.ts packages/ib-parsers/src/statement.test.ts \
        packages/ib-parsers/src/index.ts \
        packages/ib-parsers/tests/fixtures/activity_statement_sample.htm \
        docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(parsers): le relevé HTML livre l'identité de ses contrats

Contract Information est la seule source qui relie deux tickers d'un même
contrat quand IB ne déclare aucune opération : même conid, deux noms. Son
identifiant de bloc n'a pas le tiret bas que readSection insérait toujours.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 2 : le ticker de chaque jambe, et `realizedPnl`

**Files:**
- Modify: `packages/ib-parsers/src/common.ts` (ajouter `legFromDescription` après `symbolFromDescription`, ligne 93)
- Modify: `packages/ib-parsers/src/common.test.ts`
- Modify: `packages/ib-parsers/src/statement.ts:354-370` (`parseCorporateActions`)
- Modify: `packages/ib-parsers/src/statement.test.ts`
- Modify: `packages/ledger/src/types.ts` (ajouter `realizedPnl` à `Transaction`)
- Modify: `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm`

**Interfaces:**
- Consumes: rien de la tâche 1.
- Produces: `legFromDescription(description: string): { ticker: string; isin: string } | null`, `Transaction.realizedPnl?: number | null`.

**Pourquoi c'est un défaut et pas un choix.** `symbolFromDescription` (`common.ts:90`) lit le
préfixe de la description. Les deux jambes d'une opération partagent ce préfixe, donc reçoivent
le même `symbol`. Même rejouées, elles donneraient ZXAJ 114 − 114 = 0 et zéro ZXAH. Le `symbol`
d'une ligne doit désigner le titre que cette ligne concerne.

**Sur le changement d'`externalId`.** Le `symbol` entre dans le hachage `html:{sha256}`
(`statement.ts:309`, `hash.ts`), donc les lignes de CA changent d'identifiant. Ce n'est pas un
problème : `planStatement` (`packages/ledger/src/import.ts:104`) supprime les lignes
`statement_html` de la période déclarée qui ne sont pas dans le lot entrant, puis écrit le lot.
Un ré-import du même relevé remplace proprement les anciennes lignes. Aucune migration, aucun
doublon.

- [x] **Step 1 : écrire le test qui échoue — `legFromDescription`**

Ajouter à `packages/ib-parsers/src/common.test.ts` :

```ts
import { legFromDescription } from "./common.ts";

describe("legFromDescription", () => {
  it("reads the leg of a CUSIP/ISIN change", () => {
    expect(
      legFromDescription("ZXAJ(US9228000000) CUSIP/ISIN Change to (US7411000000) (ZXAH, EXAMPLE AUTOMATION INC, US7411000000)"),
    ).toEqual({ ticker: "ZXAH", isin: "US7411000000" });
  });

  it("reads a .OLD leg of a split", () => {
    expect(
      legFromDescription("ZXAA(US8194000000) Split 1 for 8 (ZXAA.OLD, EXAMPLE HOLDINGS INC, US8194000000)"),
    ).toEqual({ ticker: "ZXAA.OLD", isin: "US8194000000" });
  });

  it("is not fooled by an earlier parenthesis in the sentence", () => {
    expect(
      legFromDescription("ZXAO(US8780000000) Merged(Acquisition) WITH US0065000000 15117 FOR 10000 (ZXAI, EXAMPLE THERAPEUTICS-ADR, US0065000000)"),
    ).toEqual({ ticker: "ZXAI", isin: "US0065000000" });
  });

  it("reads the leg of a cash and stock merger", () => {
    expect(
      legFromDescription("ZXAE(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923 (ZQB, EXAMPLE ENERGY CORP, CA2257000000)"),
    ).toEqual({ ticker: "ZQB", isin: "CA2257000000" });
  });

  it("gives up on a description with no trailing triple", () => {
    expect(legFromDescription("TESTX(US0000000000) Split 2 for 1")).toBeNull();
  });

  it("gives up on a trailing parenthesis that is not a triple", () => {
    expect(legFromDescription("TESTX(US0000000000) Something (US1111111111)")).toBeNull();
  });

  it("gives up on a ticker that is not a ticker", () => {
    expect(legFromDescription("TESTX Something (not a ticker, NAME, US1111111111)")).toBeNull();
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/common.test.ts
```

Attendu : ÉCHEC, `legFromDescription is not exported`.

- [x] **Step 3 : implémenter `legFromDescription`**

Ajouter dans `packages/ib-parsers/src/common.ts`, juste après `symbolFromDescription` :

```ts
/** One leg of a corporate action: the ticker and ISIN the row actually concerns. */
export interface CorporateActionLeg {
  ticker: string;
  isin: string;
}

/**
 * A statement's corporate action description names the *event* first and the
 * *leg* last: "ZXAJ(...) CUSIP/ISIN Change to (...) (ZXAH, EXAMPLE AUTOMATION
 * INC, US...)". Both rows of one event share the prefix and differ only by
 * this trailing "(TICKER, NAME, ISIN)" triple, so the prefix pairs them
 * (journals/corporate.ts) and the triple tells each row what it holds.
 *
 * `null` when there is no triple to read: the caller falls back on the
 * prefix, which is what the parser did for every row before.
 */
export function legFromDescription(description: string): CorporateActionLeg | null {
  const match = /\(([^()]+)\)\s*$/.exec(description.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 2) return null;
  const ticker = parts[0];
  const isin = parts[parts.length - 1];
  if (!/^[A-Za-z0-9.]+$/.test(ticker)) return null;
  return { ticker, isin };
}
```

- [x] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/common.test.ts
```

Attendu : 7 tests PASS de plus.

- [x] **Step 5 : ajouter `realizedPnl` à `Transaction`**

Dans `packages/ledger/src/types.ts`, ajouter à la fin de l'interface `Transaction`, après `description` :

```ts
  /**
   * Realized P/L as the source reports it; only corporate actions write it
   * today, and a mixed cash-and-stock merger cannot be replayed without it
   * (the basis split comes from a market price we never see).
   *
   * Optional, not merely nullable: a row stored before version 4 of the
   * schema has no such key at all and reads back `undefined`, never `null`.
   */
  realizedPnl?: number | null;
```

Aucun test ne casse : le champ est optionnel.

- [x] **Step 6 : écrire le test qui échoue — les deux jambes d'une opération**

Ajouter à `packages/ib-parsers/src/statement.test.ts` :

```ts
describe("parseActivityStatement corporate actions", () => {
  const cas = parseActivityStatement(html, TARGET).transactions.filter((t) => t.kind === "corporate_action");

  it("gives each leg the ticker it actually holds, not the description prefix", () => {
    const incoming = cas.find((t) => t.quantity === 114);
    const outgoing = cas.find((t) => t.quantity === -114);
    expect(incoming?.symbol).toBe("TESTP");
    expect(outgoing?.symbol).toBe("TESTV.OLD");
  });

  it("keeps the whole description on both legs, so they can be paired", () => {
    const legs = cas.filter((t) => Math.abs(t.quantity ?? 0) === 114);
    expect(legs).toHaveLength(2);
    expect(legs[0].description).not.toBe(legs[1].description);
    expect(legs[0].description.slice(0, 40)).toBe(legs[1].description.slice(0, 40));
  });

  it("reads Realized P/L, and leaves it null when the cell is empty", () => {
    expect(cas.find((t) => t.quantity === -120)?.realizedPnl).toBe(180.40);
    expect(cas.find((t) => t.quantity === 114)?.realizedPnl).toBe(0);
  });

  it("falls back on the description prefix when there is no trailing triple", () => {
    const legacy = cas.find((t) => t.quantity === 100);
    expect(legacy?.symbol).toBe("TESTX");
  });
});
```

- [x] **Step 7 : étendre le fixture avec les deux formes**

Dans `packages/ib-parsers/tests/fixtures/activity_statement_sample.htm`, section
`tblCorporateActions_U0000001Body`, insérer ces quatre lignes **avant** la ligne
`<tr class="subtotal">`. La première paire est un changement de CUSIP (cas B), la seconde une
fusion mixte (cas D) dont seule la jambe sortante porte du cash et un P/L :

```html
<tr>
<td>2025-09-22</td>
<td>2025-09-21, 20:25:00</td>
<td>TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000) (TESTP, TEST P INC, US7411000000)</td>
<td align="right">114</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">&nbsp;</td>
</tr>
<tr>
<td>2025-09-22</td>
<td>2025-09-21, 20:25:00</td>
<td>TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000) (TESTV.OLD, TEST V CORP, US9228000000)</td>
<td align="right">-114</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">&nbsp;</td>
</tr>
<tr>
<td>2025-12-29</td>
<td>2025-12-28, 20:25:00</td>
<td>TESTH(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923 (TESTC, TEST C CORP, CA2257000000)</td>
<td align="right">64.08</td>
<td align="right">0.00</td>
<td align="right">412.33</td>
<td align="right">0.00</td>
<td align="right">&nbsp;</td>
</tr>
<tr>
<td>2025-12-29</td>
<td>2025-12-28, 20:25:00</td>
<td>TESTH(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923 (TESTH, TEST H INC, CA4083000000)</td>
<td align="right">-120</td>
<td align="right">1290.40</td>
<td align="right">-1701.20</td>
<td align="right">180.40</td>
<td align="right">&nbsp;</td>
</tr>
```

- [x] **Step 8 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/statement.test.ts
```

Attendu : ÉCHEC — `symbol` vaut `"TESTV"` sur les deux jambes, et `realizedPnl` est `undefined`.

- [x] **Step 9 : implémenter dans `parseCorporateActions`**

Remplacer le corps de `parseCorporateActions` (`packages/ib-parsers/src/statement.ts:354`) :

```ts
function parseCorporateActions(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "CorporateActions", false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    const leg = legFromDescription(description);
    const tx = cashRow(ctx, "CorporateActions", "corporate_action", row, {
      // The leg's own ticker, not the description prefix: both rows of one
      // event share that prefix, and a conversion that gave them the same
      // symbol would net to zero instead of moving the position.
      symbol: leg ? leg.ticker : symbolFromDescription(description),
      secType: secTypeOf(ctx, row.assetCategory),
      right: "",
      strike: null,
      expiry: null,
      quantity: parseNumber(row.cells["Quantity"], `corporate action ${description} quantity`),
      when: parseStatementDateTime(row.cells["Date/Time"], `corporate action ${description}`),
      description,
    });
    return { ...tx, realizedPnl: parseNumber(row.cells["Realized P/L"], `corporate action ${description} realized P/L`) };
  });
}
```

Ajouter `legFromDescription` à l'import de `./common.ts` en tête du fichier.

- [x] **Step 10 : lancer les tests du paquet, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ib-parsers test
```

Attendu : tous PASS. Le test existant `statement.test.ts` « reads a corporate action with its
quantity and zero proceeds kept as zero » reste vert : la ligne `TESTX` d'origine n'a pas de
triplet final et passe par la retombée `symbolFromDescription`.

- [x] **Step 11 : commit**

```bash
git add packages/ib-parsers/src/common.ts packages/ib-parsers/src/common.test.ts \
        packages/ib-parsers/src/statement.ts packages/ib-parsers/src/statement.test.ts \
        packages/ib-parsers/tests/fixtures/activity_statement_sample.htm \
        packages/ledger/src/types.ts docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
fix(parsers): chaque jambe d'une opération sur titres porte son propre ticker

Les deux lignes d'une opération partagent le préfixe de leur description, pas
leur titre. Leur donner le même symbole faisait 114 − 114 = 0 : la conversion
s'annulait au lieu de déplacer la position. Le ticker se lit dans le triplet
final, et Realized P/L est conservé — la fusion mixte ne se rejoue pas sans lui.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 3 : `conid`, `isin` et `realizedPnl` chez Flex et chez l'agent

**Files:**
- Modify: `packages/ib-parsers/src/flex.ts` (`FlexParseResult`, `parseTrades`, `parseCashTransactions`, `parseCorporateActions`, `parseOpenPosition`, `parseFlexXml`)
- Modify: `packages/ib-parsers/src/flex.test.ts`
- Modify: `packages/ib-parsers/src/agent.ts` (`AgentSnapshot`, `parseAgentSnapshot`)
- Modify: `packages/ib-parsers/src/agent.test.ts`

**Interfaces:**
- Consumes: `ContractIdentity`, `mergeIdentities` (tâche 1) ; `Transaction.realizedPnl` (tâche 2).
- Produces: `FlexParseResult.identities: ContractIdentity[]`, `AgentSnapshot.identities: ContractIdentity[]`.

**Ce que chaque source donne, constaté sur le fichier réel.** `OpenPosition` et
`CashTransaction` portent déjà `conid` et `isin` ; `Trade` non, parce que la case n'est pas
cochée dans la section Trades de la requête. Le parseur lit donc l'attribut **quand il est
là**, sans jamais l'exiger : un `conid` absent n'est pas une erreur, pas même un avertissement
au niveau de la ligne — la page Sources le dira une fois pour tout le fichier (tâche 9).
L'agent, lui, porte `conId` sur chaque contrat, positions et exécutions : rien à changer côté
Python, rien à réinstaller.

**Ce qu'on ne peut pas vérifier.** La section `CorporateActions` du Flex réel est vide. La
branche Flex des opérations sur titres est écrite d'après le schéma, couverte par les fixtures
ci-dessous, et déclarée non vérifiée contre une donnée réelle (tâche 12, dette).

- [x] **Step 1 : écrire le test qui échoue — identités et `realizedPnl` côté Flex**

Ajouter à `packages/ib-parsers/src/flex.test.ts` :

```ts
const TRADE_WITH_CONID = STOCK_TRADE.replace('symbol="SYMA"', 'symbol="SYMA" conid="123" isin="US0000000001"');
const CA_WITH_CONID =
  '<CorporateAction accountId="U0000001" symbol="SYMC" description="SYMA(US0000000001) CUSIP/ISIN Change to (US0000000002) (SYMC, SYM C INC, US0000000002)" assetCategory="STK" dateTime="20260530;200000" quantity="100" proceeds="0" fifoPnlRealized="12.5" transactionID="7000000002" currency="USD" conid="124" isin="US0000000002" />';

describe("parseFlexXml contract identities", () => {
  it("derives an identity from an open position, which always carries a conid", () => {
    const { identities } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(identities.find((i) => i.conid === "123")).toEqual({
      conid: "123",
      isin: "",
      secType: "STK",
      currency: "USD",
      description: "SYMA HOLDINGS INC",
      tickers: ["SYMA"],
    });
  });

  it("derives an identity from a trade when the query carries the column", () => {
    const { identities } = parseFlexXml(flex(`<Trades>${TRADE_WITH_CONID}</Trades><CashTransactions/>`), TARGET);
    expect(identities).toEqual([
      { conid: "123", isin: "US0000000001", secType: "STK", currency: "USD", description: "SYMA HOLDINGS INC", tickers: ["SYMA"] },
    ]);
  });

  it("yields nothing from a trade without the column, and does not complain", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/>`), TARGET);
    expect(result.identities).toEqual([]);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("folds one conid seen on a trade and on a position into a single identity", () => {
    const { identities } = parseFlexXml(flex(`<Trades>${TRADE_WITH_CONID}</Trades><CashTransactions/><OpenPositions>${STOCK_POSITION}</OpenPositions>${CASH_REPORT}`), TARGET);
    expect(identities.filter((i) => i.conid === "123")).toHaveLength(1);
    expect(identities.find((i) => i.conid === "123")?.isin).toBe("US0000000001");
  });
});

describe("parseFlexXml corporate actions", () => {
  it("reads fifoPnlRealized into realizedPnl", () => {
    const [ca] = parseFlexXml(flex(`<Trades/><CashTransactions/><CorporateActions>${CA_WITH_CONID}</CorporateActions>`), TARGET).transactions;
    expect(ca).toMatchObject({ kind: "corporate_action", symbol: "SYMC", quantity: 100, amount: 0, realizedPnl: 12.5 });
  });

  it("leaves realizedPnl null when the attribute is absent", () => {
    const [ca] = parseFlexXml(flex(`<Trades/><CashTransactions/><CorporateActions>${CORPORATE_ACTION}</CorporateActions>`), TARGET).transactions;
    expect(ca.realizedPnl).toBeNull();
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/flex.test.ts
```

Attendu : ÉCHEC, `identities` n'existe pas sur `FlexParseResult`.

- [x] **Step 3 : implémenter côté Flex**

Dans `packages/ib-parsers/src/flex.ts`, ajouter l'import et le helper :

```ts
import { mergeIdentities, type ContractIdentity } from "./identity.ts";

/**
 * The identity an element carries, when it carries one. `conid` and `isin`
 * are per-section columns of the Flex query: Open Positions and Cash
 * Transactions have them in practice, Trades usually not. Absent, the element
 * simply identifies nothing — never an issue, never a throw.
 */
function identityOf(el: Element): ContractIdentity | null {
  const conid = attr(el, "conid") ?? "";
  const ticker = attr(el, "symbol") ?? "";
  if (conid === "" || ticker === "") return null;
  return {
    conid,
    isin: attr(el, "isin") ?? "",
    secType: attr(el, "assetCategory") ?? "",
    currency: attr(el, "currency") ?? "",
    description: attr(el, "description") ?? "",
    tickers: [ticker],
  };
}

/** Every identity the file happens to carry, whatever the section. */
function parseIdentities(statementEl: Element): ContractIdentity[] {
  const found: ContractIdentity[] = [];
  for (const sectionName of ["Trades", "CashTransactions", "CorporateActions", "OpenPositions"] as const) {
    const el = section(statementEl, sectionName);
    if (!el) continue;
    for (const child of Array.from(el.children)) {
      const identity = identityOf(child);
      if (identity) found.push(identity);
    }
  }
  return mergeIdentities([found]);
}
```

Ajouter le champ au résultat :

```ts
export interface FlexParseResult extends ParseResult<FlexStatementInfo> {
  snapshot: FlexSnapshot | null;
  /** Contract identities the file happened to carry; empty when no section has the column. */
  identities: ContractIdentity[];
}
```

Dans `parseFlexXml`, rendre `identities: parseIdentities(statementEl)` sur le chemin nominal
et `identities: []` sur **chacun** des retours anticipés, y compris la branche
`NormalizationError` du `catch`.

Dans le `parseCorporateActions` de ce fichier, ajouter le champ après `description` :

```ts
      realizedPnl: parseNumber(attr(el, "fifoPnlRealized"), `${what} realized P/L`),
```

- [x] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/flex.test.ts
```

Attendu : tous PASS. Le test existant « normalizes a stock trade » compare avec `toEqual` un
objet sans `realizedPnl` : il reste vert parce que `parseTrades` n'écrit pas le champ.

- [x] **Step 5 : écrire le test qui échoue — identités côté agent**

Ajouter à `packages/ib-parsers/src/agent.test.ts` :

```ts
describe("parseAgentSnapshot contract identities", () => {
  it("derives an identity from every position and every execution", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    const stock = parsed.identities.find((i) => i.tickers.includes("AAPL"));
    expect(stock).toMatchObject({ conid: "265598", secType: "STK", currency: "USD", tickers: ["AAPL"] });
  });

  it("folds a contract held and traded in the same pass into one identity", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    expect(parsed.identities.filter((i) => i.conid === "265598")).toHaveLength(1);
  });

  it("has no ISIN to give: TWS does not report one", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    expect(parsed.identities.every((i) => i.isin === "")).toBe(true);
  });
});
```

`payload` est la fixture JSON déjà utilisée par ce fichier de test
(`tests/fixtures/agent_snapshot_sample.json`) ; reprendre la constante telle qu'elle y est
déjà nommée. Si le `conId` de la position AAPL du fixture diffère de `265598`, utiliser la
valeur du fixture plutôt que de modifier le fixture.

- [x] **Step 6 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/agent.test.ts
```

Attendu : ÉCHEC, `identities` n'existe pas sur `AgentSnapshot`.

- [x] **Step 7 : implémenter côté agent**

Dans `packages/ib-parsers/src/agent.ts`, ajouter l'import puis le helper, à côté de
`readFields` :

```ts
import { mergeIdentities, type ContractIdentity } from "./identity.ts";

/**
 * TWS always gives a conId and never an ISIN. The ticker is the one
 * `readFields` chose: the underlying for an option, the dotted pair for a
 * currency — identities of anything but a stock are filtered out downstream
 * (`buildIdentities`), so no option conid ever aliases its underlying's name.
 */
function identityOf(contract: AgentContract, fields: ContractFields): ContractIdentity | null {
  const conid = String(contract.conId);
  if (conid === "0" || fields.symbol === "") return null;
  return {
    conid,
    isin: "",
    secType: fields.secType,
    currency: contract.currency,
    description: describeAgentContract(fields),
    tickers: [fields.symbol],
  };
}
```

Ajouter le champ à `AgentSnapshot` :

```ts
  /** Contract identities of this pass, from `conId`; TWS gives no ISIN. */
  identities: ContractIdentity[];
```

Dans `parseAgentSnapshot`, collecter une identité par position et par exécution — dans
`readPosition` et `readExecution`, pousser `identityOf(contract, fields)` dans un tableau que
la fonction appelante fusionne par `mergeIdentities([collected])` avant de rendre le snapshot.
Le plus simple sans changer les signatures : faire porter le tableau par le même objet que
`issues`, déjà passé aux deux lecteurs.

- [x] **Step 8 : lancer les tests du paquet, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ib-parsers test
```

Attendu : tous PASS.

- [x] **Step 9 : vérifier que rien n'a bougé ailleurs**

```bash
pnpm check
```

Attendu : PASS. `apps/web` compile encore : `identities` est un champ ajouté, jamais retiré, et
personne ne le lit avant la tâche 8.

- [x] **Step 10 : commit**

```bash
git add packages/ib-parsers/src/flex.ts packages/ib-parsers/src/flex.test.ts \
        packages/ib-parsers/src/agent.ts packages/ib-parsers/src/agent.test.ts \
        docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(parsers): Flex et l'agent livrent l'identité des contrats qu'ils voient

Le conid est déjà là chez l'agent, sur les positions Flex et sur les mouvements
de cash ; il manque aux trades parce que la case n'est pas cochée dans la
requête. Le parseur le lit quand il est là et ne le réclame jamais.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 4 : corpus HTML anonymisé, les sept formes

**Files:**
- Create: `packages/ib-parsers/scripts/anonymize-statement.mjs`
- Create: `packages/ib-parsers/tests/fixtures/statement_ca_corpus_2022.htm`
- Create: `packages/ib-parsers/tests/fixtures/statement_ca_corpus_2023.htm`
- Create: `packages/ib-parsers/tests/fixtures/statement_ca_corpus_2024.htm`
- Create: `packages/ib-parsers/src/corpus.test.ts`
- Modify: `package.json` (racine, script `anonymize:statement`)

**Interfaces:**
- Consumes: `parseActivityStatement`, `ContractIdentity` (tâche 1).
- Produces: trois fixtures et `CORPUS_FILES`, exporté par `corpus.test.ts`… non : les chemins sont recalculés dans chaque test qui en a besoin (tâche 11), pour ne pas faire d'un fichier de test un module.

**Ce que l'anonymiseur préserve, et pourquoi.** L'oracle de ce sous-projet porte sur des
**quantités** : le portefeuille reconstitué doit retrouver les Open Positions du dernier
relevé. Les quantités restent donc réelles, comme elles le sont déjà dans
`flex_journals_corpus.xml` et pour la même raison — c'est une décision déjà prise et déjà
inscrite dans `docs/points-reportes.md`. Sont mappés : l'identifiant de compte, les tickers,
les `conid`, les ISIN, les noms de sociétés, les prix et les montants. Sont préservés : les
dates, les quantités, la structure des sections, les libellés d'événements
(`Split 1 for 8`, `CUSIP/ISIN Change to`, `Cash and Stock Merger`), et surtout la
**cohérence entre fichiers** — un `conid` réel donne toujours le même `conid` mappé, dans les
trois années, sans quoi le corpus ne teste rien.

**Contrainte du cas D.** La ligne de fusion mixte porte `Proceeds`, `Realized P/L` et une base
implicite qui doivent rester arithmétiquement cohérents entre eux. L'anonymiseur applique donc
**un seul facteur d'échelle par devise** à tous les montants, jamais un mappage indépendant
par cellule : `base consommée = proceeds − realizedPnl` doit rester vrai après anonymisation.

- [x] **Step 1 : écrire le test qui échoue**

Créer `packages/ib-parsers/src/corpus.test.ts` :

```ts
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const YEARS = ["2022", "2023", "2024"] as const;

function parseYear(year: string) {
  const html = readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8");
  const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(html)![1];
  return parseActivityStatement(html, { accountId: "corpus", ibAccountId });
}

describe("the anonymized corporate-action corpus", () => {
  const parsed = YEARS.map(parseYear);

  it("parses without a single error", () => {
    for (const result of parsed) expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("carries no account id but the anonymized one", () => {
    for (const year of YEARS) {
      const html = readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8");
      // No word boundaries, deliberately: "_" and "U" are both word
      // characters, so `\b` never fires in "tblTransactions_U…Body" — the
      // section ids are exactly where a leaked account id hid once.
      const ids = new Set(html.match(/U\d{7,9}/g) ?? []);
      expect([...ids].sort()).toEqual(["U9000000"]);
    }
  });

  it("carries the four event shapes that produce corporate-action rows", () => {
    const descriptions = parsed.flatMap((r) => r.transactions.filter((t) => t.kind === "corporate_action").map((t) => t.description));
    expect(descriptions.some((d) => /CUSIP\/ISIN Change to/.test(d))).toBe(true);
    expect(descriptions.some((d) => /Split 1 for \d+/.test(d))).toBe(true);
    expect(descriptions.some((d) => /Merged\(Acquisition\)/.test(d))).toBe(true);
    expect(descriptions.some((d) => /Cash and Stock Merger/.test(d))).toBe(true);
  });

  it("keeps a mixed merger arithmetically consistent after anonymization", () => {
    const merger = parsed
      .flatMap((r) => r.transactions)
      .find((t) => t.kind === "corporate_action" && /Cash and Stock Merger/.test(t.description) && (t.quantity ?? 0) < 0)!;
    expect(merger.amount).not.toBeNull();
    expect(merger.realizedPnl).not.toBeNull();
    // The basis the cash consumed must stay positive and below the cash itself.
    const basis = merger.amount! - merger.realizedPnl!;
    expect(basis).toBeGreaterThan(0);
    expect(basis).toBeLessThan(merger.amount!);
  });

  it("keeps one conid consistent across two files: the ticker rename with no event", () => {
    const byConid = new Map<string, Set<string>>();
    for (const result of parsed) {
      for (const identity of result.identities) {
        const set = byConid.get(identity.conid) ?? new Set<string>();
        for (const ticker of identity.tickers) set.add(ticker);
        byConid.set(identity.conid, set);
      }
    }
    // At least one contract wears two different names across the corpus:
    // that is the whole point of cases E and F.
    expect([...byConid.values()].some((tickers) => tickers.size >= 2)).toBe(true);
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/corpus.test.ts
```

Attendu : ÉCHEC, `ENOENT ... statement_ca_corpus_2022.htm`.

- [x] **Step 3 : écrire l'anonymiseur**

Créer `packages/ib-parsers/scripts/anonymize-statement.mjs`. Il lit un ou plusieurs relevés,
partage un dictionnaire entre eux, et écrit les copies anonymisées :

```js
#!/usr/bin/env node
// Anonymizes IB activity statements while keeping what an oracle needs:
// dates, quantities, section structure, event wording, and — across files —
// one stable mapping per real identifier. Quantities stay real, exactly as
// they do in flex_journals_corpus.xml and for the same reason: the
// reconciliation oracle is additive on quantities, and a linear map is
// always invertible (docs/points-reportes.md).
//
// Usage:
//   node scripts/anonymize-statement.mjs --out tests/fixtures/statement_ca_corpus \
//        ../../private/<account>_2022_2022.htm ../../private/<account>_2023_2023.htm \
//        ../../private/<account>_2024_2024.htm
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex === -1) throw new Error("--out <prefix> is required");
const outPrefix = args[outIndex + 1];
const inputs = args.filter((a, i) => i !== outIndex && i !== outIndex + 1 && !a.startsWith("--"));
if (inputs.length === 0) throw new Error("at least one statement is required");

/** One shared dictionary for every file: the same real value always maps to the same fake one. */
const maps = { account: new Map(), ticker: new Map(), conid: new Map(), isin: new Map(), name: new Map() };
const counters = { account: 0, ticker: 0, conid: 0, isin: 0, name: 0 };

/** Letters of a base-26 sequence: 0 -> AAA, 1 -> AAB… Deterministic and collision-free. */
function letters(n) {
  const a = String.fromCharCode(65 + Math.floor(n / 676) % 26);
  const b = String.fromCharCode(65 + Math.floor(n / 26) % 26);
  const c = String.fromCharCode(65 + (n % 26));
  return `${a}${b}${c}`;
}

function mapped(kind, value, make) {
  if (value === "") return "";
  const current = maps[kind].get(value);
  if (current !== undefined) return current;
  const next = make(counters[kind]++);
  maps[kind].set(value, next);
  return next;
}

/** A ticker keeps its suffix: "ZXAA.OLD" -> "AAB.OLD", so `.OLD` still means `.OLD`. */
function mapTicker(ticker) {
  const dot = ticker.indexOf(".");
  if (dot !== -1) return `${mapTicker(ticker.slice(0, dot))}${ticker.slice(dot)}`;
  return mapped("ticker", ticker, (n) => letters(n));
}
const mapAccount = (v) => mapped("account", v, (n) => `U${9000000 + n}`);
const mapConid = (v) => mapped("conid", v, (n) => String(100000000 + n));
const mapIsin = (v) => mapped("isin", v, (n) => `US${String(1000000000 + n).padStart(10, "0")}`);
const mapName = (v) => mapped("name", v, (n) => `TEST COMPANY ${letters(n)}`);

/**
 * One scale factor for the whole corpus, not one map per cell: a mixed merger
 * only replays if `proceeds - realizedPnl` stays a plausible basis, and that
 * survives a uniform scaling. 0.7371 is arbitrary and irrational-looking on
 * purpose, so no reader mistakes a fixture figure for a real one.
 */
const SCALE = 0.7371;
function mapMoney(text) {
  const negative = text.trim().startsWith("-");
  const n = Number(text.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return text;
  const scaled = n * SCALE;
  return (negative && scaled > 0 ? -scaled : scaled).toFixed(2);
}
```

Le corps du script suit : pour chaque fichier, remplacer l'identifiant de compte partout
(`tbl…Body`, `sec…Heading`, attributs, texte), puis, table par table, appliquer `mapTicker` à
la colonne `Symbol`, `mapConid` à `Conid`, `mapIsin` à `Security ID`, `mapName` à
`Description` des lignes de Contract Information, et `mapMoney` aux colonnes monétaires
(`Proceeds`, `Value`, `Realized P/L`, `T. Price`, `C. Price`, `Comm/Fee`, `Basis`, `MTM P/L`,
`Cost Price`, `Cost Basis`, `Close Price`, `Unrealized P/L`). Les descriptions d'opérations
sur titres sont réécrites en remplaçant, dans le texte, chaque ticker et chaque ISIN reconnu
par son image ; les libellés d'événement ne sont jamais touchés. Les colonnes `Quantity` et
les dates sont recopiées telles quelles.

Ajouter le script au `package.json` de la racine :

```json
    "anonymize:statement": "node packages/ib-parsers/scripts/anonymize-statement.mjs"
```

- [x] **Step 4 : générer le corpus**

```bash
cd packages/ib-parsers
node scripts/anonymize-statement.mjs --out tests/fixtures/statement_ca_corpus \
  ../../private/<account>_2022_2022.htm \
  ../../private/<account>_2023_2023.htm \
  ../../private/<account>_2024_2024.htm
cd ../..
```

Attendu : trois fichiers écrits.

- [x] **Step 5 : vérifier à l'œil qu'aucune donnée réelle ne subsiste**

```bash
grep -c '<account>\|ZXAJ\|ZXAH\|ZXAA\|ZXAB\|ZXAN\|ZXAE\|ZXAD' packages/ib-parsers/tests/fixtures/statement_ca_corpus_*.htm
```

Attendu : `0` pour les trois fichiers. Toute occurrence est un défaut de l'anonymiseur, à
corriger avant de committer — un fixture est versionné pour toujours.

- [x] **Step 6 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/corpus.test.ts
```

Attendu : 6 tests PASS.

- [x] **Step 7 : commit**

```bash
git add packages/ib-parsers/scripts/anonymize-statement.mjs \
        packages/ib-parsers/tests/fixtures/statement_ca_corpus_*.htm \
        packages/ib-parsers/src/corpus.test.ts package.json \
        docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
test(parsers): un corpus de relevés anonymisés portant les sept formes

Quantités et dates réelles, tout le reste mappé — même raison que le corpus
Flex : l'oracle est additif sur les quantités. Un seul facteur d'échelle par
devise, pour que « proceeds − realizedPnl » reste une base plausible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 5 : `ContractIdentities`, résolution sans ambiguïté

**Files:**
- Create: `packages/ledger/src/journals/identities.ts`
- Create: `packages/ledger/src/journals/identities.test.ts`
- Modify: `packages/ledger/src/journals/index.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `IdentityInput`, `IdentityAlias`, `IdentityIssue`, `ContractIdentities`, `NO_IDENTITIES`, `buildIdentities(inputs: readonly IdentityInput[]): ContractIdentities`.

Cette tâche livre les règles 1, 2, 3 et 5 de la spec §5.2. Les règles 4 et 6 — l'arbitrage
d'un ticker ambigu par la date — demandent les opérations sur titres et arrivent en tâche 6 ;
d'ici là un ticker ambigu reste lui-même et produit un `IdentityIssue`, ce qui est déjà le
comportement final quand rien ne permet de trancher.

**Pourquoi seules les actions comptent.** Un `conid` d'option porte le ticker de son
sous-jacent : laisser entrer les options ferait de « TESTX » un ticker partagé par des dizaines
de classes, toutes en conflit. `buildIdentities` ne retient que `secType === "STK"`.

- [x] **Step 1 : écrire le test qui échoue**

Créer `packages/ledger/src/journals/identities.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { NO_IDENTITIES, buildIdentities, type IdentityInput } from "./identities.ts";

const WHEN = "2023-06-01T20:25:00.000Z";

function input(conid: string, tickers: [string, string, string][], secType = "STK"): IdentityInput {
  return { conid, secType, aliases: tickers.map(([ticker, firstSeen, lastSeen]) => ({ ticker, firstSeen, lastSeen })) };
}

describe("NO_IDENTITIES", () => {
  it("is the identity function: a ledger with no hint behaves as it always did", () => {
    expect(NO_IDENTITIES.canonical("ZXAA", WHEN)).toBe("ZXAA");
    expect(NO_IDENTITIES.issues).toEqual([]);
  });
});

describe("buildIdentities", () => {
  it("resolves every alias of one conid to its canonical (rules 1 and 3)", () => {
    const identities = buildIdentities([input("1", [["ZXAB", "2022-01-01", "2022-12-31"], ["ZXABQ", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAB", WHEN)).toBe("ZXABQ");
    expect(identities.canonical("ZXABQ", WHEN)).toBe("ZXABQ");
    expect(identities.issues).toEqual([]);
  });

  it("prefers the alias without a .OLD suffix, whatever the dates (rule 2)", () => {
    const identities = buildIdentities([input("1", [["ZXAA", "2022-01-01", "2022-12-31"], ["ZXAA.OLD", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAA.OLD", WHEN)).toBe("ZXAA");
  });

  it("keeps a .OLD alias when it is the only one there is (rule 2)", () => {
    const identities = buildIdentities([input("1", [["ZXAD.OLD", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAD.OLD", WHEN)).toBe("ZXAD.OLD");
  });

  it("picks the latest-seen alias when several have no suffix (rule 2)", () => {
    const identities = buildIdentities([input("1", [["ZXAN", "2022-01-01", "2022-12-31"], ["ZXANQ", "2023-01-01", "2023-12-31"]])]);
    expect(identities.canonical("ZXAN", WHEN)).toBe("ZXANQ");
  });

  it("leaves a ticker no conid ever claimed alone (rule 5)", () => {
    const identities = buildIdentities([input("1", [["ZXAB", "2022-01-01", "2022-12-31"]])]);
    expect(identities.canonical("MQZA", WHEN)).toBe("MQZA");
  });

  it("leaves an ambiguous ticker alone and says so (rule 6, until task 6 dates it)", () => {
    const identities = buildIdentities([
      input("1", [["ZXAA", "2022-01-01", "2023-06-22"]]),
      input("2", [["ZXAA", "2023-06-23", "2023-12-31"], ["ZXAAQ", "2024-01-01", "2024-12-31"]]),
    ]);
    expect(identities.canonical("ZXAA", WHEN)).toBe("ZXAA");
    expect(identities.issues).toEqual([
      { ticker: "ZXAA", code: "ambiguous-unresolved", detail: "ZXAA names 2 contracts (1, 2) and no corporate action separates them" },
    ]);
  });

  it("ignores anything that is not a stock: an option conid wears its underlying's name", () => {
    const identities = buildIdentities([
      input("1", [["TESTX", "2022-01-01", "2022-12-31"]], "OPT"),
      input("2", [["TESTX", "2023-01-01", "2023-12-31"]], "OPT"),
    ]);
    expect(identities.canonical("TESTX", WHEN)).toBe("TESTX");
    expect(identities.issues).toEqual([]);
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/identities.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./identities.ts"`.

- [x] **Step 3 : implémenter `identities.ts`**

Créer `packages/ledger/src/journals/identities.ts` :

```ts
/** One spelling of a contract, and the import periods that saw it. */
export interface IdentityAlias {
  ticker: string;
  /** YYYY-MM-DD of the earliest file that showed this spelling. */
  firstSeen: string;
  lastSeen: string;
}

/** One contract, as the stores and the parsers describe it. */
export interface IdentityInput {
  conid: string;
  secType: string;
  aliases: IdentityAlias[];
}

/** A ticker the rules left as it was, and why. */
export interface IdentityIssue {
  ticker: string;
  code: "ambiguous-unresolved" | "action-unpaired" | "merger-basis-unknown";
  detail: string;
}

/**
 * Resolves a ticker to the one name the whole ledger should use for its
 * contract. The `conid` behind it is an equivalence hint and never a contract
 * key: `contractId` still keys on the ticker, this only decides *which*
 * ticker (spec §3.1).
 */
export interface ContractIdentities {
  canonical(ticker: string, when: string): string;
  issues: IdentityIssue[];
}

/** No hint at all: every ticker is its own canonical, i.e. today's behaviour. */
export const NO_IDENTITIES: ContractIdentities = {
  canonical: (ticker) => ticker,
  issues: [],
};

/** IB renames the pre-event contract "X.OLD"; that name is never a good canonical. */
function isOld(ticker: string): boolean {
  return ticker.endsWith(".OLD");
}

/**
 * The name a class should wear: the alias without a `.OLD` suffix, latest
 * sighting first. A class whose only alias is `.OLD` keeps it — inventing the
 * un-suffixed name would collide with the contract that actually bears it.
 */
function canonicalOf(aliases: readonly IdentityAlias[]): string {
  const ranked = [...aliases].sort((a, b) => {
    if (isOld(a.ticker) !== isOld(b.ticker)) return isOld(a.ticker) ? 1 : -1;
    if (a.lastSeen !== b.lastSeen) return a.lastSeen < b.lastSeen ? 1 : -1;
    return a.ticker < b.ticker ? -1 : 1;
  });
  return ranked[0].ticker;
}

export function buildIdentities(inputs: readonly IdentityInput[]): ContractIdentities {
  const stocks = inputs.filter((input) => input.secType === "STK" && input.aliases.length > 0);
  /** ticker -> the conids that ever wore it. */
  const claims = new Map<string, string[]>();
  const canonicalByConid = new Map<string, string>();
  for (const input of stocks) {
    canonicalByConid.set(input.conid, canonicalOf(input.aliases));
    for (const alias of input.aliases) {
      const list = claims.get(alias.ticker);
      if (list) {
        if (!list.includes(input.conid)) list.push(input.conid);
      } else claims.set(alias.ticker, [input.conid]);
    }
  }

  const resolved = new Map<string, string>();
  const issues: IdentityIssue[] = [];
  for (const [ticker, conids] of claims) {
    if (conids.length === 1) {
      resolved.set(ticker, canonicalByConid.get(conids[0])!);
      continue;
    }
    // Rule 6: two contracts share a name and nothing separates them. Leaving
    // the ticker alone is today's behaviour; guessing would merge two real
    // positions into one.
    issues.push({
      ticker,
      code: "ambiguous-unresolved",
      detail: `${ticker} names ${conids.length} contracts (${conids.join(", ")}) and no corporate action separates them`,
    });
  }
  issues.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  return {
    canonical: (ticker) => resolved.get(ticker) ?? ticker,
    issues,
  };
}
```

- [x] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/identities.test.ts
```

Attendu : 8 tests PASS.

- [x] **Step 5 : exporter le module**

Dans `packages/ledger/src/journals/index.ts`, ajouter :

```ts
export * from "./identities.ts";
```

- [x] **Step 6 : lancer tous les tests du moteur**

```bash
pnpm --filter @ib/ledger test
```

Attendu : tous PASS. Rien ne consomme encore `ContractIdentities`.

- [x] **Step 7 : commit**

```bash
git add packages/ledger/src/journals/identities.ts packages/ledger/src/journals/identities.test.ts \
        packages/ledger/src/journals/index.ts docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(ledger): un ticker se résout vers le canonique de son contrat

Le conid regroupe les alias, il ne devient jamais une clé. Un ticker qu'aucun
conid ne réclame reste lui-même ; un ticker que deux contrats se disputent
reste lui-même aussi, et le dit — la date qui les sépare vient avec les
opérations sur titres.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 6 : apparier les opérations, dater les tickers ambigus

**Files:**
- Create: `packages/ledger/src/journals/corporate.ts`
- Create: `packages/ledger/src/journals/corporate.test.ts`
- Modify: `packages/ledger/src/journals/identities.ts` (règles 4 et 6)
- Modify: `packages/ledger/src/journals/identities.test.ts`
- Modify: `packages/ledger/src/journals/index.ts`

**Interfaces:**
- Consumes: `IdentityInput`, `IdentityIssue`, `ContractIdentities`, `buildIdentities` (tâche 5).
- Produces: `CorporateActionEvent`, `pairCorporateActions(transactions: readonly Transaction[]): { events: CorporateActionEvent[]; issues: IdentityIssue[] }`, et `buildIdentities(inputs, events?)`.

- [x] **Step 1 : écrire le test qui échoue — l'appariement**

Créer `packages/ledger/src/journals/corporate.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { Transaction } from "../types.ts";
import { pairCorporateActions } from "./corporate.ts";

const CONVERSION = "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000)";
const MERGER = "TESTH(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923";

function ca(symbol: string, quantity: number, description: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    accountId: "test",
    externalId: `html:${symbol}${quantity}`,
    source: "statement_html",
    kind: "corporate_action",
    symbol,
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity,
    price: null,
    amount: 0,
    commission: null,
    currency: "USD",
    when: "2025-09-21T20:25:00.000Z",
    description,
    ...extra,
  };
}

describe("pairCorporateActions", () => {
  it("pairs two legs that share an instant and an event description", () => {
    const { events, issues } = pairCorporateActions([
      ca("TESTP", 114, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV.OLD", -114, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
    ]);
    expect(issues).toEqual([]);
    expect(events).toEqual([
      {
        when: "2025-09-21T20:25:00.000Z",
        from: { ticker: "TESTV.OLD", quantity: -114 },
        to: { ticker: "TESTP", quantity: 114 },
        cash: null,
        ids: ["html:TESTV.OLD-114", "html:TESTP114"],
      },
    ]);
  });

  it("reads the cash leg of a mixed merger, and only of a mixed merger", () => {
    const { events } = pairCorporateActions([
      ca("TESTC", 64.08, `${MERGER} (TESTC, TEST C CORP, CA2257000000)`, { amount: 0, realizedPnl: 0 }),
      ca("TESTH", -120, `${MERGER} (TESTH, TEST H INC, CA4083000000)`, { amount: 1290.40, realizedPnl: 180.40 }),
    ]);
    expect(events[0].cash).toEqual({ amount: 1290.40, realizedPnl: 180.40 });
  });

  it("does not pair two events of the same instant with different descriptions", () => {
    const { events } = pairCorporateActions([
      ca("TESTP", 114, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV.OLD", -114, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
      ca("TESTC", 64.08, `${MERGER} (TESTC, TEST C CORP, CA2257000000)`),
      ca("TESTH", -120, `${MERGER} (TESTH, TEST H INC, CA4083000000)`, { amount: 1290.40, realizedPnl: 180.40 }),
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.to.ticker).sort()).toEqual(["TESTC", "TESTP"]);
  });

  it("reports a lone leg instead of guessing its partner", () => {
    const { events, issues } = pairCorporateActions([ca("TESTX", 100, "TESTX(US0000000000) Split 2 for 1")]);
    expect(events).toEqual([]);
    expect(issues).toEqual([
      { ticker: "TESTX", code: "action-unpaired", detail: 'TESTX(US0000000000) Split 2 for 1 at 2025-09-21T20:25:00.000Z has 1 leg, expected 2' },
    ]);
  });

  it("reports two legs of the same sign instead of inventing a direction", () => {
    const { events, issues } = pairCorporateActions([
      ca("TESTP", 114, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV.OLD", 114, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
    ]);
    expect(events).toEqual([]);
    expect(issues[0].code).toBe("action-unpaired");
  });

  it("ignores every transaction that is not a corporate action", () => {
    const trade = { ...ca("TESTP", 114, "whatever"), kind: "trade" as const };
    expect(pairCorporateActions([trade]).events).toEqual([]);
    expect(pairCorporateActions([trade]).issues).toEqual([]);
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/corporate.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./corporate.ts"`.

- [x] **Step 3 : implémenter `pairCorporateActions`**

Créer `packages/ledger/src/journals/corporate.ts` :

```ts
import type { Transaction } from "../types.ts";
import type { IdentityIssue } from "./identities.ts";

/**
 * One corporate action, both legs folded. `from` is what leaves the account,
 * `to` what arrives; `cash` is the consideration a mixed merger paid on top
 * of the new shares.
 */
export interface CorporateActionEvent {
  when: string;
  from: { ticker: string; quantity: number };
  to: { ticker: string; quantity: number };
  cash: { amount: number; realizedPnl: number | null } | null;
  /** externalIds of both legs, outgoing first: the rows a mixed merger emits cite them. */
  ids: string[];
}

/**
 * Both rows of one action share their description up to the trailing
 * "(TICKER, NAME, ISIN)" triple that names the leg, so stripping the triple
 * yields the event's own name. A description without a triple is its own
 * name, which is why a lone legacy row still groups with itself and is then
 * reported unpaired rather than silently dropped.
 */
function eventName(description: string): string {
  return description.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

export function pairCorporateActions(transactions: readonly Transaction[]): {
  events: CorporateActionEvent[];
  issues: IdentityIssue[];
} {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.kind !== "corporate_action") continue;
    const key = `${tx.when}|${eventName(tx.description)}`;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const events: CorporateActionEvent[] = [];
  const issues: IdentityIssue[] = [];
  for (const legs of groups.values()) {
    const outgoing = legs.filter((tx) => (tx.quantity ?? 0) < 0);
    const incoming = legs.filter((tx) => (tx.quantity ?? 0) > 0);
    if (legs.length !== 2 || outgoing.length !== 1 || incoming.length !== 1) {
      issues.push({
        ticker: legs[0].symbol,
        code: "action-unpaired",
        detail: `${eventName(legs[0].description)} at ${legs[0].when} has ${legs.length} leg${legs.length > 1 ? "s" : ""}, expected 2`,
      });
      continue;
    }
    const [out] = outgoing;
    const [inc] = incoming;
    events.push({
      when: out.when,
      from: { ticker: out.symbol, quantity: out.quantity! },
      to: { ticker: inc.symbol, quantity: inc.quantity! },
      // A pure conversion carries 0 on both legs; a mixed merger carries the
      // cash on the leg that leaves.
      cash: out.amount ? { amount: out.amount, realizedPnl: out.realizedPnl ?? null } : null,
      ids: [out.externalId, inc.externalId],
    });
    if (out.amount && (out.realizedPnl === null || out.realizedPnl === undefined)) {
      // A mixed merger without its realized P/L cannot be split (corporate.ts);
      // say so rather than let it look like an ordinary conversion.
      issues.push({
        ticker: out.symbol,
        code: "merger-basis-unknown",
        detail: `${eventName(out.description)} at ${out.when} pays cash but reports no realized P/L: not replayed`,
      });
    }
  }
  events.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
  return { events, issues };
}
```

- [x] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/corporate.test.ts
```

Attendu : 6 tests PASS.

- [x] **Step 5 : écrire le test qui échoue — le ticker ambigu daté**

Ajouter à `packages/ledger/src/journals/identities.test.ts` :

```ts
import { pairCorporateActions } from "./corporate.ts";

describe("buildIdentities with corporate actions (rule 4)", () => {
  // In the 2023 statement, "ZXAA" names conid 1 before the split and conid 2
  // after it; only the event's `.OLD` leg says which is which.
  const inputs = [
    input("1", [["ZXAA", "2022-01-01", "2023-12-31"], ["ZXAA.OLD", "2023-01-01", "2023-12-31"]]),
    input("2", [["ZXAA", "2023-01-01", "2023-12-31"], ["ZXAAQ", "2024-01-01", "2024-12-31"]]),
  ];
  const events = [
    { when: "2023-06-22T20:25:00.000Z", from: { ticker: "ZXAA.OLD", quantity: -2600 }, to: { ticker: "ZXAA", quantity: 325 }, cash: null, ids: [] },
  ];

  it("resolves the ambiguous ticker to the old class before the event", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAA", "2023-02-01T15:17:26.000Z")).toBe("ZXAA");
  });

  it("resolves it to the new class from the event's instant onward, bounds included", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAA", "2023-06-22T20:25:00.000Z")).toBe("ZXAAQ");
    expect(identities.canonical("ZXAA", "2024-10-17T15:32:54.000Z")).toBe("ZXAAQ");
  });

  it("still resolves the unambiguous aliases of both classes", () => {
    const identities = buildIdentities(inputs, events);
    expect(identities.canonical("ZXAA.OLD", "2022-06-01T00:00:00.000Z")).toBe("ZXAA");
    expect(identities.canonical("ZXAAQ", "2024-06-01T00:00:00.000Z")).toBe("ZXAAQ");
    expect(identities.issues).toEqual([]);
  });

  it("gives up when three classes share the ticker (rule 6)", () => {
    const three = [...inputs, input("3", [["ZXAA", "2025-01-01", "2025-12-31"]])];
    const identities = buildIdentities(three, events);
    expect(identities.canonical("ZXAA", "2024-01-01T00:00:00.000Z")).toBe("ZXAA");
    expect(identities.issues.map((i) => i.code)).toEqual(["ambiguous-unresolved"]);
  });

  it("gives up when both legs of the linking event are themselves ambiguous (rule 6)", () => {
    const bothAmbiguous = [
      input("1", [["AAA", "2022-01-01", "2023-12-31"], ["BBB", "2022-01-01", "2023-12-31"]]),
      input("2", [["AAA", "2023-01-01", "2024-12-31"], ["BBB", "2023-01-01", "2024-12-31"]]),
    ];
    const identities = buildIdentities(bothAmbiguous, [
      { when: "2023-06-22T20:25:00.000Z", from: { ticker: "AAA", quantity: -10 }, to: { ticker: "BBB", quantity: 1 }, cash: null, ids: [] },
    ]);
    expect(identities.canonical("AAA", "2024-01-01T00:00:00.000Z")).toBe("AAA");
    expect(identities.issues.map((i) => i.ticker).sort()).toEqual(["AAA", "BBB"]);
  });

  it("feeds straight from pairCorporateActions", () => {
    const { events: paired } = pairCorporateActions([]);
    expect(buildIdentities(inputs, paired).issues.map((i) => i.code)).toEqual(["ambiguous-unresolved"]);
  });
});
```

- [x] **Step 6 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/identities.test.ts
```

Attendu : ÉCHEC — `buildIdentities` ne prend qu'un argument et `canonical` ignore `when`.

- [x] **Step 7 : implémenter les règles 4 et 6**

Dans `packages/ledger/src/journals/identities.ts`, importer le type de l'événement et
remplacer la fin de `buildIdentities` :

```ts
import type { CorporateActionEvent } from "./corporate.ts";

/** An ambiguous ticker, once an event has dated it: one name before, another from `when` on. */
interface DatedTicker {
  when: string;
  before: string;
  after: string;
}
```

Puis, dans `buildIdentities(inputs, events: readonly CorporateActionEvent[] = [])`, remplacer
la boucle qui produit les `ambiguous-unresolved` :

```ts
  const resolved = new Map<string, string>();
  const dated = new Map<string, DatedTicker>();
  const issues: IdentityIssue[] = [];
  for (const [ticker, conids] of claims) {
    if (conids.length === 1) {
      resolved.set(ticker, canonicalByConid.get(conids[0])!);
      continue;
    }
    const boundary = conids.length === 2 ? dateAmbiguous(ticker, conids, claims, events, canonicalByConid) : null;
    if (boundary) {
      dated.set(ticker, boundary);
      continue;
    }
    // Rule 6: nothing separates the contracts. Leaving the ticker alone is
    // today's behaviour; guessing would merge two real positions into one.
    issues.push({
      ticker,
      code: "ambiguous-unresolved",
      detail: `${ticker} names ${conids.length} contracts (${conids.join(", ")}) and no corporate action separates them`,
    });
  }
  issues.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  return {
    canonical: (ticker, when) => {
      const boundary = dated.get(ticker);
      if (boundary) return when < boundary.when ? boundary.before : boundary.after;
      return resolved.get(ticker) ?? ticker;
    },
    issues,
  };
```

Et ajouter la fonction qui date, au-dessus de `buildIdentities` :

```ts
/**
 * A ticker two contracts share is separated by the corporate action that
 * links them — but only when the action names at least one of them by a name
 * nothing else wears (typically IB's own "X.OLD"). One unambiguous leg is
 * enough: it pins its own class, and the other class is the remaining one.
 * Two ambiguous legs, or more than one linking event, and we refuse: an
 * arbitrary choice here silently merges two real positions.
 */
function dateAmbiguous(
  ticker: string,
  conids: readonly string[],
  claims: ReadonlyMap<string, string[]>,
  events: readonly CorporateActionEvent[],
  canonicalByConid: ReadonlyMap<string, string>,
): DatedTicker | null {
  const classOf = (name: string): string | null => {
    const owners = claims.get(name);
    return owners && owners.length === 1 ? owners[0] : null;
  };
  const candidates: DatedTicker[] = [];
  for (const event of events) {
    const isFrom = event.from.ticker === ticker;
    const isTo = event.to.ticker === ticker;
    if (isFrom === isTo) continue; // neither leg, or a self-referential event
    const other = classOf(isFrom ? event.to.ticker : event.from.ticker);
    if (other === null || !conids.includes(other)) continue;
    const mine = conids.find((conid) => conid !== other)!;
    // `from` is the class that exists before the event, `to` the one after.
    const beforeConid = isFrom ? mine : other;
    const afterConid = isFrom ? other : mine;
    candidates.push({
      when: event.when,
      before: canonicalByConid.get(beforeConid)!,
      after: canonicalByConid.get(afterConid)!,
    });
  }
  return candidates.length === 1 ? candidates[0] : null;
}
```

- [x] **Step 8 : lancer les tests du moteur, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger test
```

Attendu : tous PASS, dont les 6 nouveaux de la règle 4. Les 8 de la tâche 5 restent verts :
`buildIdentities` sans deuxième argument voit une liste d'événements vide et se comporte
comme avant.

- [x] **Step 9 : exporter et committer**

Dans `packages/ledger/src/journals/index.ts`, ajouter `export * from "./corporate.ts";`.

```bash
git add packages/ledger/src/journals/corporate.ts packages/ledger/src/journals/corporate.test.ts \
        packages/ledger/src/journals/identities.ts packages/ledger/src/journals/identities.test.ts \
        packages/ledger/src/journals/index.ts docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(ledger): les deux jambes d'une opération sur titres font un événement

Elles partagent leur instant et le nom de l'événement — la description privée
du triplet qui nomme la jambe. L'événement date au passage le ticker que deux
contrats se disputent : avant lui l'ancien, à partir de lui le nouveau. Une
jambe seule ou deux jambes de même signe ne sont jamais devinées.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 7 : rejouer une conversion

**Files:**
- Modify: `packages/ledger/src/journals/book.ts` (méthode `move`)
- Modify: `packages/ledger/src/journals/book.test.ts`
- Modify: `packages/ledger/src/journals/corporate.ts` (`applyConversion`)
- Modify: `packages/ledger/src/journals/corporate.test.ts`
- Modify: `packages/ledger/src/journals/replay.ts:63-83` (`buildJournals`)
- Modify: `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: `CorporateActionEvent`, `pairCorporateActions` (tâche 6) ; `ContractIdentities`, `NO_IDENTITIES`, `buildIdentities` (tâches 5-6).
- Produces: `LotBook.move(from, to, mutate): Lot[]`, `applyConversion(book: LotBook, event: CorporateActionEvent, currency: string): void`, `buildJournals(transactions, snapshot?, identities?)`.

**Trois choses à faire dans le bon ordre**, et l'ordre est une condition de correction, pas
une préférence : le split ZXAC laisse 0,3333 titre vendu comme un trade ordinaire **au même
instant 20:25:00 que l'opération**. Une conversion appliquée après le trade du même instant
ouvrirait un short.

1. canonicaliser les tickers des transactions `STK` ;
2. apparier les opérations sur titres, sur les transactions déjà canonicalisées ;
3. appliquer chaque événement **avant** le groupe de transactions de son instant.

**Pourquoi canonicaliser le `symbol` plutôt que d'enfiler `identities` dans `contractOf`.**
`contractOf` est appelé d'une douzaine d'endroits ; lui ajouter un paramètre optionnel
obligerait chacun à le transmettre, et un oubli serait une scission silencieuse de lots.
Réécrire une fois `symbol` sur les transactions `STK` à l'entrée du rejeu ne touche qu'un
endroit et laisse `contractId` exactement ce qu'il est. Les options ne sont pas touchées :
leur `symbol` est le symbole OCC empaqueté, et aucune identité d'option n'entre dans la
résolution (tâche 5).

- [x] **Step 1 : écrire le test qui échoue — `LotBook.move`**

Ajouter à `packages/ledger/src/journals/book.test.ts` :

```ts
import { sharesContract } from "./contract.ts";

describe("LotBook.move", () => {
  const from = sharesContract("TESTV", "USD");
  const to = sharesContract("TESTP", "USD");

  function lotOf(quantity: number) {
    return newLot({
      id: `l${quantity}`,
      contract: from,
      strategy: "others",
      kind: "shares",
      openWhen: "2025-01-02T09:30:00.000Z",
      openPrice: 10,
      openAmount: -100 * quantity,
      openCommission: -1,
      quantity,
      openIds: [`x${quantity}`],
    });
  }

  it("moves every open lot onto the new contract and applies the transform", () => {
    const book = new LotBook();
    book.open(lotOf(10));
    book.move(from, to, (lot) => {
      lot.quantity *= 2;
      lot.remaining *= 2;
    });
    expect(book.openLots(from)).toEqual([]);
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([20]);
    expect(book.openLots(to)[0].contract).toEqual(to);
  });

  it("joins lots already open on the destination, oldest first", () => {
    const book = new LotBook();
    const older = newLot({ ...lotOf(5), contract: to, openWhen: "2024-01-02T09:30:00.000Z" });
    book.open(older);
    book.open(lotOf(10));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([5, 10]);
  });

  it("leaves closed lots of the old contract where they are: they are history", () => {
    const book = new LotBook();
    const spent = lotOf(10);
    spent.remaining = 0;
    book.open(spent);
    book.open(lotOf(4));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([4]);
    expect(book.allOpen()).toHaveLength(1);
    expect(spent.contract).toEqual(from);
  });

  it("does nothing at all when the old contract holds nothing open", () => {
    const book = new LotBook();
    expect(book.move(from, to, () => {})).toEqual([]);
    expect(book.allOpen()).toEqual([]);
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/book.test.ts
```

Attendu : ÉCHEC, `book.move is not a function`.

- [x] **Step 3 : implémenter `LotBook.move`**

Ajouter dans la classe `LotBook` de `packages/ledger/src/journals/book.ts`, après `close` :

```ts
  /**
   * Moves every lot still open on `from` onto `to`, applying `mutate` on the
   * way. Closed lots stay where they are: they are the history of a contract
   * that really existed, and rewriting them would rewrite journal rows
   * already emitted. Moved lots join whatever `to` already held, and
   * `openLots` keeps them in insertion order — oldest first, as FIFO wants.
   */
  move(from: ContractKey, to: ContractKey, mutate: (lot: Lot) => void): Lot[] {
    const fromId = contractId(from);
    const all = this.lots.get(fromId) ?? [];
    const moved = all.filter((lot) => lot.remaining !== 0);
    if (moved.length === 0) return [];
    const stayed = all.filter((lot) => lot.remaining === 0);
    if (stayed.length === 0) this.lots.delete(fromId);
    else this.lots.set(fromId, stayed);
    for (const lot of moved) {
      lot.contract = to;
      mutate(lot);
      this.open(lot);
    }
    return moved;
  }
```

`Lot.contract` doit être assignable : vérifier qu'il n'est pas déclaré `readonly` dans
l'interface `Lot`, et le rendre mutable s'il l'est.

- [x] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/book.test.ts
```

Attendu : 4 tests PASS de plus.

- [x] **Step 5 : écrire le test qui échoue — `applyConversion`**

Ajouter à `packages/ledger/src/journals/corporate.test.ts` :

```ts
import { LotBook, newLot } from "./book.ts";
import { sharesContract } from "./contract.ts";
import { applyConversion } from "./corporate.ts";

describe("applyConversion", () => {
  function bookWith(ticker: string, quantity: number, openPrice: number, openAmount: number) {
    const book = new LotBook();
    book.open(newLot({
      id: "l1",
      contract: sharesContract(ticker, "USD"),
      strategy: "others",
      kind: "shares",
      openWhen: "2022-09-06T13:30:00.000Z",
      openPrice,
      openAmount,
      openCommission: -1.02,
      quantity,
      openIds: ["x1"],
    }));
    return book;
  }

  it("carries the basis over untouched and scales quantity by the ratio", () => {
    // ZXAD: 600 shares at 1.10345, 1 for 10.
    const book = bookWith("ZXAD", 600, 1.10345, -662.07);
    applyConversion(book, { when: "2023-09-04T20:25:00.000Z", from: { ticker: "ZXAD", quantity: -600 }, to: { ticker: "ZXAD", quantity: 60 }, cash: null, ids: [] }, "USD");
    const [lot] = book.openLots(sharesContract("ZXAD", "USD"));
    expect(lot.remaining).toBe(60);
    expect(lot.quantity).toBe(60);
    expect(lot.openAmount).toBe(-662.07);
    expect(lot.openCommission).toBe(-1.02);
    expect(lot.openPrice).toBeCloseTo(11.0345, 10);
  });

  it("keeps the lot's age: a conversion is not a purchase", () => {
    const book = bookWith("TESTV", 114, 9.85, -1122.90);
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", quantity: -114 }, to: { ticker: "TESTP", quantity: 114 }, cash: null, ids: [] }, "USD");
    const [lot] = book.openLots(sharesContract("TESTP", "USD"));
    expect(lot.openWhen).toBe("2022-09-06T13:30:00.000Z");
    expect(lot.openIds).toEqual(["x1"]);
  });

  it("merges into a lot already held on the new ticker", () => {
    const book = bookWith("TESTV", 114, 9.85, -1122.90);
    book.open(newLot({
      id: "l2",
      contract: sharesContract("TESTP", "USD"),
      strategy: "others",
      kind: "shares",
      openWhen: "2022-10-18T13:30:00.000Z",
      openPrice: 2.04,
      openAmount: -408,
      openCommission: -1,
      quantity: 200,
      openIds: ["x2"],
    }));
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", quantity: -114 }, to: { ticker: "TESTP", quantity: 114 }, cash: null, ids: [] }, "USD");
    expect(book.position(sharesContract("TESTP", "USD"))).toBe(314);
  });

  it("leaves a null openPrice null", () => {
    const book = bookWith("TESTV", 114, 9.85, -1122.90);
    book.openLots(sharesContract("TESTV", "USD"))[0].openPrice = null;
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", quantity: -114 }, to: { ticker: "TESTP", quantity: 114 }, cash: null, ids: [] }, "USD");
    expect(book.openLots(sharesContract("TESTP", "USD"))[0].openPrice).toBeNull();
  });

  it("does nothing when the ledger never held the old contract", () => {
    const book = new LotBook();
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", quantity: -114 }, to: { ticker: "TESTP", quantity: 114 }, cash: null, ids: [] }, "USD");
    expect(book.allOpen()).toEqual([]);
  });
});
```

- [x] **Step 6 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/corporate.test.ts
```

Attendu : ÉCHEC, `applyConversion is not exported`.

- [x] **Step 7 : implémenter `applyConversion`**

Ajouter à `packages/ledger/src/journals/corporate.ts` :

```ts
import { type Lot, type LotBook } from "./book.ts";
import { sharesContract } from "./contract.ts";

/**
 * A split, a CUSIP change or a stock-for-stock merger is not a sale: the
 * position changes shape, the money does not move. Every open lot of the old
 * contract becomes a lot of the new one, scaled by the ratio, keeping its
 * basis (`openAmount`, `openCommission`) and its age. `openPrice` divides by
 * the ratio rather than being recomputed from `openAmount`, so it stays what
 * it is everywhere else in the engine: a trade price, commissions excluded.
 *
 * No journal row is emitted — a conversion is not an exit.
 */
export function applyConversion(book: LotBook, event: CorporateActionEvent, currency: string): void {
  const ratio = event.to.quantity / Math.abs(event.from.quantity);
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  book.move(sharesContract(event.from.ticker, currency), sharesContract(event.to.ticker, currency), (lot: Lot) => {
    lot.quantity *= ratio;
    lot.remaining *= ratio;
    if (lot.openPrice !== null) lot.openPrice /= ratio;
  });
}
```

> **Écart voulu, examiné en revue et accepté :** l'implémentation réelle enveloppe
> `event.from.ticker` dans `withoutOldSuffix(...)` avant de construire le contrat de départ
> (`book.move(sharesContract(withoutOldSuffix(event.from.ticker), currency), ...)`). La jambe
> sortante d'une opération porte toujours le suffixe `.OLD` qu'IB lui appose, jamais le ticker
> sous lequel la position a réellement été ouverte ; sans ce retrait, `applyConversion` ne
> trouve aucun lot à déplacer dès que l'appelant ne fournit pas de table d'identités. Voir le
> rapport de la tâche 7 (« Déviation 2 »).

- [x] **Step 8 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/corporate.test.ts
```

Attendu : 5 tests PASS de plus.

- [x] **Step 9 : écrire le test qui échoue — le rejeu de bout en bout**

Ajouter à `packages/ledger/src/journals/replay.test.ts` :

```ts
import { buildIdentities, NO_IDENTITIES } from "./identities.ts";

describe("buildJournals and corporate actions", () => {
  const CONVERSION = "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000)";

  function caLeg(symbol: string, quantity: number, when: string): Transaction {
    return {
      accountId: "test", externalId: `html:${symbol}${quantity}`, source: "statement_html",
      kind: "corporate_action", symbol, secType: "STK", right: "", strike: null, expiry: null,
      quantity, price: null, amount: 0, commission: null, currency: "USD", when,
      description: `${CONVERSION} (${symbol}, NAME, US0000000000)`,
    };
  }

  it("converts the position instead of leaving it stranded", () => {
    const report = buildJournals([
      stock("TESTV", 114, 9.85, "2022-09-06T13:30:00.000Z"),
      caLeg("TESTP", 114, "2022-09-21T20:25:00.000Z"),
      caLeg("TESTV.OLD", -114, "2022-09-21T20:25:00.000Z"),
      stock("TESTP", -114, 0.004, "2024-10-08T15:42:52.000Z"),
    ]);
    // One line, opened as TESTV, closed as TESTP. No ghost short.
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    expect(report.rows.map((r) => r.label)).toEqual(["TESTP"]);
  });

  it("applies the action before the trades of its own instant", () => {
    // A 1-for-30 split leaves 0.3333 of a share, sold as an ordinary trade at
    // the very instant of the split. Applied the other way round, that sale
    // would open a short.
    const report = buildJournals([
      stock("ZXAC", 1600, 0.661, "2023-08-02T13:30:04.000Z"),
      { ...caLeg("ZXAC", 53.3333, "2023-12-26T20:25:00.000Z"), description: "ZXAC(US0000000000) Split 1 for 30 (ZXAC, NAME, US1111111111)" },
      { ...caLeg("ZXAC.OLD", -1600, "2023-12-26T20:25:00.000Z"), description: "ZXAC(US0000000000) Split 1 for 30 (ZXAC.OLD, NAME, US0000000000)" },
      stock("ZXAC", -0.3333, 2.22, "2023-12-26T20:25:00.000Z"),
    ]);
    const [ongoing] = report.rows.filter((r) => r.ongoing);
    expect(ongoing.quantity).toBeCloseTo(53, 4);
    expect(report.rows.every((r) => r.kind !== "short_shares")).toBe(true);
  });

  it("renames a ticker the identities table says is the same contract", () => {
    const identities = buildIdentities([
      { conid: "1", secType: "STK", aliases: [
        { ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" },
        { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" },
      ] },
    ]);
    const report = buildJournals([
      stock("ZXAB", 220, 1.51, "2022-10-20T13:30:00.000Z"),
      stock("ZXABQ", -220, 0.029, "2023-05-26T15:50:21.000Z"),
    ], undefined, identities);
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    expect(report.rows.map((r) => r.label)).toEqual(["ZXABQ"]);
  });

  it("without identities, behaves exactly as it did: two contracts, two rows", () => {
    const transactions = [
      stock("ZXAB", 220, 1.51, "2022-10-20T13:30:00.000Z"),
      stock("ZXABQ", -220, 0.029, "2023-05-26T15:50:21.000Z"),
    ];
    expect(buildJournals(transactions)).toEqual(buildJournals(transactions, undefined, NO_IDENTITIES));
    expect(buildJournals(transactions).rows.filter((r) => r.ongoing)).toHaveLength(1);
  });
});
```

`stock(...)` est le helper de séquences déjà présent dans `packages/ledger/src/journals/fixtures.ts` ;
si sa signature diffère de `(ticker, quantity, price, when)`, utiliser celle du fichier plutôt
que de la changer.

- [x] **Step 10 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/replay.test.ts
```

Attendu : ÉCHEC — `buildJournals` ne prend que deux arguments, et la position TESTV reste ouverte.

- [x] **Step 11 : brancher le rejeu**

Dans `packages/ledger/src/journals/replay.ts`, remplacer l'en-tête de `buildJournals` :

```ts
/**
 * Rewrites the ticker of every stock transaction to its contract's canonical
 * name. Options are left alone: their `symbol` is the packed OCC one and no
 * option identity ever enters the resolution (`buildIdentities`).
 */
function canonicalize(transactions: readonly Transaction[], identities: ContractIdentities): Transaction[] {
  return transactions.map((tx) => {
    if (tx.secType !== "STK") return tx;
    const canonical = identities.canonical(tx.symbol, tx.when);
    return canonical === tx.symbol ? tx : { ...tx, symbol: canonical };
  });
}

export function buildJournals(
  transactions: readonly Transaction[],
  snapshot?: JournalSnapshot,
  identities: ContractIdentities = NO_IDENTITIES,
): JournalsReport {
  const named = canonicalize(sortTransactions(transactions), identities);
  const { events } = pairCorporateActions(named);
  const { transactions: sorted, ids } = mergeFills(named.filter(isReplayable));
  const ctx = newContext(ids);
  for (const tx of sorted) {
    if (tx.quantity !== null) continue;
    const key = `${contractId(contractOf(tx))}@${dayOf(tx.when)}`;
    const list = ctx.settlements.get(key);
    if (list) list.push(tx);
    else ctx.settlements.set(key, [tx]);
  }
  const boundary = snapshot ? boundaryOf(snapshot.asOf) : null;
  let atBoundary: Map<string, OpenPosition> | null = null;
  let nextEvent = 0;
  const applyDueEvents = (limit: string): void => {
    // Bounds included, and *before* the trades of the same instant: a split
    // that leaves a fraction has that fraction sold at the very instant of
    // the split, and the other order would open a short.
    while (nextEvent < events.length && events[nextEvent].when <= limit) {
      applyEvent(ctx, events[nextEvent++]);
    }
  };
  // Captures the book exactly as the snapshot's own instant saw it: events at
  // or before the boundary are part of that, events after it are not. Must
  // run strictly between "apply what is due up to the boundary" and "apply
  // what is due for this group" — never after the group's own events, or a
  // trade group that lands long after the boundary would sweep in every
  // event up to itself first and the capture would see the wrong book.
  const captureBoundary = (limit: string): void => {
    if (boundary === null || atBoundary !== null || limit <= boundary) return;
    applyDueEvents(boundary);
    atBoundary = ctx.book.positions();
  };
  for (const group of groupByWhen(sorted.filter((tx) => tx.quantity !== null))) {
    captureBoundary(group[0].when);
    applyDueEvents(group[0].when);
    replayGroup(group, ctx);
  }
  captureBoundary("9999-12-31T23:59:59.999Z");
  applyDueEvents("9999-12-31T23:59:59.999Z");
  if (boundary !== null && atBoundary === null) atBoundary = ctx.book.positions();
  finalize(ctx);
  const rows = sortRows(ctx.rows);
```

> **Correction post-revue (Tâche 7) :** le code ci-dessus corrige un défaut relevé en revue de
> branche sur une première version de cette boucle, où `atBoundary` n'était capturé qu'au
> premier groupe de transactions **après** la limite — de sorte que tous les événements dus
> entre la limite et ce groupe (potentiellement lointain dans le temps) étaient appliqués
> **avant** la capture, faisant fuiter leurs effets dans une réconciliation censée représenter
> l'instant du snapshot. `captureBoundary` capture désormais entre les deux balayages : les
> événements jusqu'à la limite incluse sont appliqués, la capture est prise, puis le reste
> continue. Le test qui aurait détecté le défaut vit dans `replay.test.ts` : « captures the
> snapshot boundary before events past it are applied ».

Le reste de la fonction est inchangé. Ajouter en tête de fichier :

```ts
import { applyConversion, pairCorporateActions, withoutOldSuffix, type CorporateActionEvent } from "./corporate.ts";
import { NO_IDENTITIES, type ContractIdentities } from "./identities.ts";
```

Et, sous `buildJournals`, l'aiguillage — pour l'instant la conversion seule, la fusion mixte
arrive en tâche 8 :

```ts
/** The currency of a corporate action, read from the lots it touches; USD when the book is empty. */
function currencyOf(ctx: ReplayContext, ticker: string): string {
  const lot = ctx.book.allOpen().find((l) => l.contract.ticker === ticker);
  return lot?.contract.currency ?? "USD";
}

function applyEvent(ctx: ReplayContext, event: CorporateActionEvent): void {
  applyConversion(ctx.book, event, currencyOf(ctx, withoutOldSuffix(event.from.ticker)));
}
```

> **Correction post-revue (Tâche 7) :** `withoutOldSuffix` (définie dans `corporate.ts`,
> voir Step 7) retire le suffixe `.OLD` qu'IB appose à la jambe sortante avant de chercher le
> lot dans le book — sans quoi `currencyOf` ne trouve jamais le lot réel et retombe
> silencieusement sur `"USD"`, une valeur fausse pour une position dans une autre devise.

- [x] **Step 12 : lancer tous les tests du moteur, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger test
```

Attendu : tous PASS. Le test « without identities, behaves exactly as it did » est celui qui
garde la contrainte globale : ne jamais le rendre conditionnel.

- [x] **Step 13 : commit**

```bash
git add packages/ledger/src/journals/book.ts packages/ledger/src/journals/book.test.ts \
        packages/ledger/src/journals/corporate.ts packages/ledger/src/journals/corporate.test.ts \
        packages/ledger/src/journals/replay.ts packages/ledger/src/journals/replay.test.ts \
        docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(ledger): une conversion déplace la position, elle ne la solde pas

Les lots de l'ancien contrat deviennent ceux du nouveau : quantité mise à
l'échelle, base et ancienneté conservées, aucune ligne de journal — une
conversion n'est pas une sortie. Appliquée avant les trades de son instant,
parce qu'un split laisse une miette vendue à cet instant-là.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 8 : rejouer une fusion mixte cash et titres

**Files:**
- Modify: `packages/ledger/src/journals/types.ts:20` (`CloseEvent`)
- Modify: `packages/ledger/src/journals/corporate.ts` (`applyMixedMerger`)
- Modify: `packages/ledger/src/journals/corporate.test.ts`
- Modify: `packages/ledger/src/journals/replay.ts` (`applyEvent`)
- Modify: `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: `CorporateActionEvent` avec son `cash` et ses `ids` (tâche 6), `LotBook.move` (tâche 7).
- Produces: `applyMixedMerger(ctx: ReplayContext, event: CorporateActionEvent, currency: string): void`, `CloseEvent` étendu de `"corporate_action"`.

**L'arithmétique, vérifiée sur la seule fusion mixte du corpus.** Aucune quantité n'est
« fermée » au sens ordinaire : les 120 titres partent en bloc contre du cash *et* des titres.
Ce qui se partage est la base.

```
base totale         1 501,00   = −(openAmount + openCommission) des lots ouverts
cash encaissé       1 290,40   = event.cash.amount
P/L réalisé           180,40   = event.cash.realizedPnl
base payée en cash  1 110,00   = amount − realizedPnl
f                   0,739507   = 1 110,00 / 1 501,00
base restante         391,00   = (1 − f) × 1 501,00, soit 64,08 × 6,1017
```

**Sans `realizedPnl`, rien n'est converti.** Une ligne importée avant la version 4 du schéma
rend `undefined`, un Flex qui ne donne pas `fifoPnlRealized` rend `null` : les deux cas
laissent l'événement de côté et produisent un `IdentityIssue` de code
`merger-basis-unknown`. Le comportement est alors exactement celui d'aujourd'hui — la
position reste ouverte et la carte de cohérence la signale — plutôt qu'un P/L inventé.

- [x] **Step 1 : étendre `CloseEvent`**

Dans `packages/ledger/src/journals/types.ts`, ligne 20 :

```ts
export type CloseEvent = "buyback" | "sold" | "expired" | "assigned" | "exercised" | "corporate_action";
```

Lancer `pnpm --filter @ib/ledger test` : rien ne casse, aucun `switch` n'est exhaustif sur ce
type. Si le typecheck signale un `switch` incomplet, l'étendre avec le libellé de la tâche 10.

- [x] **Step 2 : écrire le test qui échoue**

Ajouter à `packages/ledger/src/journals/corporate.test.ts` :

```ts
import { newContext } from "./context.ts";
import { applyMixedMerger } from "./corporate.ts";

describe("applyMixedMerger", () => {
  const ZXAE = sharesContract("TESTH", "USD");
  const ZQB = sharesContract("TESTC", "USD");

  function context() {
    const ctx = newContext();
    ctx.book.open(newLot({
      id: "l1",
      contract: ZXAE,
      strategy: "others",
      kind: "shares",
      openWhen: "2023-11-03T14:40:39.000Z",
      openPrice: 12.500,
      openAmount: -1500,
      openCommission: -1,
      quantity: 120,
      openIds: ["buy"],
    }));
    return ctx;
  }

  const EVENT = {
    when: "2023-12-28T20:25:00.000Z",
    from: { ticker: "TESTH", quantity: -120 },
    to: { ticker: "TESTC", quantity: 64.08 },
    cash: { amount: 1290.40, realizedPnl: 180.40 },
    ids: ["out", "in"],
  };

  it("reproduces IB's basis split to the cent", () => {
    const ctx = context();
    applyMixedMerger(ctx, EVENT, "USD");
    const [lot] = ctx.book.openLots(ZQB);
    expect(lot.remaining).toBe(64.08);
    expect(lot.openAmount).toBeCloseTo(-391, 6);
    expect(lot.openPrice).toBeCloseTo(6.1017, 3);
  });

  it("emits a closing row whose P/L is the one IB printed", () => {
    const ctx = context();
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.rows).toHaveLength(1);
    expect(ctx.rows[0].pnl).toBeCloseTo(180.40, 6);
    expect(ctx.rows[0].event).toBe("corporate_action");
    expect(ctx.rows[0].closeIds).toEqual(["out", "in"]);
    expect(ctx.rows[0].quantity).toBe(120);
  });

  it("closes the old contract entirely", () => {
    const ctx = context();
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.book.position(ZXAE)).toBe(0);
  });

  it("keeps the strategy and kind of the lots it converts", () => {
    const ctx = context();
    ctx.book.openLots(ZXAE)[0].strategy = "wheel";
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.book.openLots(ZQB)[0].strategy).toBe("wheel");
  });

  it("converts nothing and touches nothing without a realized P/L", () => {
    const ctx = context();
    applyMixedMerger(ctx, { ...EVENT, cash: { amount: 1290.40, realizedPnl: null } }, "USD");
    expect(ctx.book.position(ZXAE)).toBe(120);
    expect(ctx.book.openLots(ZQB)).toEqual([]);
    expect(ctx.rows).toEqual([]);
  });

  it("converts nothing when the ledger never held the old contract", () => {
    const ctx = newContext();
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.book.allOpen()).toEqual([]);
    expect(ctx.rows).toEqual([]);
  });
});
```

- [x] **Step 3 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/corporate.test.ts
```

Attendu : ÉCHEC, `applyMixedMerger is not exported`.

- [x] **Step 4 : implémenter `applyMixedMerger`**

Ajouter à `packages/ledger/src/journals/corporate.ts` :

```ts
import { newLot } from "./book.ts";
import { closeLot, uniqueId, type ReplayContext } from "./context.ts";

/** What a long lot really cost: cash out plus commission, as a positive number. */
function basisOf(lot: Lot): number {
  return -((lot.openAmount ?? 0) + (lot.openCommission ?? 0));
}

/**
 * A cash-and-stock merger pays part of the position in money and the rest in
 * shares of another company. Nothing is "closed" in the ordinary sense — the
 * whole position leaves at once — so what splits is the basis, not the
 * quantity:
 *
 *   f = (cash - realizedPnl) / total basis      the fraction paid in cash
 *   the lots keep f of their basis and close for `cash`  -> P/L = realizedPnl
 *   a new lot opens on the new contract with (1 - f) of the basis
 *
 * IB's own split comes from the new share's market price on the day, which no
 * source of ours reports; its printed realized P/L is the only way back to
 * it. Without that number nothing is converted: the position stays open and
 * the reconciliation card says so, which beats inventing a P/L.
 */
export function applyMixedMerger(ctx: ReplayContext, event: CorporateActionEvent, currency: string): void {
  const cash = event.cash;
  if (!cash || cash.realizedPnl === null || cash.realizedPnl === undefined) return;
  // IB relabels the outgoing leg "X.OLD"; the lots this merger is moving were
  // opened under the plain ticker (see withoutOldSuffix above).
  const from = sharesContract(withoutOldSuffix(event.from.ticker), currency);
  const lots = ctx.book.openLots(from);
  if (lots.length === 0) return;
  const totalBasis = lots.reduce((sum, lot) => sum + basisOf(lot), 0);
  if (totalBasis <= 0) return;
  const f = (cash.amount - cash.realizedPnl) / totalBasis;
  if (!Number.isFinite(f) || f < 0 || f > 1) return;

  const template = lots[0];
  const position = lots.reduce((sum, lot) => sum + lot.remaining, 0);

  // Scale each lot's basis down to the part the cash actually paid for,
  // *before* closing: the rows take their open side from these figures.
  for (const lot of lots) {
    const share = basisOf(lot) / totalBasis;
    if (lot.openAmount !== null) lot.openAmount *= f;
    if (lot.openCommission !== null) lot.openCommission *= f;
    if (lot.openPrice !== null) lot.openPrice *= f;
    // Closed lot by lot, not through `book.close`: that one walks the
    // contract FIFO and would pair a lot with another lot's share of the cash.
    const quantity = Math.abs(lot.remaining);
    lot.remaining = 0;
    closeLot(ctx, lot, quantity, {
      when: event.when,
      price: cash.amount / Math.abs(position),
      amount: cash.amount * share,
      commission: null,
      event: "corporate_action",
      closeIds: event.ids,
    });
  }

  ctx.book.open(newLot({
    id: uniqueId(ctx, `${event.ids[0]}:merger`),
    contract: sharesContract(event.to.ticker, currency),
    strategy: template.strategy,
    kind: template.kind,
    // The merger's own instant: unlike a conversion, this lot has a new basis
    // and a new cost, so dating it back to the old purchase would be a lie.
    openWhen: event.when,
    openPrice: ((1 - f) * totalBasis) / event.to.quantity,
    openAmount: -(1 - f) * totalBasis,
    openCommission: 0,
    quantity: event.to.quantity,
    openIds: event.ids,
  }));
}
```

- [x] **Step 5 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/corporate.test.ts
```

Attendu : 6 tests PASS de plus.

- [x] **Step 6 : aiguiller depuis le rejeu**

Dans `packages/ledger/src/journals/replay.ts`, remplacer `applyEvent` :

```ts
function applyEvent(ctx: ReplayContext, event: CorporateActionEvent): void {
  // withoutOldSuffix here too: the lots this action touches were opened
  // under the plain ticker, never IB's "X.OLD" relabelling of the outgoing leg.
  const currency = currencyOf(ctx, withoutOldSuffix(event.from.ticker));
  if (event.cash) applyMixedMerger(ctx, event, currency);
  else applyConversion(ctx.book, event, currency);
}
```

et l'import :

```ts
import { applyConversion, applyMixedMerger, pairCorporateActions, withoutOldSuffix, type CorporateActionEvent } from "./corporate.ts";
```

- [x] **Step 7 : écrire le test de bout en bout et le lancer**

Ajouter à `packages/ledger/src/journals/replay.test.ts`, dans le `describe` de la tâche 7 :

```ts
  it("replays a cash and stock merger end to end", () => {
    const MERGER = "TESTH(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923";
    const leg = (symbol: string, quantity: number, amount: number, realizedPnl: number | null): Transaction => ({
      accountId: "test", externalId: `html:${symbol}`, source: "statement_html", kind: "corporate_action",
      symbol, secType: "STK", right: "", strike: null, expiry: null, quantity, price: null, amount,
      commission: null, currency: "USD", when: "2023-12-28T20:25:00.000Z",
      description: `${MERGER} (${symbol}, NAME, CA0000000000)`, realizedPnl,
    });
    const report = buildJournals([
      stock({ ticker: "TESTH", quantity: 120, price: 12.500, when: "2023-11-03T14:40:39.000Z" }),
      leg("TESTC", 64.08, 0, 0),
      leg("TESTH", -120, 1290.40, 180.40),
      stock({ ticker: "TESTC", quantity: -64.08, price: 7.06, when: "2024-01-02T17:57:48.000Z" }),
    ]);
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    const merger = report.rows.find((r) => r.event === "corporate_action")!;
    expect(merger.pnl).toBeCloseTo(180.40, 6);
  });
```

```bash
pnpm --filter @ib/ledger test
```

Attendu : tous PASS.

- [x] **Step 8 : commit**

```bash
git add packages/ledger/src/journals/types.ts packages/ledger/src/journals/corporate.ts \
        packages/ledger/src/journals/corporate.test.ts packages/ledger/src/journals/replay.ts \
        packages/ledger/src/journals/replay.test.ts docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(ledger): une fusion mixte partage la base, pas la position

Les titres partent en bloc contre du cash et d'autres titres : ce qui se
scinde est la base de coût. La fraction payée en cash se lit dans le P/L
qu'IB imprime sur la ligne — sans lui rien n'est converti, la position reste
ouverte et la carte de cohérence le dit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 9 : le store `contracts`

**Files:**
- Modify: `apps/web/src/db/schema.ts` (`ContractRecord`, table, version 4)
- Modify: `apps/web/src/db/schema.test.ts`
- Create: `apps/web/src/db/contracts.ts`
- Create: `apps/web/src/db/contracts.test.ts`
- Modify: `apps/web/src/db/importFile.ts` (transaction d'import)
- Modify: `apps/web/src/db/importFile.test.ts`
- Modify: `apps/web/src/agent/sync.ts` (transaction de passe)
- Modify: `apps/web/src/agent/sync.test.ts`

**Interfaces:**
- Consumes: `ContractIdentity` (tâche 1), `IdentityInput`/`IdentityAlias` (tâche 5).
- Produces: `ContractRecord`, `mergeContractRecords(current, identities, period): ContractRecord[]`, `readIdentityInputs(db, accountId): Promise<IdentityInput[]>`.

**Pourquoi un store et pas des champs sur `Transaction`.** L'identité est un attribut du
contrat, pas de la transaction, et la liste d'alias n'a aucun sens sur une ligne. Corollaire :
aucune migration de `Transaction` pour l'identité — la version 4 n'ajoute qu'une table.

- [x] **Step 1 : écrire le test qui échoue — la fusion des enregistrements**

Créer `apps/web/src/db/contracts.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ContractIdentity } from "@ib/ib-parsers";
import { mergeContractRecords, type ContractRecord } from "./contracts";

const PERIOD = { start: "2023-01-01", end: "2023-12-31" };
const identity = (conid: string, tickers: string[], extra: Partial<ContractIdentity> = {}): ContractIdentity => ({
  conid, isin: "", secType: "STK", currency: "USD", description: "", tickers, ...extra,
});

describe("mergeContractRecords", () => {
  it("creates a record with one alias per ticker, dated by the import period", () => {
    const [record] = mergeContractRecords("beta", [], [identity("1", ["ZXAB"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record).toEqual({
      accountId: "beta",
      conid: "1",
      isin: "",
      secType: "STK",
      currency: "USD",
      description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }],
      updatedAt: "2026-09-09T10:00:00.000Z",
    });
  });

  it("widens an existing alias's window without ever moving it backwards", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const [record] = mergeContractRecords("beta", current, [identity("1", ["ZXAB"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record.aliases).toEqual([{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2023-12-31" }]);
  });

  it("appends a ticker the contract had never worn", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const [record] = mergeContractRecords("beta", current, [identity("1", ["ZXABQ"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record.aliases.map((a) => a.ticker)).toEqual(["ZXAB", "ZXABQ"]);
  });

  it("fills an ISIN the first sighting did not have", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAI", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const [record] = mergeContractRecords("beta", current, [identity("1", ["ZXAI"], { isin: "US0065000000" })], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record.isin).toBe("US0065000000");
  });

  it("leaves records of other contracts untouched", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "9", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "MQZA", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const records = mergeContractRecords("beta", current, [identity("1", ["ZXAB"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(records).toHaveLength(1);
    expect(records[0].conid).toBe("1");
  });

  it("dates an agent pass by its own day, not by a period it does not have", () => {
    const [record] = mergeContractRecords("beta", [], [identity("1", ["MQZA"])], null, "2026-09-09T10:00:00.000Z");
    expect(record.aliases[0]).toEqual({ ticker: "MQZA", firstSeen: "2026-09-09", lastSeen: "2026-09-09" });
  });
});
```

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter web exec vitest run src/db/contracts.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./contracts"`.

- [x] **Step 3 : implémenter `contracts.ts`**

Créer `apps/web/src/db/contracts.ts` :

```ts
import type { ContractIdentity } from "@ib/ib-parsers";
import type { IdentityInput } from "@ib/ledger";
import type { AppDatabase } from "./schema";

/** One IB contract of one account, and every ticker it has been seen under. */
export interface ContractRecord {
  accountId: string;
  conid: string;
  isin: string;
  secType: string;
  currency: string;
  description: string;
  /** Every spelling, with the window of import periods that showed it. */
  aliases: { ticker: string; firstSeen: string; lastSeen: string }[];
  updatedAt: string;
}

/**
 * Folds what a file or an agent pass just reported into the records already
 * held, and returns **only the records that changed** — the caller writes
 * exactly those. Windows only ever widen: importing an old statement after a
 * recent one must not make a contract look younger than it is.
 */
export function mergeContractRecords(
  accountId: string,
  current: readonly ContractRecord[],
  identities: readonly ContractIdentity[],
  period: { start: string; end: string } | null,
  at: string,
): ContractRecord[] {
  // An agent pass declares no period: its own day is the whole window.
  const day = at.slice(0, 10);
  const start = period?.start ?? day;
  const end = period?.end ?? day;
  const byConid = new Map(current.map((record) => [record.conid, record]));
  const touched = new Map<string, ContractRecord>();
  for (const identity of identities) {
    const existing = touched.get(identity.conid) ?? byConid.get(identity.conid);
    const record: ContractRecord = existing
      ? { ...existing, aliases: existing.aliases.map((alias) => ({ ...alias })) }
      : {
          accountId,
          conid: identity.conid,
          isin: identity.isin,
          secType: identity.secType,
          currency: identity.currency,
          description: identity.description,
          aliases: [],
          updatedAt: at,
        };
    record.isin ||= identity.isin;
    record.secType ||= identity.secType;
    record.currency ||= identity.currency;
    record.description ||= identity.description;
    record.updatedAt = at;
    for (const ticker of identity.tickers) {
      const alias = record.aliases.find((a) => a.ticker === ticker);
      if (!alias) record.aliases.push({ ticker, firstSeen: start, lastSeen: end });
      else {
        if (start < alias.firstSeen) alias.firstSeen = start;
        if (end > alias.lastSeen) alias.lastSeen = end;
      }
    }
    touched.set(identity.conid, record);
  }
  return [...touched.values()];
}

/** What `buildIdentities` needs, read from one account's store. */
export async function readIdentityInputs(db: AppDatabase, accountId: string): Promise<IdentityInput[]> {
  const records = await db.contracts.where("accountId").equals(accountId).toArray();
  return records.map((record) => ({ conid: record.conid, secType: record.secType, aliases: record.aliases }));
}
```

- [x] **Step 4 : ajouter la table au schéma**

Dans `apps/web/src/db/schema.ts` : importer `ContractRecord` depuis `./contracts`, l'ajouter
au type de la classe et déclarer la version 4.

```ts
  contracts!: Table<ContractRecord, [string, string]>;
```

et, après `this.version(3)` :

```ts
    // Additive: no existing row is rewritten, and `Transaction.realizedPnl`
    // stays absent on rows imported before this version.
    this.version(4).stores({
      contracts: "[accountId+conid], accountId",
    });
```

- [x] **Step 5 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter web exec vitest run src/db/contracts.test.ts
```

Attendu : 6 tests PASS.

- [x] **Step 6 : écrire le test qui échoue — l'import écrit le store**

Ajouter à `apps/web/src/db/importFile.test.ts` :

```ts
it("writes the contract identities of the file it imported", async () => {
  const account = await seedAccount();
  await importFile(db, account, fileOf(statementHtml, "statement.htm"));
  const records = await db.contracts.where("accountId").equals(account.id).toArray();
  expect(records.map((r) => r.conid).sort()).toEqual(["900000105", "900000106", "700000001"]);
  const quanergy = records.find((r) => r.conid === "900000106")!;
  expect(quanergy.aliases.map((a) => a.ticker)).toEqual(["ZXAB", "ZXABQ"]);
  expect(quanergy.aliases[0]).toMatchObject({ firstSeen: "2025-01-01", lastSeen: "2025-12-31" });
});

it("widens the window when the same statement is imported twice", async () => {
  const account = await seedAccount();
  await importFile(db, account, fileOf(statementHtml, "statement.htm"));
  await importFile(db, account, fileOf(statementHtml, "statement.htm"));
  const records = await db.contracts.where("accountId").equals(account.id).toArray();
  expect(records).toHaveLength(3);
});

it("rolls the contracts back with everything else when a later step of the transaction fails", async () => {
  // A parse failure returns before the transaction ever opens: it proves nothing about
  // rollback. Force a genuine in-transaction failure instead, after the contracts write —
  // `db.imports.add` is the block's last write — so `db.contracts.bulkPut` has already run
  // and must be undone along with the ledger rows.
  const account = await seedAccount();
  const spy = vi.spyOn(db.imports, "add").mockRejectedValueOnce(new Error("boom"));
  try {
    await expect(importFile(db, account, fileOf(statementHtml, "statement.htm"))).rejects.toThrow("boom");
  } finally {
    spy.mockRestore();
  }
  expect(await db.contracts.count()).toBe(0);
  expect(await db.transactions.count()).toBe(0);
});
```

Reprendre les helpers `seedAccount`, `fileOf` et la constante du HTML de test tels qu'ils sont
déjà nommés dans ce fichier ; ne pas en créer de nouveaux.

- [x] **Step 7 : brancher l'import**

Dans `apps/web/src/db/importFile.ts` : ajouter `db.contracts` à la liste des tables de
`db.transaction("rw", …)`, et à l'intérieur, après l'écriture du snapshot :

```ts
    const identities = "identities" in parsed ? parsed.identities : [];
    if (identities.length > 0) {
      const current = await db.contracts.where("accountId").equals(account.id).toArray();
      await db.contracts.bulkPut(mergeContractRecords(account.id, current, identities, period, at));
    }
```

- [x] **Step 8 : brancher la passe de l'agent**

Dans `apps/web/src/agent/sync.ts` : ajouter `deps.db.contracts` aux tables de la transaction,
et à l'intérieur :

```ts
      if (parsed.identities.length > 0) {
        const current = await deps.db.contracts.where("accountId").equals(account.id).toArray();
        await deps.db.contracts.bulkPut(mergeContractRecords(account.id, current, parsed.identities, null, at));
      }
```

Ajouter à `apps/web/src/agent/sync.test.ts` :

```ts
it("records the contracts a pass saw, dated by the day of the pass", async () => {
  await syncAgent(deps, account);
  const records = await db.contracts.where("accountId").equals(account.id).toArray();
  expect(records.length).toBeGreaterThan(0);
  expect(records[0].aliases[0].firstSeen).toBe(records[0].aliases[0].lastSeen);
});
```

- [x] **Step 9 : lancer les tests de l'application**

```bash
pnpm --filter web test
```

Attendu : tous PASS.

- [x] **Step 10 : commit**

```bash
git add apps/web/src/db/schema.ts apps/web/src/db/schema.test.ts \
        apps/web/src/db/contracts.ts apps/web/src/db/contracts.test.ts \
        apps/web/src/db/importFile.ts apps/web/src/db/importFile.test.ts \
        apps/web/src/agent/sync.ts apps/web/src/agent/sync.test.ts \
        docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(web): un store des contrats, alimenté par chaque import et chaque passe

L'identité est un attribut du contrat, pas de la transaction : la version 4 du
schéma n'ajoute qu'une table, aucune ligne existante n'est réécrite. Les
fenêtres d'alias ne font que s'élargir — importer un vieux relevé après un
récent ne doit pas rajeunir un contrat.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 10 : `useJournals`, carte Sources, libellés

**Files:**
- Modify: `apps/web/src/db/hooks.ts:72-79`
- Modify: `apps/web/src/db/hooks.test.tsx`
- Modify: `apps/web/src/pages/SourcesPage.tsx`
- Modify: `apps/web/src/pages/SourcesPage.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`

**Interfaces:**
- Consumes: `readIdentityInputs` (tâche 9), `buildIdentities`, `pairCorporateActions`, `IdentityIssue` (tâches 5-6), `buildJournals(…, identities)` (tâche 7).
- Produces: `useContractIdentities(accountId): ContractIdentities | undefined`, `JournalsView.report.reconciliation` inchangé, et `identityIssues` exposé par `useJournals`.

- [x] **Step 1 : écrire le test qui échoue — le hook**

Ajouter à `apps/web/src/db/hooks.test.tsx` :

```ts
it("resolves a renamed ticker so the journals show one position, not two", async () => {
  const account = await seedAccount();
  await db.transactions.bulkPut([
    tx({ accountId: account.id, symbol: "ZXAB", quantity: 220, price: 1.51, when: "2022-10-20T13:30:00.000Z" }),
    tx({ accountId: account.id, symbol: "ZXABQ", quantity: -220, price: 0.029, when: "2023-05-26T15:50:21.000Z" }),
  ]);
  await db.contracts.put({
    accountId: account.id, conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
    aliases: [
      { ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" },
      { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" },
    ],
    updatedAt: "2026-09-09T10:00:00.000Z",
  });

  const { result } = renderHook(() => useJournals(account.id), { wrapper });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  const view = result.current as { status: "ready"; report: JournalsReport };
  expect(view.report.rows.filter((r) => r.ongoing)).toEqual([]);
});

it("stays in loading until the contracts store has answered", async () => {
  const account = await seedAccount();
  const { result } = renderHook(() => useJournals(account.id), { wrapper });
  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("ready"));
});
```

Reprendre les helpers `seedAccount`, `tx` et `wrapper` déjà nommés dans ce fichier.

- [x] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter web exec vitest run src/db/hooks.test.tsx
```

Attendu : ÉCHEC — une ligne reste `ongoing`, `useJournals` ignorant le store.

- [x] **Step 3 : implémenter le hook**

Dans `apps/web/src/db/hooks.ts` :

```ts
/** The identity table of one account, ready for the replay; `undefined` while loading. */
export function useContractIdentities(accountId: string): IdentityInput[] | undefined {
  const db = useDb();
  return useLiveQuery(() => readIdentityInputs(db, accountId), [db, accountId]);
}

export type JournalsView =
  | { status: "loading" }
  | { status: "ready"; report: JournalsReport; identityIssues: IdentityIssue[] };

/** The journals of one account, recomputed from its ledger, snapshot and contracts; never stored. */
export function useJournals(accountId: string): JournalsView {
  const ledger = useLedger(accountId);
  const snapshot = useSnapshot(accountId);
  const inputs = useContractIdentities(accountId);
  return useMemo<JournalsView>(() => {
    if (ledger === undefined || snapshot === undefined || inputs === undefined) return { status: "loading" };
    // The events date the ambiguous tickers, and the same events are paired
    // again inside `buildJournals`: pairing is pure and cheap, and passing a
    // pre-built list in would make the engine's own input ambiguous.
    const { events, issues: actionIssues } = pairCorporateActions(ledger);
    const identities = buildIdentities(inputs, events);
    return {
      status: "ready",
      report: buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined, identities),
      identityIssues: [...identities.issues, ...actionIssues],
    };
  }, [ledger, snapshot, inputs]);
}
```

Ajouter les imports depuis `@ib/ledger` : `buildIdentities`, `pairCorporateActions`,
`type IdentityInput`, `type IdentityIssue` ; et `readIdentityInputs` depuis `./contracts`.

Adapter les consommateurs de `JournalsView` qui déstructurent le cas `ready` : `JournalPage`
et `StatsPage` ne lisent que `report`, l'ajout d'un champ ne les casse pas ; vérifier au
typecheck.

- [x] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
pnpm --filter web exec vitest run src/db/hooks.test.tsx
```

Attendu : PASS.

- [x] **Step 5 : écrire le test qui échoue — la carte Sources**

Ajouter à `apps/web/src/pages/SourcesPage.test.tsx` :

```ts
it("counts the contracts it knows and the aliases it resolved", async () => {
  const account = await seedAccount();
  await db.contracts.bulkPut([
    { accountId: account.id, conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }, { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }],
      updatedAt: "2026-09-09T10:00:00.000Z" },
  ]);
  renderSources(account.id);
  expect(await screen.findByText("1 contrat connu, 2 noms")).toBeInTheDocument();
});

it("lists what it could not settle, in plain words", async () => {
  const account = await seedAccount();
  await db.contracts.bulkPut([
    { accountId: account.id, conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAA", firstSeen: "2022-01-01", lastSeen: "2023-06-22" }], updatedAt: "2026-09-09T10:00:00.000Z" },
    { accountId: account.id, conid: "2", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAA", firstSeen: "2023-06-23", lastSeen: "2023-12-31" }], updatedAt: "2026-09-09T10:00:00.000Z" },
  ]);
  renderSources(account.id);
  expect(await screen.findByText(/ZXAA names 2 contracts/)).toBeInTheDocument();
});

it("says nothing alarming when the account has no contract at all", async () => {
  const account = await seedAccount();
  renderSources(account.id);
  expect(await screen.findByText("Aucun contrat identifié pour l'instant.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
```

Reprendre le helper de rendu déjà nommé dans ce fichier.

- [x] **Step 6 : implémenter la carte**

Dans `apps/web/src/pages/SourcesPage.tsx`, ajouter une carte « Identité des contrats » après
la carte Flex Query, sur le modèle des cartes existantes (même `Card`, même `CardHeader`,
même typographie). Elle affiche :

- le compte de contrats et d'alias, via `useContractIdentities` ;
- la liste des `identityIssues` de `useJournals`, un `<li>` par diagnostic, texte technique
  rendu tel quel ;
- deux phrases d'aide, toujours visibles : cocher `Conid` et `Security ID` sur la section
  Trades de la requête Flex n'agit que sur les tirages à venir ; ré-importer les relevés HTML
  est la seule façon d'obtenir Contract Information.

Aucune de ces situations n'est une erreur : pas de `role="alert"`, pas de couleur destructive.

- [x] **Step 7 : ajouter les libellés**

Dans `apps/web/src/i18n/fr.json` et `en.json`, ajouter la section de la carte. Cette app est en
i18next v23, dont la convention de pluriel est `_one`/`_other`, pas `_plural` (v20). En
français :

```json
    "contracts": {
      "title": "Identité des contrats",
      "known_one": "{{contracts}} contrat connu, {{aliases}} noms",
      "known_other": "{{contracts}} contrats connus, {{aliases}} noms",
      "empty": "Aucun contrat identifié pour l'instant.",
      "flexHint": "Cochez Conid et Security ID sur la section Trades de votre Flex Query : cela n'agit que sur les tirages à venir.",
      "statementHint": "Ré-importez vos relevés HTML : ils sont la seule source de la table Contract Information."
    }
```

En anglais, respectivement `"Contract identity"`,
`"{{contracts}} contract known, {{aliases}} names"` (`_one`),
`"{{contracts}} contracts known, {{aliases}} names"` (`_other`), `"No contract identified yet."`,
et les deux conseils traduits.

Il n'y a pas de libellé d'événement de sortie à ajouter : aucun `CloseEvent` (`buyback`,
`sold`, `expired`, `assigned`, `exercised`, `corporate_action`) n'a de consommateur dans
`apps/web` aujourd'hui — `JournalRow.event` n'est lu nulle part côté UI, seulement
`row.label` et le drapeau booléen `row.assigned` (colonne "Assigné", sans rapport). Ajouter
une section de libellés que rien n'affiche serait du code mort ; le vrai manque — une sortie
`corporate_action` indiscernable de tout autre closeEvent à l'écran — est du ressort de la
tâche 12 (`docs/points-reportes.md`), pas de celle-ci.

- [x] **Step 8 : lancer les tests et vérifier à l'écran**

```bash
pnpm --filter web test
pnpm check
```

Puis, depuis la racine du dépôt (pas du worktree — le skill se pilote depuis la racine) :

```
Utiliser le skill run-frontend avec --import sur les trois fichiers du corpus, puis capturer
/accounts/<compte>/sources et /accounts/<compte>/journals/others.
```

Attendu à l'écran : la carte « Identité des contrats » renseignée, et sur Journaux aucune
ligne `short_shares` fantôme sur les tickers convertis.

- [x] **Step 9 : commit**

```bash
git add apps/web/src/db/hooks.ts apps/web/src/db/hooks.test.tsx \
        apps/web/src/pages/SourcesPage.tsx apps/web/src/pages/SourcesPage.test.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/fr.json \
        docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
feat(web): les journaux lisent l'identité des contrats, Sources la rend visible

useJournals passe la table au moteur et remonte ce qu'elle n'a pas su
trancher. La carte le dit sans alarmer : ce ne sont pas des erreurs, ce sont
des informations manquantes, et elle explique comment les obtenir.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 11 : les oracles

**Files:**
- Create: `packages/ib-parsers/src/corpus.oracle.test.ts`
- Modify: `packages/ib-parsers/src/journals.private.test.ts` (une assertion de plus)
- Modify: `packages/ib-parsers/src/journals.oracle.test.ts` (une assertion de plus)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien. C'est la tâche qui prouve, pas celle qui livre.

C'est ici que se vérifie la contrainte globale du plan : **une source sans indice se comporte
exactement comme aujourd'hui**. Les trois oracles existants portent cette preuve ; le
quatrième est la raison d'être du sous-projet.

- [x] **Step 1 : le corpus rejoué contre ses propres Open Positions**

Créer `packages/ib-parsers/src/corpus.oracle.test.ts` :

```ts
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIdentities, buildJournals, pairCorporateActions, type IdentityInput } from "@ib/ledger";
import { mergeIdentities } from "./identity.ts";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const YEARS = ["2022", "2023", "2024"] as const;

/**
 * The Open Positions of a statement, read here and not in `statement.ts`: the
 * HTML parser deliberately produces no snapshot (positions come from Flex or
 * the agent, spec fondateur §2), and this oracle is the only consumer.
 * Deliberately naive — a fixture we generate ourselves needs no tolerance.
 */
function openStockPositions(html: string): Map<string, number> {
  const body = /id="tblOpenPositions_[^"]+Body"([\s\S]*?)<div[^>]*id="sec/.exec(html)?.[1] ?? "";
  const out = new Map<string, number>();
  let category = "";
  for (const row of body.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    if (/class="header-asset"/.test(row)) category = row.replace(/<[^>]+>/g, "").trim();
    if (/class="(subtotal|total)"/.test(row) || category !== "Stocks") continue;
    const cells = [...(row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [])].map((c) => c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (cells.length < 2 || cells[0] === "" || cells[0] === "Symbol") continue;
    const quantity = Number(cells[1].replace(/,/g, ""));
    if (!Number.isFinite(quantity)) continue;
    out.set(cells[0], (out.get(cells[0]) ?? 0) + quantity);
  }
  return out;
}

describe("the corporate-action corpus, replayed", () => {
  const files = YEARS.map((year) => readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8"));
  const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(files[0])![1];
  const parsed = files.map((html) => parseActivityStatement(html, { accountId: "corpus", ibAccountId }));
  const transactions = parsed.flatMap((p) => p.transactions);

  // Each alias's window is dated by the file(s) that actually showed it, the
  // shape `mergeContractRecords` stores in apps/web/src/db/contracts.ts (read
  // as a reference, never imported: packages/ib-parsers cannot depend on
  // apps/web). Two files can report the same ticker for the same conid; the
  // window only ever widens, never moves to an arbitrary file-order bound.
  const windowsByConid = new Map<string, Map<string, { firstSeen: string; lastSeen: string }>>();
  for (const p of parsed) {
    if (!p.statement) continue;
    const { periodStart: start, periodEnd: end } = p.statement;
    for (const identity of p.identities) {
      if (identity.conid === "") continue;
      const byTicker = windowsByConid.get(identity.conid) ?? new Map<string, { firstSeen: string; lastSeen: string }>();
      windowsByConid.set(identity.conid, byTicker);
      for (const ticker of identity.tickers) {
        const window = byTicker.get(ticker);
        if (!window) byTicker.set(ticker, { firstSeen: start, lastSeen: end });
        else {
          if (start < window.firstSeen) window.firstSeen = start;
          if (end > window.lastSeen) window.lastSeen = end;
        }
      }
    }
  }

  const inputs: IdentityInput[] = mergeIdentities(parsed.map((p) => p.identities)).map((identity) => ({
    conid: identity.conid,
    secType: identity.secType,
    aliases: identity.tickers.map((ticker) => ({ ticker, ...windowsByConid.get(identity.conid)!.get(ticker)! })),
  }));

  const { events } = pairCorporateActions(transactions);

  it("reconstructs the last statement's stock positions, share for share", () => {
    const report = buildJournals(transactions, undefined, buildIdentities(inputs, events));
    const ledger = new Map<string, number>();
    for (const row of report.rows) {
      if (!row.ongoing || row.kind !== "shares") continue;
      ledger.set(row.label, (ledger.get(row.label) ?? 0) + (row.quantity ?? 0));
    }
    const expected = openStockPositions(files[2]);
    for (const [ticker, quantity] of expected) {
      expect.soft(ledger.get(ticker) ?? 0).toBeCloseTo(quantity, 3);
    }
    for (const [ticker, quantity] of ledger) {
      if (!expected.has(ticker)) expect.soft(`${ticker}=${quantity}`).toBe("not held");
    }
  });

  it("opens not one ghost short on a converted ticker", () => {
    const report = buildJournals(transactions, undefined, buildIdentities(inputs, events));
    expect(report.rows.filter((r) => r.ongoing && r.kind === "short_shares")).toEqual([]);
  });

  it("dates the corpus's discriminating ambiguous ticker to two different names, and only when the linking event is supplied", () => {
    // A ticker two conids claim: exactly the shape `dateAmbiguous` exists to
    // resolve. Found from the fixtures, never hardcoded: the corpus is
    // anonymized and its tickers are not stable across a regeneration.
    const claims = new Map<string, Set<string>>();
    for (const input of inputs) {
      for (const alias of input.aliases) {
        const owners = claims.get(alias.ticker);
        if (owners) owners.add(input.conid);
        else claims.set(alias.ticker, new Set([input.conid]));
      }
    }
    const EARLY = "0001-01-01T00:00:00.000Z";
    const LATE = "9999-12-31T23:59:59.999Z";
    const withEvents = buildIdentities(inputs, events);
    // Not every ambiguous ticker of the corpus discriminates: some conid
    // pairs are structurally undated by `dateAmbiguous` regardless of
    // windowing (see the task report). Take the one the resolution actually
    // dates apart.
    const ambiguous = [...claims.entries()]
      .filter(([, conids]) => conids.size === 2)
      .map(([ticker]) => ticker)
      .find((ticker) => withEvents.canonical(ticker, EARLY) !== withEvents.canonical(ticker, LATE));
    expect(ambiguous).toBeDefined();

    const before = withEvents.canonical(ambiguous!, EARLY);
    const after = withEvents.canonical(ambiguous!, LATE);
    expect(before).not.toBe(after);

    // Without the linking event, nothing separates the two conids: the
    // ticker must resolve to the same name on both sides — exactly a source
    // that supplied no identity hint at all (global constraint of the plan).
    const withoutEvents = buildIdentities(inputs, []);
    expect(withoutEvents.canonical(ambiguous!, EARLY)).toBe(withoutEvents.canonical(ambiguous!, LATE));
  });
});
```

**Note sur les alias datés (mise à jour après revue).** La première version de ce fichier
construisait une seule fenêtre par identité fusionnée, datée par l'ordre du fichier — et les
deux premiers `it` passaient avec cette approximation, y compris sur le corpus qui contient
bel et bien plusieurs tickers ambigus (7, dont le ticker anonymisé lié par un `Split 1 for 8`
daté du fichier 2023). Ce que l'approximation ne montrait pas : `canonical()` rendait le
**même** nom avant et après la scission (`.OLD`-priority + égalité alphabétique dans
`canonicalOf`), que l'événement de liaison soit fourni ou non. Un rejeu identique dans les deux
branches passait les deux premiers `it` sans jamais exercer la désambiguïsation — l'échappatoire
de cette note ne s'est donc jamais déclenchée d'elle-même ; il a fallu un troisième `it`
qui compare explicitement `canonical(ticker, avant)` à `canonical(ticker, après)` pour le
révéler. D'où le code ci-dessus : les fenêtres sont maintenant construites comme
`mergeContractRecords` le fait (`apps/web/src/db/contracts.ts`, lu comme référence, jamais
importé) — une fenêtre par période de fichier (`statement.periodStart`/`periodEnd`),
fusionnée pour que `firstSeen` ne recule que et `lastSeen` n'avance que — et le troisième `it`
pin l'écart : deux noms différents avec l'événement réel, un seul sans lui. Sur les 7 tickers
ambigus du corpus, un seul discrimine sous ce schéma (le lien `.OLD`/scission dont l'autre
conid ne porte qu'un seul alias) ; les six autres restent structurellement non datables quel
que soit le fenêtrage — `canonicalOf` retombe sur le même nom des deux côtés. C'est une
propriété du corpus et du moteur, pas un défaut de cette tâche ; signalée au rapport pour que
la dette en soit tracée séparément.

- [x] **Step 2 : lancer l'oracle**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/corpus.oracle.test.ts
```

Attendu : PASS. Un écart est un bug du moteur, pas de l'oracle : le corriger dans les tâches
5 à 8, jamais en ajustant l'attendu.

- [x] **Step 3 : renforcer les trois oracles existants**

Dans `packages/ib-parsers/src/journals.private.test.ts`, ajouter à l'`it` existant :

```ts
    // The Flex of beta carries no conid on its trades and no corporate
    // action: the identity table is empty, so the report must be byte-for-byte
    // the one built without it (global constraint of sub-project 7).
    expect(report).toEqual(buildJournals(result.transactions, result.snapshot ?? undefined, NO_IDENTITIES));
```

Dans `packages/ib-parsers/src/journals.oracle.test.ts`, ajouter la même assertion sur le corpus
Flex versionné.

Dans `packages/ib-parsers/src/agent.test.ts`, ajouter :

```ts
it("the identities an agent pass carries change no journal line", () => {
  const parsed = parseAgentSnapshot(payload, "test");
  const inputs = parsed.identities.map((i) => ({ conid: i.conid, secType: i.secType, aliases: i.tickers.map((t) => ({ ticker: t, firstSeen: "2026-01-01", lastSeen: "2026-12-31" })) }));
  expect(buildJournals(parsed.transactions, undefined, buildIdentities(inputs))).toEqual(buildJournals(parsed.transactions));
});
```

- [x] **Step 4 : tout lancer**

```bash
pnpm check
pnpm --filter @ib/ib-parsers test
```

Attendu : PASS partout, `journals.private.test.ts` compris sur la machine qui a `private/`.

- [x] **Step 5 : commit**

```bash
git add packages/ib-parsers/src/corpus.oracle.test.ts \
        packages/ib-parsers/src/journals.private.test.ts \
        packages/ib-parsers/src/journals.oracle.test.ts \
        packages/ib-parsers/src/agent.test.ts docs/plans/2026-09-09-operations-sur-titres.md
git commit -m "$(cat <<'EOF'
test: le corpus se rejoue jusqu'aux positions, les trois oracles ne bougent pas

Le portefeuille reconstitué retrouve les Open Positions du dernier relevé, et
aucun short fantôme ne subsiste. Les trois oracles existants vérifient
l'autre moitié : sans indice d'identité, le moteur rend exactement ce qu'il
rendait.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

---

## Tâche 12 : bout en bout, documents, dette, revue, merge

**Files:**
- Create: `apps/web/e2e/corporate-actions.spec.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/points-reportes.md`
- Modify: `docs/specs/2026-09-03-architecture-design.md` (§3.2)
- Modify: `docs/specs/2026-09-09-operations-sur-titres-design.md` (statut)

- [x] **Step 1 : le test de bout en bout**

Créer `apps/web/e2e/corporate-actions.spec.ts`, sur le modèle des specs Playwright déjà
présentes dans `apps/web/e2e/` : créer un compte, importer les trois fichiers du corpus par le
sélecteur de fichiers de la page Sources, puis vérifier que

- la carte « Identité des contrats » affiche un compte de contrats non nul ;
- la page Journaux « Others » ne montre aucune ligne dont le libellé de type est
  « Actions vendues à découvert » pour un ticker converti ;
- la page Positions reste inchangée — elle lit le snapshot, pas le rejeu.

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm --filter web e2e
```

Attendu : PASS. Ce test ne fait partie ni de `pnpm check` ni de `pnpm test:api`.

- [x] **Step 2 : amender `CLAUDE.md`**

Dans « Règles qui mordent si on les oublie », ajouter :

```markdown
- **Les opérations sur titres sont appariées et rejouées, jamais stockées** : deux lignes
  `corporate_action` qui partagent leur instant et le nom de leur événement — la description
  privée du triplet `(TICKER, NOM, ISIN)` qui nomme la jambe — font une conversion. La base
  de coût est reportée, `openPrice` divisé par le ratio ; seule une fusion mixte consomme de
  la base, et seulement à hauteur de `proceeds − realizedPnl`.
- **Le `conid` est un indice d'équivalence, jamais une clé de contrat.** `contractId` reste
  sur le ticker ; l'identité sert seulement à choisir *quel* ticker. En faire une clé
  scinderait les lots d'un contrat vu une fois avec et une fois sans.
- **`Transaction.realizedPnl` n'est écrit que sur les lignes `corporate_action`** ; le moteur
  calcule lui-même le P/L des trades et ne doit jamais en importer une seconde version.
```

Dans le tableau des sous-projets, ajouter la ligne :

```markdown
| 7 | Opérations sur titres et identité de contrat | fait (2026-09-09) |
```

- [x] **Step 3 : amender `docs/points-reportes.md`**

Retirer, dans « Reporté par le sous-projet 5 », l'entrée « Les `corporate_action` (split,
fusion) ne sont pas rejouées ». Ajouter une section « Reporté par le sous-projet 7 » :

```markdown
- **La branche Flex du rejeu n'est vérifiée par aucune donnée réelle** : la section
  `CorporateActions` du Flex de beta est vide. Elle est écrite d'après le schéma
  (`type`, `fifoPnlRealized`, `conid`, `isin`) et couverte par des fixtures écrites à la
  main. À rejouer le jour où un Flex portera une opération sur titres.
- **L'ajustement d'un contrat d'option par un split n'est pas traité** : strike et
  multiplicateur modifiés, aucun cas dans le corpus mesuré, logique différente de celle
  d'une action.
- **Un split du sous-jacent ne renomme pas les options qui le suivent** : la canonicalisation
  ne touche que les transactions `STK`, parce que le `symbol` d'une option Flex est le
  symbole OCC empaqueté. Un call vendu sur un ticker renommé garderait l'ancien nom, et sa
  couverture en actions ne le retrouverait pas. Non observé dans le corpus.
- **Une opération sur titres antérieure au plus ancien relevé importé reste invisible**, et
  un compte qui n'importe que du Flex n'a ni Contract Information ni, pour ses trades
  antérieurs à la case cochée, de `conid` : les renommages sans événement y restent ouverts.
- **Le corpus HTML porte les quantités et les dates réelles du compte**, comme
  `flex_journals_corpus.xml` et pour la même raison — l'oracle est additif sur les
  quantités. À revoir avant publication du dépôt, avec l'entrée jumelle du sous-projet 5.
- **`mergeContractRecords` relit tous les contrats du compte à chaque import** : correct,
  et sans conséquence tant qu'un compte compte des dizaines de contrats et non des milliers.
- Et tout ce que la revue de branche du sous-projet 7 aura relevé.
```

- [x] **Step 4 : amender le spec fondateur**

Dans `docs/specs/2026-09-03-architecture-design.md` §3.2, à la liste des colonnes Flex,
ajouter une phrase : `Conid` et `Security ID` sur la section **Trades** sont **optionnels** ;
cochés, ils permettent de suivre un contrat à travers un changement de ticker, et leur absence
n'est jamais une erreur.

Dans `docs/specs/2026-09-09-operations-sur-titres-design.md`, passer la ligne de statut à
« implémenté (2026-09-09) ».

- [x] **Step 5 : vérification complète**

```bash
pnpm check
pnpm --filter @ib/ib-parsers test
pnpm --filter @ib/ledger test
pnpm --filter web test
```

Attendu : PASS partout. **Ne pas annoncer que c'est terminé avant d'avoir vu ces sorties** —
skill `superpowers:verification-before-completion`.

- [x] **Step 6 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche complète. Traiter les retours
avec `superpowers:receiving-code-review` : vérifier techniquement chaque remarque avant de
l'appliquer, et inscrire dans `docs/points-reportes.md` ce qui est délibérément reporté.

- [x] **Step 7 : commit et merge**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: sous-projet 7 livré, dette et règles à jour

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MHhGB3WPwkVovgTPs5pHDy
EOF
)"
```

Puis, revue propre, invoquer `superpowers:finishing-a-development-branch` pour merger
`operations-sur-titres` sur `main` et retirer le worktree.

---

## Ce qui est délibéré

À ne pas « corriger » en cours de route sans le décider explicitement.

- **`contractId` ne change pas.** Toute la résolution consiste à choisir quel ticker entre
  dans la clé, jamais à changer la clé. C'est ce qui garde les trois oracles verts.
- **La canonicalisation réécrit `symbol` sur les transactions `STK` seulement.** Enfiler
  `identities` dans `contractOf` toucherait une douzaine d'appels et un oubli serait une
  scission silencieuse de lots. Conséquence assumée, inscrite en dette : les options d'un
  sous-jacent renommé gardent l'ancien nom.
- **Une conversion n'émet aucune ligne de journal.** Ce n'est pas une sortie ; le lot garde
  son âge et ses identifiants d'ouverture. Seule la fusion mixte émet des lignes, parce
  qu'elle encaisse vraiment du cash.
- **`openPrice` se divise par le ratio** au lieu d'être recalculé depuis `openAmount` : il
  reste un prix hors commissions, comme partout ailleurs. L'écart avec le coût affiché par IB
  (11,0345 contre 11,0845 sur ZXAD) est exactement la commission, pas une erreur.
- **Le nouveau lot d'une fusion mixte est daté de la fusion**, pas de l'achat d'origine :
  contrairement à une conversion, il a une base neuve et un coût neuf.
- **Sans `realizedPnl`, une fusion mixte n'est pas rejouée du tout.** Position laissée
  ouverte, diagnostic explicite. Un P/L inventé serait pire que le trou d'aujourd'hui, qui au
  moins se voit.
- **Les quantités du corpus HTML restent réelles.** Même raisonnement que pour le corpus
  Flex : l'oracle de réconciliation est additif sur les quantités, et une fonction linéaire
  se divise toujours pour retrouver l'original.
- **La page Positions n'est pas touchée.** Elle lit le snapshot, qui vient d'IB déjà corrigé
  des opérations sur titres. Seul le rejeu avait besoin d'être réparé.
- **`reconcile` n'est pas touché.** Il compare des `contractId`, donc des tickers ; le
  snapshot porte le nom le plus récent et le canonique d'une classe est le plus récent aussi
  (règle 2). Les deux coïncident par construction, et un désaccord restant est ce qu'il a
  toujours été : une différence affichée dans la carte de cohérence.
- **Le cycle de types entre `corporate.ts` et `identities.ts` est voulu** : chacun importe un
  type de l'autre, en `import type` seulement, donc rien n'existe à l'exécution. Ne pas le
  « casser » en fusionnant les deux fichiers ou en créant un troisième module de types.
- **Aucun endpoint, aucun modèle, aucune migration côté `apps/api`.** Une tâche qui semble en
  réclamer un est un signal d'arrêt.
