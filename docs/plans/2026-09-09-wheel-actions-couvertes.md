# Sous-projet 8 — Le journal Wheel prend les actions qu'il couvre : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'un call vendu sur des actions déjà détenues soit de la wheel — le call *et* les actions —, que ces actions y entrent au strike du call pour que la plus-value d'avant-wheel n'y entre pas, et qu'une colonne « commentaire » dise pourquoi chaque ligne est dans le journal où elle est.

**Architecture:** Trois couches qui se posent l'une sur l'autre. (1) *La capacité* : `StrategyState.wheelCapacity` cesse d'exiger `assigned` et compte tous les lots d'actions longs, ce qui suffit à faire passer le call en wheel. (2) *La reprise* : un nouveau module `journals/takeover.ts` coupe le lot d'actions couvert, le clôt dans sa stratégie d'origine au strike (événement `integrated`) et le rouvre dans la wheel au strike, la part reprise gardant le rang du lot dans le carnet pour que FIFO livre les bonnes actions. (3) *Le commentaire* : un champ structuré `note` sur `JournalRow`, jamais du texte, traduit par l'application.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, Playwright. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-09-wheel-actions-couvertes-design.md` (lire aussi `docs/specs/2026-09-07-journaux-design.md` §3.4, §3.6 et §5 pour le moteur existant, et `CLAUDE.md`).

## Global Constraints

- **La classification se fait une fois, à la vente du call** (spec §1). Aucune tâche ne reclasse rétroactivement : un call vendu à nu reste nu même si des actions arrivent ensuite.
- **La reprise est au strike, jamais au coût réel** (spec §5). C'est la seule raison d'être de ce sous-projet : reprendre au coût réel ferait entrer dans la wheel la plus-value d'avant-wheel.
- **Les deux lignes de la reprise se compensent au centime** : `−strike × n` d'un côté, `+strike × n` de l'autre, sans commission. Aucune monnaie n'est inventée, la somme des P/L des quatre journaux reste égale au P/L réel du compte.
- **La part reprise garde le rang du lot dans le carnet** (spec §5). Si elle passait en fin de liste, une assignation vendrait FIFO les actions restées en « others » et le cycle wheel ne se refermerait jamais.
- **`packages/ledger` n'émet aucun texte visible.** `RowNote` porte un code et un libellé de contrat ; toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`.
- **`packages/ledger` ne dépend de rien** : ni `coverage`, ni `ib-parsers`. C'est pourquoi `DEFAULT_MULTIPLIER` descend dans `ledger` au lieu d'être importée de `coverage` (spec §3).
- **Constantes métier définies une seule fois.** Après la tâche 1, `DEFAULT_MULTIPLIER` n'est plus définie que dans `packages/ledger/src/constants.ts`.
- **`assigned` reste faux sur les actions reprises** : elles n'ont pas été livrées par une option, et la colonne ne sert qu'à dire ça.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ». Une ligne sans note rend une cellule **vide**, pas un tiret.
- **L'oracle des journaux ne vieillit pas tout seul** (spec §7). `STRATEGY_DISTRIBUTION` doit rester `{ wheel: 78, leaps: 55, condors: 4 }`. Si elle bouge, comprendre pourquoi avant de toucher à la constante.
- **Le serveur ne voit jamais** transactions, positions ni journaux. Aucun modèle, aucune migration côté `apps/api`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français. Libellés de contrats en anglais dans les deux langues.
- **Un test doit échouer si le comportement change.** `packages/ledger` compare des listes de lignes à l'identique ; `apps/web` teste sur `fake-indexeddb` avec une base semée, jamais en moquant les hooks.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WwvM2J1zkjrKh5Kq1LfgW6
  ```
- Le travail se fait dans un worktree `.claude/worktrees/wheel-actions-couvertes` (skill `superpowers:using-git-worktrees`), branche `wheel-actions-couvertes`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
packages/ledger/src/
  constants.ts (+ test)                   NOUVEAU  DEFAULT_MULTIPLIER
  index.ts                                        + export de constants.ts
  journals/
    types.ts                                      + RowNoteCode, RowNote,
                                                  JournalRow.note, CloseEvent "integrated"
    book.ts (+ test)                              + Lot.note, Exit.note, LotBook.insertAfter
    rows.ts (+ test)                              buildRow pose la note
    takeover.ts (+ test)                 NOUVEAU  sharesPerContract, coverableLots,
                                                  takeOverShares
    classify.ts (+ test)                          wheelCapacity compte tout, coveredCalls,
                                                  averageSharePrice, openSingle appelle
                                                  takeOverShares
    stats.ts (+ test)                             une ligne d'actions compte à sa sortie
    index.ts                                      + export de takeover.ts

packages/coverage/src/
  constants.ts (+ test)                           ré-exporte DEFAULT_MULTIPLIER

apps/web/src/
  lib/journalTone.ts (+ test)                     teinte d'une ligne d'actions wheel
  pages/JournalPage.tsx (+ test)                  colonne « Commentaire »
  i18n/fr.json, i18n/en.json                      columns.note, notes.*

docs/
  points-reportes.md                              quatre points reportés, un point levé
CLAUDE.md                                         sous-projet 8, règles de la wheel
```

## Commandes

Depuis la racine du worktree, sauf mention contraire.

```bash
pnpm install                                                              # une fois, à la création du worktree
pnpm --filter @ib/ledger test                                             # Vitest du moteur
pnpm --filter @ib/coverage test                                           # Vitest de la couverture
pnpm --filter web test                                                    # Vitest de l'application
pnpm --filter @ib/ib-parsers exec vitest run src/journals.oracle.test.ts  # l'oracle des journaux
pnpm --filter @ib/ledger exec vitest run src/journals/takeover.test.ts    # un fichier
pnpm check                                                                # lint + typecheck + tous les Vitest
```

`pnpm check` ne lance ni Python, ni Django, ni pytest, ni Playwright.

---

## Tâche 1 : worktree, l'oracle d'abord, `DEFAULT_MULTIPLIER` descend dans `ledger`

**Files:**
- Create: `packages/ledger/src/constants.ts`
- Modify: `packages/ledger/src/index.ts`, `packages/coverage/src/constants.ts:6-7`
- Test: `packages/coverage/src/constants.test.ts` (créer)

**Interfaces:**
- Consomme : rien.
- Produit : `DEFAULT_MULTIPLIER: 100` exporté par `@ib/ledger`, et toujours par `@ib/coverage`.

- [x] **Step 1 : créer le worktree**

Invoquer la skill `superpowers:using-git-worktrees` pour créer `.claude/worktrees/wheel-actions-couvertes` sur une branche `wheel-actions-couvertes` partant de `main`, puis :

```bash
cd .claude/worktrees/wheel-actions-couvertes
pnpm install
```

Toutes les commandes suivantes partent de ce répertoire.

- [x] **Step 2 : relever l'oracle avant de toucher à quoi que ce soit**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/journals.oracle.test.ts
```

Attendu : 6 tests verts. C'est la ligne de base ; à la tâche 8 elle devra être exactement la même. Noter la sortie dans le message de commit de cette tâche.

- [x] **Step 3 : écrire `packages/ledger/src/constants.ts`**

```ts
/**
 * Shares per option contract when nothing observed says otherwise.
 *
 * Lives here, in the lowest layer, rather than in `@ib/coverage` with the other
 * business constants: the journals engine needs it to convert a call count into
 * a share count, and `coverage` already depends on `ledger`, so importing it the
 * other way round would be a cycle. `coverage` re-exports it, and it is still
 * defined exactly once.
 *
 * A lot delivered by an assignment carries the ratio the delivery itself showed
 * (`Lot.ratio`); a lot bought on the market has no delivery to read.
 */
export const DEFAULT_MULTIPLIER = 100;
```

- [x] **Step 4 : l'exporter depuis `packages/ledger/src/index.ts`**

Ajouter la ligne, juste après `export * from "./types.ts";` :

```ts
export * from "./constants.ts";
```

- [x] **Step 5 : écrire le test qui garde l'unicité de la définition**

Créer `packages/coverage/src/constants.test.ts` :

```ts
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MULTIPLIER as fromLedger } from "@ib/ledger";
import { BUYBACK_RATIO, DEFAULT_MULTIPLIER, MAX_STRUCTURE_LOSS } from "./constants.ts";

describe("business constants", () => {
  it("keeps the coverage engine's own constants here", () => {
    expect(BUYBACK_RATIO).toBe(2);
    expect(MAX_STRUCTURE_LOSS).toBe(1000);
  });

  it("takes the multiplier from the layer below instead of redefining it", () => {
    expect(DEFAULT_MULTIPLIER).toBe(fromLedger);
    const source = readFileSync(new URL("./constants.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/DEFAULT_MULTIPLIER\s*=/);
  });
});
```

- [x] **Step 6 : lancer le test, vérifier qu'il échoue**

```bash
pnpm --filter @ib/coverage exec vitest run src/constants.test.ts
```

Attendu : ÉCHEC sur `expect(source).not.toMatch(/DEFAULT_MULTIPLIER\s*=/)`, la constante étant encore définie dans `coverage`.

- [x] **Step 7 : ré-exporter depuis `coverage`**

Dans `packages/coverage/src/constants.ts`, remplacer

```ts
/** Options multiplier when the contract does not report one. */
export const DEFAULT_MULTIPLIER = 100;
```

par

```ts
/**
 * Options multiplier when the contract does not report one. Defined in
 * `@ib/ledger`: the journals engine needs the same number and cannot import
 * this package without making a cycle.
 */
export { DEFAULT_MULTIPLIER } from "@ib/ledger";
```

- [x] **Step 8 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @ib/coverage test
pnpm --filter @ib/ledger test
pnpm --filter web test
```

Attendu : tout vert. `apps/web/src/lib/businessConstants.test.ts` ne scanne qu'`apps/web/src` et reste vrai tel quel.

- [x] **Step 9 : commit**

```bash
git add packages/ledger/src/constants.ts packages/ledger/src/index.ts \
        packages/coverage/src/constants.ts packages/coverage/src/constants.test.ts \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
refactor(ledger): DEFAULT_MULTIPLIER descend d'un étage

Le moteur de journaux doit convertir un nombre de calls en nombre
d'actions pour compter les actions achetées dans la capacité Wheel, et
`coverage` dépend de `ledger` : l'importer dans l'autre sens serait un
cycle. La constante descend donc dans `ledger` et `coverage` la
ré-exporte. Toujours une seule définition, et un test le vérifie sur la
source elle-même.

Oracle des journaux relevé avant toute modification : 6 tests verts,
distribution { wheel: 78, leaps: 55, condors: 4 }.
```

---

## Tâche 2 : `RowNote`, le champ `note`, les deux notes déduites

**Files:**
- Modify: `packages/ledger/src/journals/types.ts`, `packages/ledger/src/journals/book.ts`, `packages/ledger/src/journals/rows.ts`
- Test: `packages/ledger/src/journals/rows.test.ts`

**Interfaces:**
- Consomme : rien de la tâche 1.
- Produit :
  - `type RowNoteCode = "takenOverAtStrike" | "handedToWheel" | "nakedCall" | "truncatedHistory"`
  - `interface RowNote { code: RowNoteCode; contract?: string }`
  - `JournalRow.note: RowNote | null`, `Lot.note: RowNote | null`, `Exit.note?: RowNote`
  - `CloseEvent` gagne `"integrated"`

- [x] **Step 1 : écrire les tests qui échouent**

Ajouter à la fin de `packages/ledger/src/journals/rows.test.ts` :

```ts
const CALL = { ticker: "NVDA", secType: "OPT", right: "C" as const, strike: 150, expiry: "2026-08-21", currency: "USD" };
const SHARES = { ticker: "NVDA", secType: "STK", right: "" as const, strike: null, expiry: null, currency: "USD" };
const CONTRACT = "NVDA Aug21'26 150 Call";

describe("buildRow — la note", () => {
  it("reads a naked short call off the line itself", () => {
    const naked = newLot({
      id: "n", contract: CALL, strategy: "others", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0.5, openAmount: 50, openCommission: -1, quantity: -1, openIds: ["n"],
    });
    expect(buildRow(naked, 1, null).note).toEqual({ code: "nakedCall" });
  });

  it("says truncated history on an orphan, even when the line is also a naked call", () => {
    const orphan = newLot({
      id: "o", contract: CALL, strategy: "others", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0, openAmount: 0, openCommission: null, quantity: -1, openIds: ["o"], orphan: true,
    });
    expect(buildRow(orphan, 1, null).note).toEqual({ code: "truncatedHistory" });
  });

  it("leaves a covered call and an ordinary lot without a note", () => {
    const covered = newLot({
      id: "c", contract: CALL, strategy: "wheel", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0.5, openAmount: 50, openCommission: -1, quantity: -1, openIds: ["c"], cover: "shares",
    });
    expect(buildRow(covered, 1, null).note).toBeNull();
    expect(buildRow(PUT_LOT(), 4, null).note).toBeNull();
  });

  it("prefers the exit's note, then the lot's, over anything it could deduce", () => {
    const held = newLot({
      id: "h", contract: SHARES, strategy: "wheel", kind: "shares", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 150, openAmount: -15000, openCommission: 0, quantity: 100, openIds: ["h"],
      note: { code: "takenOverAtStrike", contract: CONTRACT },
    });
    expect(buildRow(held, 100, null).note).toEqual({ code: "takenOverAtStrike", contract: CONTRACT });
    expect(
      buildRow(held, 100, {
        when: "2026-08-21T20:00:00.000Z", price: 150, amount: 15000, commission: 0,
        event: "integrated", closeIds: ["x"], note: { code: "handedToWheel", contract: CONTRACT },
      }).note,
    ).toEqual({ code: "handedToWheel", contract: CONTRACT });
  });
});
```

Le fichier importe déjà `newLot` et `buildRow` ; ces tests n'ajoutent aucun import.

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/rows.test.ts
```

Attendu : ÉCHEC à la compilation — `note` n'existe ni sur `LotInit`, ni sur `Exit`, ni sur `JournalRow`.

- [x] **Step 3 : déclarer les types dans `journals/types.ts`**

Remplacer la ligne `export type CloseEvent = …` par :

```ts
export type CloseEvent = "buyback" | "sold" | "expired" | "assigned" | "exercised" | "corporate_action" | "integrated";
```

et ajouter, juste après :

```ts
export const ROW_NOTE_CODES = ["takenOverAtStrike", "handedToWheel", "nakedCall", "truncatedHistory"] as const;
export type RowNoteCode = (typeof ROW_NOTE_CODES)[number];

/**
 * Why a line sits in the journal it sits in. The engine never writes prose: the
 * application translates `code` and interpolates `contract`, which is already
 * language-neutral (`formatContractLabel` writes English in both languages).
 */
export interface RowNote {
  code: RowNoteCode;
  /** Label of the contract the note names, when it names one. */
  contract?: string;
}
```

Ajouter enfin, dans `JournalRow`, juste après `orphan`:

```ts
  /** Why this line is in this journal; `null` when the line speaks for itself. */
  note: RowNote | null;
```

- [x] **Step 4 : porter le champ sur `Lot` et `Exit` dans `journals/book.ts`**

Dans `Exit`, ajouter :

```ts
  /** Set when the exit itself is what needs explaining, like a Wheel takeover. */
  note?: RowNote;
```

Dans `Lot`, juste après `label`, ajouter :

```ts
  /** Why the lot is in its strategy; `null` when nothing needs saying. */
  note: RowNote | null;
```

Ajouter `"note"` à la liste `Partial<Pick<Lot, …>>` de `LotInit`, et `note: null,` aux valeurs par défaut de `newLot`. Importer `RowNote` depuis `./types.ts`.

- [x] **Step 5 : poser la note dans `journals/rows.ts`**

Ajouter, avant `buildRow` :

```ts
/**
 * Why this line is where it is. What the engine knew explicitly wins — a Wheel
 * takeover names the call that caused it, and only the engine saw that call —
 * and the rest is read off the line. A condor leg is never annotated: its own
 * strategy lives on the composite.
 */
function noteOf(lot: Lot, exit: Exit | null): RowNote | null {
  if (exit?.note) return exit.note;
  if (lot.note) return lot.note;
  if (lot.parent) return null;
  if (lot.orphan) return { code: "truncatedHistory" };
  if (lot.kind === "short_call" && lot.cover === null && lot.strategy === "others") return { code: "nakedCall" };
  return null;
}
```

et, dans l'objet rendu par `buildRow`, juste après `orphan: lot.orphan,` :

```ts
    note: noteOf(lot, exit),
```

Importer `type RowNote` depuis `./types.ts`.

- [x] **Step 6 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger test
```

Attendu : tout vert. Les autres fichiers de test comparent les lignes avec `toMatchObject`, jamais avec `toEqual` sur la ligne entière : un champ de plus ne les casse pas. Si l'un d'eux casse, c'est qu'il compare une ligne entière — ajouter `note: null` à son attendu.

- [x] **Step 7 : vérifier que `condorRows` et `settlementRow` compilent**

```bash
pnpm --filter @ib/ledger exec tsc --noEmit -p tsconfig.json
```

Attendu : `settlementRow` (`journals/replay.ts`) construit un `JournalRow` littéral et manque maintenant `note`. Y ajouter :

```ts
    note: { code: "truncatedHistory" },
```

— une ligne de règlement sans clôture à prix 0 est déjà `orphan: true`, la note dit la même chose que le drapeau.

Relancer `tsc`, puis :

```bash
pnpm --filter @ib/ledger test
```

Attendu : tout vert.

- [x] **Step 8 : commit**

```bash
git add packages/ledger/src/journals/types.ts packages/ledger/src/journals/book.ts \
        packages/ledger/src/journals/rows.ts packages/ledger/src/journals/rows.test.ts \
        packages/ledger/src/journals/replay.ts docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
feat(ledger): une ligne de journal dit pourquoi elle est là

`JournalRow.note` porte un code et le libellé du contrat en cause, jamais
une phrase : le moteur n'écrit pas de texte visible. Deux codes se
déduisent de la ligne elle-même — un call nu, un lot orphelin —, deux
autres viendront du lot et de la sortie quand la wheel reprendra des
actions. `CloseEvent` gagne `integrated`, la première valeur qui ne
vient d'aucune transaction.
```

---

## Tâche 3 : `LotBook.insertAfter`

**Files:**
- Modify: `packages/ledger/src/journals/book.ts`
- Test: `packages/ledger/src/journals/book.test.ts`

**Interfaces:**
- Consomme : `Lot.note` de la tâche 2.
- Produit : `LotBook.insertAfter(lot: Lot, lots: readonly Lot[]): void`

- [x] **Step 1 : écrire les tests qui échouent**

Ajouter à `packages/ledger/src/journals/book.test.ts` :

```ts
describe("LotBook.insertAfter", () => {
  const SHARES = sharesContract("MQZA", "USD");

  function shareLot(id: string, quantity: number) {
    return newLot({
      id, contract: SHARES, strategy: "others", kind: "shares", openWhen: "2024-01-02T14:30:00.000Z",
      openPrice: 10, openAmount: -10 * quantity, openCommission: -1, quantity, openIds: [id],
    });
  }

  it("puts the new lots at the rank of the lot they were cut from, not at the end", () => {
    const book = new LotBook();
    const older = shareLot("older", 100);
    const newer = shareLot("newer", 300);
    book.open(older);
    book.open(newer);
    const taken = newLot({ ...shareLot("taken", 100), strategy: "wheel" });
    older.remaining = 0;
    book.insertAfter(older, [taken]);
    // FIFO must reach the taken-over shares before the untouched lot that follows.
    expect(book.openLots(SHARES).map((l) => l.id)).toEqual(["taken", "newer"]);
    expect(book.close(SHARES, -100)).toEqual([{ lot: taken, quantity: 100 }]);
  });

  it("keeps the order of the lots it is given", () => {
    const book = new LotBook();
    const source = shareLot("source", 300);
    book.open(source);
    const taken = newLot({ ...shareLot("taken", 100), strategy: "wheel" });
    const rest = shareLot("rest", 200);
    source.remaining = 0;
    book.insertAfter(source, [taken, rest]);
    expect(book.openLots(SHARES).map((l) => l.id)).toEqual(["taken", "rest"]);
  });

  it("refuses a lot the book never held", () => {
    const book = new LotBook();
    expect(() => book.insertAfter(shareLot("ghost", 100), [])).toThrow(/ghost/);
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/book.test.ts
```

Attendu : ÉCHEC — `book.insertAfter is not a function`.

- [x] **Step 3 : écrire `insertAfter`**

Dans `LotBook`, juste après `insertByOpenWhen` :

```ts
  /**
   * Puts `lots` immediately after `lot` in its contract's list. That list *is*
   * FIFO order — `close` walks it from the front — so a lot cut out of another
   * must take that other's rank rather than the end of the queue: the shares a
   * covered call took over have to be reached before the untouched remainder
   * they were cut from, or an assignment would deliver the wrong ones and the
   * Wheel cycle would never close.
   *
   * Unlike `insertByOpenWhen`, which sorts on `openWhen`, this one places by
   * rank: the lots it inserts carry the instant of the takeover, which is
   * *later* than the lot they follow, and sorting would send them to the back.
   */
  insertAfter(lot: Lot, lots: readonly Lot[]): void {
    const list = this.lots.get(contractId(lot.contract));
    const at = list ? list.indexOf(lot) : -1;
    if (!list || at < 0) throw new Error(`insertAfter: lot ${lot.id} is not in the book`);
    list.splice(at + 1, 0, ...lots);
  }
```

- [x] **Step 4 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger test
```

Attendu : tout vert.

- [x] **Step 5 : commit**

```bash
git add packages/ledger/src/journals/book.ts packages/ledger/src/journals/book.test.ts \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
feat(ledger): insérer un lot au rang d'un autre dans le carnet

`insertByOpenWhen` trie sur l'instant, ce qui convient à une opération
sur titres. La reprise d'actions par la wheel a besoin du contraire :
placer au rang, parce que la part reprise porte l'instant du call, donc
un instant postérieur au lot qu'elle doit précéder. Sans ça une
assignation livrerait FIFO les actions restées en « others ».
```

---

## Tâche 4 : la capacité Wheel compte les actions achetées

**Files:**
- Create: `packages/ledger/src/journals/takeover.ts`
- Modify: `packages/ledger/src/journals/classify.ts:38-72,105-120`, `packages/ledger/src/journals/index.ts`
- Test: `packages/ledger/src/journals/classify.test.ts:77-84`

**Interfaces:**
- Consomme : `DEFAULT_MULTIPLIER` (tâche 1).
- Produit, dans le nouveau `journals/takeover.ts` :
  - `sharesPerContract(lot: Lot): number`
  - `coverableLots(book: LotBook, shares: ContractKey): Lot[]`
- Produit, sur `StrategyState` :
  - `wheelCapacity(contract: ContractKey): number` — inchangée de signature, élargie de sens
  - `coveredCalls(contract: ContractKey): number` — contrats déjà adossés à ces actions
  - `averageSharePrice(contract: ContractKey): number | null` — remplace `averageAssignmentPrice`

Le module naît ici avec ses deux fonctions de lecture, et la tâche 5 y ajoute la reprise
elle-même : `classify.ts` importera `takeover.ts`, jamais l'inverse.

- [x] **Step 1 : réécrire le test qui épingle le comportement inverse**

Dans `packages/ledger/src/journals/classify.test.ts`, remplacer intégralement le test « puts a naked call in Others, and a call covered by shares bought on the market too » par :

```ts
  it("puts a naked call in Others, but a call sold on shares bought on the market in Wheel", () => {
    const report = buildJournals([
      option({ ...CALL, quantity: -1, price: 0.5, when: D1 }),
      stock({ ticker: "ZZZ", quantity: 100, price: 10, when: D1 }),
      option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 }),
    ]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:-1" });
    expect(placed(report, "flex:trade:3")).toEqual({ "flex:trade:3#1": "wheel:-1" });
  });

  it("counts only whole contracts, and never counts short shares as a cover", () => {
    const short = buildJournals([
      stock({ ticker: "ZZZ", quantity: -100, price: 10, when: D1 }),
      option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 }),
    ]);
    expect(placed(short, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
    resetIds();
    const odd = buildJournals([
      stock({ ticker: "ZZZ", quantity: 99, price: 10, when: D1 }),
      option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 }),
    ]);
    expect(placed(odd, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
  });
```

- [x] **Step 2 : lancer les tests, vérifier que le premier échoue**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/classify.test.ts
```

Attendu : ÉCHEC sur « puts a naked call in Others, but a call sold on shares bought on the market in Wheel » — reçu `others:-1`, attendu `wheel:-1`. Le second test passe déjà.

- [x] **Step 3 : créer `journals/takeover.ts` avec ses deux fonctions de lecture**

```ts
import type { Lot, LotBook } from "./book.ts";
import type { ContractKey } from "./contract.ts";
import { DEFAULT_MULTIPLIER } from "../constants.ts";

/** Shares per contract for a lot: what its delivery showed, or the standard contract. */
export function sharesPerContract(lot: Lot): number {
  return lot.ratio !== null && lot.ratio > 0 ? lot.ratio : DEFAULT_MULTIPLIER;
}

/**
 * Long share lots of one underlying, in book order — which is FIFO order: what
 * a call sold on it can cover. Assignment is no longer the test (spec §3) — a
 * call sold on shares bought on the market is a covered call like any other —
 * so the only conditions left are being long, being shares, and being this
 * contract.
 */
export function coverableLots(book: LotBook, shares: ContractKey): Lot[] {
  return book.openLots(shares).filter((lot) => lot.kind === "shares" && lot.remaining > 0);
}
```

Puis l'exporter, dans `packages/ledger/src/journals/index.ts` :

```ts
export * from "./takeover.ts";
```

- [x] **Step 4 : élargir `StrategyState` dans `journals/classify.ts`**

Ajouter les imports :

```ts
import { coverableLots, sharesPerContract } from "./takeover.ts";
```

et `sharesContract` à l'import existant depuis `./contract.ts`.

Remplacer `wheelCapacity` et `averageAssignmentPrice` par :

```ts
  /** The long share lots this underlying's calls can be written on. */
  private coverable(contract: ContractKey): Lot[] {
    return coverableLots(this.book, sharesContract(contract.ticker, contract.currency));
  }

  /** Contracts already backed by these shares through the covered calls still open. */
  coveredCalls(contract: ContractKey): number {
    return this.lotsOf(contract)
      .filter((lot) => lot.kind === "short_call" && lot.cover === "shares")
      .reduce((n, lot) => n + Math.abs(lot.remaining), 0);
  }

  /** Shares held in contract-equivalents, whole contracts only, minus the short calls they already cover. */
  wheelCapacity(contract: ContractKey): number {
    const shares = this.coverable(contract).reduce((n, lot) => n + lot.remaining / sharesPerContract(lot), 0);
    return Math.max(0, Math.floor(shares) - this.coveredCalls(contract));
  }

  /**
   * Weighted by what is still held, each lot at its current basis: the strike
   * for shares the Wheel has already taken over, the purchase price for shares
   * it has not. `null` when nothing is held.
   */
  averageSharePrice(contract: ContractKey): number | null {
    const lots = this.coverable(contract).filter((lot) => lot.openPrice !== null);
    const quantity = lots.reduce((n, lot) => n + lot.remaining, 0);
    if (quantity === 0) return null;
    return lots.reduce((n, lot) => n + (lot.openPrice ?? 0) * lot.remaining, 0) / quantity;
  }
```

- [x] **Step 5 : brancher `averageSharePrice` dans `openSingle`**

Dans `openSingle`, remplacer `state.averageAssignmentPrice(contract)` par `state.averageSharePrice(contract)`.

- [x] **Step 6 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger test
```

Attendu : tout vert. Les tests « covered calls » existants n'utilisent que des actions assignées et ne bougent pas.

- [x] **Step 7 : vérifier l'oracle**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/journals.oracle.test.ts
```

Attendu : 6 tests verts, `STRATEGY_DISTRIBUTION` toujours `{ wheel: 78, leaps: 55, condors: 4 }`. Le corpus beta n'a aucune ligne en « others », donc aucun lot d'actions non assigné, donc rien à déplacer. **Si la distribution bouge, s'arrêter** : le corpus contient un cas que le spec a manqué, et il faut le comprendre avant d'aller plus loin.

- [x] **Step 8 : commit**

```bash
git add packages/ledger/src/journals/takeover.ts packages/ledger/src/journals/index.ts \
        packages/ledger/src/journals/classify.ts packages/ledger/src/journals/classify.test.ts \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
feat(ledger): un call vendu sur des actions détenues est un call couvert

La capacité Wheel n'exigeait que des actions assignées : sur un compte
réel, 90 lignes `short_call` tombaient en « others » comme des calls
nus alors qu'elles étaient couvertes par des actions achetées au marché.
Elle compte désormais tous les lots d'actions longs, en contrats
entiers, et l'arbitrage wheel-d'abord contre LEAPS-d'abord se fait sur
le prix moyen de ces actions à leur base courante.

Les actions elles-mêmes n'entrent pas encore dans la wheel : c'est
l'objet du commit suivant.
```

---

## Tâche 5 : la reprise au strike

**Files:**
- Create: `packages/ledger/src/journals/takeover.test.ts`
- Modify: `packages/ledger/src/journals/takeover.ts`, `packages/ledger/src/journals/classify.ts` (`openSingle`)

**Interfaces:**
- Consomme : `LotBook.insertAfter` (tâche 3), `sharesPerContract` et `coverableLots` (tâche 4), `RowNote` (tâche 2).
- Produit, dans `journals/takeover.ts` :
  ```ts
  export interface TakeoverRequest {
    shares: ContractKey;    // le contrat actions du sous-jacent
    call: ContractKey;      // le call vendu : son strike fixe le prix, son libellé nomme la note
    when: string;
    callIds: string[];
    contracts: number;      // ce que ce call couvre
    alreadyCovered: number; // ce que les autres calls couverts encore ouverts adossent déjà
  }
  export function takeOverShares(ctx: ReplayContext, request: TakeoverRequest): void;
  ```

- [x] **Step 1 : écrire les tests qui échouent**

Créer `packages/ledger/src/journals/takeover.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import type { JournalRow, JournalsReport } from "./types.ts";

beforeEach(resetIds);

const BUY = "2026-03-02T14:30:00.000Z";
const SELL_CALL = "2026-08-03T14:30:00.000Z";
const CALL = { right: "C" as const, strike: 20, expiry: "2026-09-18" };

/** `report.rows` is newest first; every assertion below reads a takeover as a story, so oldest first. */
function oldestFirst(rows: readonly JournalRow[]): JournalRow[] {
  return [...rows].sort((a, b) => (a.startWhen === b.startWhen ? (a.id < b.id ? -1 : 1) : a.startWhen < b.startWhen ? -1 : 1));
}

function story(report: JournalsReport): string[] {
  return oldestFirst(report.rows).map((r) => `${r.strategy} ${r.kind} ${r.quantity} open=${r.openPrice} close=${r.closePrice} pnl=${r.pnl} ${r.event ?? "-"}`);
}

function shares(report: JournalsReport, strategy: string): JournalRow[] {
  return oldestFirst(report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy));
}

function integrated(report: JournalsReport): JournalRow[] {
  return oldestFirst(report.rows.filter((r) => r.event === "integrated"));
}

describe("takeOverShares — une reprise simple", () => {
  /** 100 shares bought at 10, one call sold at strike 20 five months later. */
  const ledger = () => [
    stock({ quantity: 100, price: 10, when: BUY }),
    option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
  ];

  it("closes the bought lot in Others at the strike and reopens it in Wheel at the strike", () => {
    const report = buildJournals(ledger());
    expect(story(report)).toEqual([
      "others shares 100 open=10 close=20 pnl=999 integrated",
      "wheel shares 100 open=20 close=null pnl=null -",
      "wheel short_call -1 open=0.5 close=null pnl=null -",
    ]);
  });

  it("invents no money: the two legs of the takeover cancel out", () => {
    const report = buildJournals(ledger());
    const handed = shares(report, "others")[0];
    const taken = shares(report, "wheel")[0];
    expect(handed.closeTotal).toBe(2000);
    expect(handed.closeCommission).toBe(0);
    expect(taken.openTotal).toBe(-2000);
    expect(taken.openCommission).toBe(0);
    expect((handed.closeTotal ?? 0) + (taken.openTotal ?? 0)).toBe(0);
  });

  it("dates the Wheel lot at the call, keeps the commission of the purchase on the Others side", () => {
    const report = buildJournals(ledger());
    expect(shares(report, "wheel")[0]).toMatchObject({ startWhen: SELL_CALL, assigned: false, openCommission: 0 });
    expect(shares(report, "others")[0]).toMatchObject({ startWhen: BUY, openCommission: -1, endWhen: SELL_CALL });
  });

  it("names the call in both notes", () => {
    const report = buildJournals(ledger());
    expect(shares(report, "wheel")[0].note).toEqual({ code: "takenOverAtStrike", contract: "MQZA Sep18'26 20 Call" });
    expect(shares(report, "others")[0].note).toEqual({ code: "handedToWheel", contract: "MQZA Sep18'26 20 Call" });
  });

  it("counts the resale from the strike, never from the purchase price", () => {
    const report = buildJournals([...ledger(), stock({ quantity: -100, price: 25, when: "2026-09-01T14:30:00.000Z", commission: -1 })]);
    expect(shares(report, "wheel")[0]).toMatchObject({ closePrice: 25, pnl: 2500 - 2000 - 1, event: "sold" });
  });
});

describe("takeOverShares — le strike sous le prix d'achat", () => {
  it("leaves the loss in Others and starts the Wheel at the strike", () => {
    const report = buildJournals([
      stock({ quantity: 100, price: 30, when: BUY }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ]);
    expect(shares(report, "others")[0]).toMatchObject({ closePrice: 20, pnl: 2000 - 3000 - 1 });
    expect(shares(report, "wheel")[0]).toMatchObject({ openPrice: 20, openTotal: -2000 });
  });
});

describe("takeOverShares — couverture partielle", () => {
  it("cuts the lot and leaves the rest in Others, pro rata", () => {
    const report = buildJournals([
      stock({ quantity: 300, price: 10, when: BUY, commission: -3 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ]);
    const others = shares(report, "others");
    expect(others.map((r) => [r.quantity, r.openCommission, r.event])).toEqual([
      [100, -1, "integrated"],
      [200, -2, null],
    ]);
    expect(shares(report, "wheel").map((r) => r.quantity)).toEqual([100]);
  });

  it("floors the capacity of a fractional lot and cuts it without losing a share", () => {
    // 226.49 shares is a real shape: a merger's residue, or a fractional dividend.
    const report = buildJournals([
      stock({ quantity: 226.49, price: 10, when: BUY }),
      option({ ...CALL, quantity: -2, price: 0.5, when: SELL_CALL }),
    ]);
    expect(shares(report, "wheel").map((r) => r.quantity)).toEqual([200]);
    const others = shares(report, "others");
    expect(others.map((r) => r.event)).toEqual(["integrated", null]);
    expect(others[0].quantity).toBe(200);
    expect(others[1].quantity).toBeCloseTo(26.49, 10);
    // Nothing evaporates in the cut.
    expect((others[0].quantity ?? 0) + (others[1].quantity ?? 0)).toBeCloseTo(226.49, 10);
  });

  it("delivers the shares the call covers, not the untouched remainder", () => {
    const report = buildJournals([
      stock({ quantity: 300, price: 10, when: BUY, commission: -3 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      ...deliver({ ...CALL, quantity: 1 }),
    ]);
    // The Wheel lot is the one the assignment closes: the Others remainder stays open.
    expect(shares(report, "wheel")[0]).toMatchObject({ quantity: 100, closePrice: 20, event: "sold", ongoing: false });
    expect(shares(report, "others").find((r) => r.event === null)).toMatchObject({ quantity: 200, ongoing: true });
  });
});

describe("takeOverShares — ce qui ne doit rien reprendre", () => {
  it("takes nothing over when the shares were assigned: they are already Wheel", () => {
    const report = buildJournals([
      option({ right: "P", strike: 17, expiry: "2026-07-17", quantity: -1, price: 0.2, when: BUY }),
      ...deliver({ right: "P", strike: 17, expiry: "2026-07-17", quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ]);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "wheel").map((r) => r.openPrice)).toEqual([17]);
  });

  it("does not take the same lot over twice when a second call is sold", () => {
    const report = buildJournals([
      stock({ quantity: 200, price: 10, when: BUY }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, strike: 25, quantity: -1, price: 0.4, when: "2026-08-04T14:30:00.000Z" }),
    ]);
    expect(integrated(report).map((r) => r.closePrice)).toEqual([20, 25]);
    expect(shares(report, "wheel").map((r) => [r.quantity, r.openPrice])).toEqual([[100, 20], [100, 25]]);
  });

  it("takes nothing over a second time when the call is bought back and sold again", () => {
    const report = buildJournals([
      stock({ quantity: 100, price: 10, when: BUY }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, quantity: 1, price: 0.2, when: "2026-08-05T14:30:00.000Z" }),
      option({ ...CALL, strike: 25, quantity: -1, price: 0.4, when: "2026-08-06T14:30:00.000Z" }),
    ]);
    expect(integrated(report)).toHaveLength(1);
    expect(shares(report, "wheel").map((r) => r.openPrice)).toEqual([20]);
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/takeover.test.ts
```

Attendu : ÉCHEC — aucune ligne `integrated`, les actions restent en « others ».

- [x] **Step 3 : compléter `journals/takeover.ts`**

Ajouter les imports dont la reprise a besoin, à côté de ceux de la tâche 4 :

```ts
import { newLot, type Lot } from "./book.ts";
import { formatContractLabel } from "./contract.ts";
import { uniqueId, type ReplayContext } from "./context.ts";
import { buildRow, share } from "./rows.ts";
```

puis, à la suite de `coverableLots` :

```ts
export interface TakeoverRequest {
  /** The underlying's share contract. */
  shares: ContractKey;
  /** The call being sold: its strike sets the price, its label names the note. */
  call: ContractKey;
  when: string;
  /** Identifiers of the call sale: they close the shares it takes over. */
  callIds: string[];
  /** Contracts this call covers. */
  contracts: number;
  /** Contracts the other covered calls still open already back. */
  alreadyCovered: number;
}

/**
 * Moves into the Wheel the shares this call covers (spec §4 and §5). Walks the
 * long share lots of the underlying in book order, steps over what already
 * backs the other covered calls, then takes `contracts` contracts. A portion
 * already in the Wheel is consumed untouched — it entered once and stays —, a
 * portion that is not is cut out of its lot, closed in its own strategy at the
 * strike, and reopened in the Wheel at the strike.
 *
 * Stepping over what is already backed is what makes this stable over time: two
 * calls sold one after the other never take the same lot twice, and a call
 * bought back frees its shares without taking them out of the Wheel, so the
 * next call falls on shares already taken over and rebases nothing.
 */
export function takeOverShares(ctx: ReplayContext, request: TakeoverRequest): void {
  const strike = request.call.strike;
  if (strike === null) return;
  let toSkip = request.alreadyCovered;
  let toTake = request.contracts;
  for (const lot of coverableLots(ctx.book, request.shares)) {
    if (toTake <= 0) return;
    const per = sharesPerContract(lot);
    const available = lot.remaining / per;
    const skipped = Math.min(available, toSkip);
    toSkip -= skipped;
    const take = Math.min(available - skipped, toTake);
    if (take <= 0) continue;
    toTake -= take;
    if (lot.strategy === "wheel") continue;
    // `take === available` implies nothing was skipped in this lot: take the
    // remaining shares themselves rather than a product, so no float noise
    // appears on a lot taken over whole.
    takeOverLot(ctx, lot, take === available ? lot.remaining : take * per, strike, request);
  }
}

/** Cuts `shares` out of `lot`, closes them in their own strategy at `strike`, reopens them in the Wheel. */
function takeOverLot(ctx: ReplayContext, lot: Lot, shares: number, strike: number, request: TakeoverRequest): void {
  const contract = formatContractLabel(request.call);
  const whole = Math.abs(lot.quantity);
  const rest = lot.remaining - shares;
  ctx.rows.push(
    buildRow(lot, shares, {
      when: request.when,
      price: strike,
      amount: strike * shares,
      commission: 0,
      event: "integrated",
      closeIds: [...request.callIds],
      note: { code: "handedToWheel", contract },
    }),
  );
  lot.remaining = 0;
  const taken = newLot({
    id: uniqueId(ctx, lot.id),
    contract: lot.contract,
    strategy: "wheel",
    kind: "shares",
    openWhen: request.when,
    openPrice: strike,
    openAmount: -strike * shares,
    openCommission: 0,
    quantity: shares,
    openIds: [...lot.openIds],
    ratio: sharesPerContract(lot),
    note: { code: "takenOverAtStrike", contract },
  });
  const successors: Lot[] = [taken];
  if (rest > 0) {
    successors.push(
      newLot({
        id: uniqueId(ctx, lot.id),
        contract: lot.contract,
        strategy: lot.strategy,
        kind: lot.kind,
        openWhen: lot.openWhen,
        openPrice: lot.openPrice,
        openAmount: share(lot.openAmount, rest, whole),
        openCommission: share(lot.openCommission, rest, whole),
        quantity: rest,
        openIds: [...lot.openIds],
        assigned: lot.assigned,
        orphan: lot.orphan,
        ratio: lot.ratio,
        deliveredBy: lot.deliveredBy,
      }),
    );
  }
  ctx.book.insertAfter(lot, successors);
  // "A put stays ongoing until its shares are sold" follows the shares, not the
  // lot object they were cut from: a delivered lot taken over by the Wheel must
  // keep its option's row open.
  for (const lots of ctx.delivered.values()) if (lots.includes(lot)) lots.push(...successors);
}
```

- [x] **Step 4 : appeler la reprise depuis `openSingle`**

Ajouter `takeOverShares` à l'import de `./takeover.ts` déjà présent dans `classify.ts`.

Remplacer la fin de `openSingle` (la boucle sur `parts`) par :

```ts
  const covered = state.coveredCalls(contract);
  const parts = splitShortCall(
    Math.abs(opening.quantity),
    state.wheelCapacity(contract),
    state.leapsCapacity(contract),
    contract.strike,
    state.averageSharePrice(contract),
  );
  let backed = covered;
  for (const part of parts) {
    // Before the call's own lot is opened, so `backed` counts only the calls
    // that were already there — and after it for the next opening of the group,
    // which reads the book again.
    if (part.strategy === "wheel" && part.cover === "shares") {
      takeOverShares(ctx, {
        shares: sharesContract(contract.ticker, contract.currency),
        call: contract,
        when: tx.when,
        callIds: idsOf(ctx, tx),
        contracts: part.quantity,
        alreadyCovered: backed,
      });
      backed += part.quantity;
    }
    openLot(ctx, opening, part.strategy, part.cover, -part.quantity);
  }
```

- [x] **Step 5 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/takeover.test.ts
pnpm --filter @ib/ledger test
```

Attendu : tout vert.

- [x] **Step 6 : vérifier l'oracle une deuxième fois**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/journals.oracle.test.ts
```

Attendu : 6 tests verts, distribution inchangée. **Si elle bouge, s'arrêter et comprendre.**

- [x] **Step 7 : commit**

```bash
git add packages/ledger/src/journals/takeover.ts packages/ledger/src/journals/takeover.test.ts \
        packages/ledger/src/journals/classify.ts \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
feat(ledger): la wheel reprend au strike les actions qu'elle couvre

Le lot d'actions couvert est coupé sur place : la part reprise est close
dans sa stratégie d'origine au strike du call — nouvel événement
`integrated`, à la date de la vente — et rouverte dans la wheel au même
strike, la part non couverte restant où elle était. Les deux montants se
compensent au centime : rien n'est inventé, et la plus-value d'avant-wheel
reste hors de la stratégie.

La part reprise garde le rang du lot dans le carnet, sans quoi une
assignation vendrait FIFO les actions restées en « others » et le cycle
ne se refermerait jamais.
```

---

## Tâche 6 : les statistiques comptent la revente, la teinte suit

**Files:**
- Modify: `packages/ledger/src/journals/stats.ts:33-40`, `apps/web/src/lib/journalTone.ts:8`
- Test: `packages/ledger/src/journals/stats.test.ts`, `apps/web/src/lib/journalTone.test.ts`

**Interfaces:**
- Consomme : `JournalRow.note` (tâche 2), les lignes produites par la tâche 5.
- Produit : rien de nouveau à l'appel ; un changement de comportement de `computeStats` et de `labelTone`.

- [x] **Step 1 : écrire les tests qui échouent**

Ajouter à `packages/ledger/src/journals/stats.test.ts`, dans `describe("computeStats")` :

```ts
  it("counts shares the Wheel took over at their sale, though nothing was assigned", () => {
    const taken = row({
      kind: "shares", assigned: false, quantity: 100, startWhen: "2026-08-03T14:30:00.000Z",
      openTotal: -2000, openCommission: 0, openNet: -2000,
      note: { code: "takenOverAtStrike", contract: "MQZA Sep18'26 20 Call" },
    });
    expect(computeStats([taken], "wheel")).toEqual([{ currency: "USD", total: 0, months: [], incomplete: 0 }]);
    const sold = row({ ...taken, endWhen: "2026-09-01T14:30:00.000Z", closeTotal: 2500, closeCommission: -1, closeNet: 2499, pnl: 499, ongoing: false, event: "sold" });
    expect(computeStats([sold], "wheel")).toEqual([{ currency: "USD", total: 499, months: [{ month: "2026-09", pnl: 499 }], incomplete: 0 }]);
  });
```

et ajouter `note: null,` au littéral rendu par le fabricant `row` en tête du fichier.

Ajouter à `apps/web/src/lib/journalTone.test.ts` :

```ts
it("tints shares the Wheel took over like the shares an option delivered", () => {
  expect(labelTone(row({ kind: "shares", strategy: "wheel", assigned: false, ongoing: true }))).toBe("shares");
  expect(labelTone(row({ kind: "shares", strategy: "others", assigned: false, ongoing: true }))).toBeNull();
});
```

en suivant le fabricant `row` déjà présent dans ce fichier, auquel il faut ajouter `note: null`.

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/stats.test.ts
pnpm --filter web exec vitest run src/lib/journalTone.test.ts
```

Attendu : ÉCHEC — le total wheel vaut 0 au lieu de 499, et la teinte est `null` au lieu de `"shares"`.

- [x] **Step 3 : compter une ligne d'actions à sa sortie**

Dans `packages/ledger/src/journals/stats.ts`, remplacer

```ts
  if (row.kind === "shares" || row.kind === "short_shares") {
    if (!row.assigned || row.endWhen === null) return [];
    return [{ month: monthOf(row.endWhen), amount: row.pnl }];
  }
```

par

```ts
  if (row.kind === "shares" || row.kind === "short_shares") {
    if (row.endWhen === null) return [];
    return [{ month: monthOf(row.endWhen), amount: row.pnl }];
  }
```

et corriger le commentaire du bloc `contributions` : « delivered shares » devient « shares, whether an option delivered them or the Wheel took them over ». Le drapeau `assigned` ne gardait rien — seules les stratégies wheel, LEAPS et condors sont sommées, et elles ne détiennent d'actions que par livraison ou par reprise — et il empêcherait les actions reprises de compter.

- [x] **Step 4 : teinter une ligne d'actions wheel**

Dans `apps/web/src/lib/journalTone.ts`, remplacer

```ts
  if (row.kind === "shares") return row.assigned ? "shares" : null;
```

par

```ts
  // A Wheel holding is a Wheel holding whether an option delivered it or the
  // strategy took it over: `assigned` says how it arrived, not where it is.
  if (row.kind === "shares") return row.assigned || row.strategy === "wheel" ? "shares" : null;
```

- [x] **Step 5 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @ib/ledger test
pnpm --filter web test
```

Attendu : tout vert.

- [x] **Step 6 : commit**

```bash
git add packages/ledger/src/journals/stats.ts packages/ledger/src/journals/stats.test.ts \
        apps/web/src/lib/journalTone.ts apps/web/src/lib/journalTone.test.ts \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
feat(ledger): la revente d'actions reprises compte dans la wheel

`contributions` exigeait `assigned` pour compter une ligne d'actions. La
garde ne protégeait rien — seules wheel, LEAPS et condors sont sommées,
et elles ne détiennent d'actions que par livraison ou par reprise — et
elle aurait empêché les actions reprises de compter à leur revente. La
teinte du libellé suit la même règle : `assigned` dit comment une ligne
est arrivée, pas où elle est.
```

---

## Tâche 7 : la colonne « Commentaire »

**Files:**
- Modify: `apps/web/src/pages/JournalPage.tsx:19-22,120-145`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/JournalPage.test.tsx`

**Interfaces:**
- Consomme : `JournalRow.note` et les notes des tâches 2 et 5.
- Produit : une dix-septième colonne, en fin de tableau.

- [x] **Step 1 : écrire les tests qui échouent**

Dans `apps/web/src/pages/JournalPage.test.tsx`, ajouter en tête, après les imports :

```ts
function tx(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

/** 100 NVDA bought at 120, a call sold on them at 150, and a TSLA call sold on nothing at all. */
const TAKEOVER_TRANSACTIONS: Transaction[] = [
  tx({ externalId: "flex:trade:201", symbol: "NVDA", secType: "STK", quantity: 100, price: 120, amount: -12000, when: "2026-03-02T14:30:00.000Z" }),
  tx({ externalId: "flex:trade:202", symbol: "NVDA  260821C00150000", right: "C", strike: 150, expiry: "2026-08-21", quantity: -1, price: 2, amount: 200, when: "2026-08-03T14:30:00.000Z" }),
  tx({ externalId: "flex:trade:203", symbol: "TSLA  260821C00300000", right: "C", strike: 300, expiry: "2026-08-21", quantity: -1, price: 1, amount: 100, when: "2026-08-04T14:30:00.000Z" }),
];

async function withTakeoverLedger(): Promise<void> {
  await Promise.all([db.transactions.clear(), db.snapshots.clear()]);
  await db.transactions.bulkAdd(TAKEOVER_TRANSACTIONS);
}
```

(importer `type Transaction` depuis `@ib/ledger`.)

Puis remplacer le test « shows the sixteen columns in order » par :

```ts
  it("shows the seventeen columns in order", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Date début", "Label", "Ticker", "Quantité", "Prix initial", "Prix total initial", "Commission initiale", "Assigné",
      "Prix total initial net", "Date fin", "Prix final", "Prix total final", "Commission finale", "Prix total final net", "Gain/Perte", "En cours",
      "Commentaire",
    ]);
  });
```

et ajouter les deux nouveaux tests :

```ts
  it("explains, in the Wheel journal, why shares already held are there and at what price", async () => {
    await withTakeoverLedger();
    renderJournal("wheel");
    const taken = cells(await rowFor("NVDA"));
    expect(taken[0]).toBe("2026-08-03 14:30:00");
    expect(taken[4]).toBe("150.00");
    expect(taken[7]).toBe("0");
    expect(taken[16]).toBe("Actions déjà détenues, reprises au strike du call NVDA Aug21'26 150 Call");
    // The call that caused it needs no explaining.
    expect(cells(await rowFor("NVDA Aug21'26 150 Call"))[16]).toBe("");
  });

  it("explains, in the Others journal, where the shares went and why a call is naked", async () => {
    await withTakeoverLedger();
    renderJournal("others");
    const handed = cells(await rowFor("NVDA"));
    expect(handed[10]).toBe("150.00");
    expect(handed[14]).toBe("2,999.00");
    expect(handed[16]).toBe("Reprises par la stratégie Wheel au strike du call NVDA Aug21'26 150 Call");
    expect(cells(await rowFor("TSLA Aug21'26 300 Call"))[16]).toBe("Call nu : ni actions ni LEAPS pour le couvrir");
  });
```

Enfin, ajouter `""` à la fin des deux tableaux `toEqual` des tests « fills a Wheel put assigned… » : ces lignes n'ont pas de note.

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter web exec vitest run src/pages/JournalPage.test.tsx
```

Attendu : ÉCHEC — seize en-têtes au lieu de dix-sept.

- [x] **Step 3 : ajouter la colonne dans `JournalPage.tsx`**

Dans `COLUMNS`, ajouter `"note"` en dernier :

```ts
const COLUMNS = [
  "startWhen", "label", "ticker", "quantity", "openPrice", "openTotal", "openCommission", "assigned",
  "openNet", "endWhen", "closePrice", "closeTotal", "closeCommission", "closeNet", "pnl", "ongoing", "note",
] as const;
```

Dans l'en-tête, la colonne `note` s'aligne à gauche comme `label` :

```tsx
<TableHead key={column} className={column === "label" || column === "ticker" || column === "note" || column.endsWith("When") ? undefined : "text-right"}>
```

Dans `JournalTableRow`, après la cellule `ongoing` :

```tsx
      <TableCell className="text-muted-foreground">
        {row.note ? t(`journal.notes.${row.note.code}`, { contract: row.note.contract }) : ""}
      </TableCell>
```

- [x] **Step 4 : ajouter les libellés dans `apps/web/src/i18n/fr.json`**

Dans `journal.columns`, après `"ongoing"` :

```json
    "note": "Commentaire"
```

Et, dans `journal`, après le bloc `columns` :

```json
  "notes": {
    "takenOverAtStrike": "Actions déjà détenues, reprises au strike du call {{contract}}",
    "handedToWheel": "Reprises par la stratégie Wheel au strike du call {{contract}}",
    "nakedCall": "Call nu : ni actions ni LEAPS pour le couvrir",
    "truncatedHistory": "Historique tronqué : aucun lot à clôturer"
  }
```

- [x] **Step 5 : ajouter les libellés dans `apps/web/src/i18n/en.json`**

Dans `journal.columns`, après `"ongoing"` :

```json
    "note": "Comment"
```

Et, dans `journal`, après le bloc `columns` :

```json
  "notes": {
    "takenOverAtStrike": "Shares already held, taken over at the strike of {{contract}}",
    "handedToWheel": "Taken over by the Wheel at the strike of {{contract}}",
    "nakedCall": "Naked call: no shares and no LEAPS to cover it",
    "truncatedHistory": "Truncated history: no lot to close"
  }
```

- [x] **Step 6 : lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter web test
```

Attendu : tout vert. Si un test de `apps/web/e2e/corporate-actions.spec.ts` lit une cellule par son index, vérifier qu'il vise une colonne d'index inférieur à 16 : la nouvelle colonne est en fin de ligne et ne décale rien.

- [x] **Step 7 : regarder la page**

Depuis la **racine du worktree** :

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/journal/wheel /accounts/alpha/journal/others --seed
```

Ouvrir les deux PNG avec l'outil `Read`. Attendu : la colonne « Commentaire » en fin de tableau, vide sur les lignes ordinaires.

- [x] **Step 8 : commit**

```bash
git add apps/web/src/pages/JournalPage.tsx apps/web/src/pages/JournalPage.test.tsx \
        apps/web/src/i18n/fr.json apps/web/src/i18n/en.json \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
feat(web): une colonne « Commentaire » dans les journaux

Le moteur donne un code et le libellé du contrat en cause ; la phrase
vit dans les fichiers de langue et le libellé s'y interpole. La colonne
dit pourquoi des actions déjà détenues sont dans la wheel et à quel
prix, où elles sont parties côté « others », et pourquoi un call est nu.

Lève un point reporté du sous-projet 7 : `CloseEvent` n'était affiché
nulle part.
```

---

## Tâche 8 : oracles, données réelles, documents, dette, revue, merge

**Files:**
- Modify: `CLAUDE.md`, `docs/points-reportes.md`, `docs/specs/2026-09-09-wheel-actions-couvertes-design.md` (statut)
- Test: aucun nouveau ; on vérifie ceux qui existent.

- [x] **Step 1 : `pnpm check`**

```bash
pnpm check
```

Attendu : lint, typecheck et tous les Vitest verts. Ni Python, ni Django, ni Playwright.

- [x] **Step 2 : l'oracle, une dernière fois, et à l'identique**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/journals.oracle.test.ts
```

Attendu : 6 tests verts, `STRATEGY_DISTRIBUTION` toujours `{ wheel: 78, leaps: 55, condors: 4 }`, zéro écart et zéro orphelin de réconciliation. C'est la même sortie qu'à la tâche 1, step 2.

- [x] **Step 3 : vérifier sur les données réelles, sans rien committer**

Depuis la racine du worktree, avec le relevé réel. `private/` n'est pas versionné et ne vit
donc **que dans le checkout principal** : le chemin d'import est absolu, celui du dépôt, pas
celui du worktree.

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/journal/wheel \
  --seed --ib-account=<compte> \
  --import=/home/seb/IA/IB_Analyzer2/private/<compte>_2025_2025.htm
```

Ouvrir le PNG avec `Read` et vérifier, sur ZXAT :

- les trois lignes d'actions assignées à 17 sont toujours là, closes au 2025-10-03 à 25,18, sans commentaire — elles étaient déjà dans la wheel, rien ne les reprend ;
- aucune ligne `integrated` sur ZXAT dans ce fichier, l'historique 2025 étant complet.

Le fichier `private/` n'est pas versionné ; si l'import échoue faute du fichier, sauter cette étape et le noter.

- [x] **Step 4 : mettre à jour `CLAUDE.md`**

Trois modifications.

1. Dans « Règles qui mordent si on les oublie », remplacer la puce des constantes métier par :

```markdown
- **Constantes métier** : `BUYBACK_RATIO` et `MAX_STRUCTURE_LOSS` dans `packages/coverage`,
  `DEFAULT_MULTIPLIER` dans `packages/ledger` — le moteur de journaux en a besoin et
  `coverage` dépend de `ledger`, donc l'inverse serait un cycle ; `coverage` la ré-exporte.
  Une seule définition chacune, jamais recodées ailleurs.
```

2. Ajouter, après la puce « Les journaux sont une vue calculée du ledger » :

```markdown
- **Un call vendu sur des actions détenues est un call couvert**, qu'elles aient été
  assignées ou achetées au marché. Les actions qu'il couvre entrent alors dans la wheel,
  **reprises au strike de ce call** : le lot est coupé sur place, clos dans sa stratégie
  d'origine au strike (événement `integrated`, `journals/takeover.ts`) et rouvert dans la
  wheel au même strike, la part reprise gardant le rang du lot dans le carnet. Reprendre au
  coût réel ferait entrer la plus-value d'avant-wheel dans la stratégie ; laisser la part
  reprise en fin de file ferait livrer les mauvaises actions à l'assignation. La
  classification se fait une fois, à la vente : un call vendu à nu ne se reclasse jamais.
- **`JournalRow.note` porte un code, jamais une phrase** : `packages/ledger` n'écrit aucun
  texte visible, `apps/web/src/i18n/{fr,en}.json` porte la partie fixe et le libellé de
  contrat s'y interpole.
```

3. Dans le tableau des sous-projets, ajouter la ligne :

```markdown
| 8 | Le journal Wheel prend les actions qu'il couvre | fait (2026-09-09) |
```

- [x] **Step 5 : mettre à jour `docs/points-reportes.md`**

Retirer la puce « **`CloseEvent` n'est affiché nulle part dans l'application** » : la colonne « Commentaire » nomme désormais la reprise, et les autres événements sont listés ci-dessous comme dette neuve.

Ajouter une section :

```markdown
## Reporté par la reprise d'actions de la wheel (sous-projet 8)

- **Une livraison ne choisit pas explicitement les actions qui couvrent le call** : elle
  reste FIFO et tombe juste parce que la coupe place la part reprise au rang du lot dont
  elle sort. Deux calls couverts par deux lots repris à des strikes différents peuvent voir
  leurs actions interverties ; le P/L reste dans la wheel, sa répartition entre les deux
  lignes non.
- **`insertByOpenWhen` compare des `openWhen` qui ne suivent plus l'ordre de la liste**
  après une coupe, la part reprise portant l'instant du call, postérieur au lot qui la suit.
  Seules les opérations sur titres empruntent ce chemin ; l'effet possible est un lot
  converti inséré un rang trop tôt.
- **Des actions achetées au même instant qu'un call vendu ne le couvrent pas** :
  `classifyOpenings` tourne avant que la boucle des actions de `replayGroup` n'ouvre leurs
  lots. Une assignation du même instant, elle, est visible, `deliverShares` tournant avant.
  Asymétrie antérieure à ce sous-projet, que la reprise rend seulement plus visible.
- **Un call vendu à nu ne se reclasse pas** si des actions sont achetées ensuite : voulu,
  la classification se faisant une fois à la vente.
- **La colonne « Commentaire » ne couvre pas tous les événements** : `corporate_action`,
  `expired` et `exercised` n'ont toujours pas de libellé, faute de code de note.
- **Aucun corpus anonymisé ne contient de reprise** : l'oracle beta n'a pas une seule
  ligne en « others », donc pas un seul lot d'actions non assigné, et ne prouve donc que la
  non-régression. Le comportement neuf n'est couvert que par les tests unitaires de
  `takeover.test.ts` et par une vérification manuelle sur `private/`.
```

- [x] **Step 6 : passer le spec en « implémenté »**

Dans `docs/specs/2026-09-09-wheel-actions-couvertes-design.md`, remplacer la ligne de statut par :

```markdown
Statut : implémenté (2026-09-09).
```

- [x] **Step 7 : commit des documents**

```bash
git add CLAUDE.md docs/points-reportes.md docs/specs/2026-09-09-wheel-actions-couvertes-design.md \
        docs/plans/2026-09-09-wheel-actions-couvertes.md
git commit
```

Message :

```
docs: sous-projet 8 livré, dette neuve et règles de la wheel

`CLAUDE.md` dit où vit `DEFAULT_MULTIPLIER`, ce qui rend un call couvert
et pourquoi la reprise se fait au strike. Six points reportés, dont le
principal : aucun corpus anonymisé ne contient de reprise, l'oracle ne
prouve que la non-régression.
```

- [x] **Step 8 : revue de branche**

Invoquer la skill `superpowers:requesting-code-review` sur la branche `wheel-actions-couvertes`. Traiter les retours avec `superpowers:receiving-code-review` : vérifier chaque point avant de l'implémenter, et reporter dans `docs/points-reportes.md` ce qui est jugé non bloquant, avec sa raison.

- [x] **Step 9 : merge**

Invoquer la skill `superpowers:finishing-a-development-branch`. Avant le merge :

```bash
pnpm check
pnpm --filter @ib/ib-parsers exec vitest run src/journals.oracle.test.ts
```

Attendu : tout vert, distribution de l'oracle inchangée.

---

## Ce qui est délibéré

- **La classification se fait une fois, à la vente du call.** Un call vendu à nu reste nu, un call couvert reste couvert même quand les actions partent. C'est la règle du moteur depuis le sous-projet 5 (« loses the Wheel cover when the delivered shares are sold, but never reclasses the call ») et ce sous-projet ne la rouvre pas.
- **`assigned` reste faux sur les actions reprises.** Le marquer vrai ferait compter les statistiques sans toucher à `contributions`, au prix d'un mensonge dans la seule colonne dont c'est le rôle.
- **La commission d'achat reste du côté « others ».** La wheel achète au strike, sans frais : le coût d'acquisition appartient à la période d'avant-wheel, comme la plus-value.
- **La part reprise porte l'instant du call, pas celui de l'achat.** C'est le moment où ces actions sont entrées dans la stratégie ; les dater de l'achat mettrait dans le journal Wheel une ligne de 2023 au prix d'un strike de 2026.
- **Aucune ligne d'événement à la date d'une sortie.** Le journal reste un journal de lots, une ligne par lot et par sortie (§3.6 du spec du sous-projet 5).
