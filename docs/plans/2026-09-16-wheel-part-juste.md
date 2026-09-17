# Sous-projet 17 — La Wheel ne prend que ce qu'il faut : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Les cases `- [ ]` suivent l'avancement : **elles se cochent dans le worktree, au fur et à
> mesure, dans le même commit que la tâche.** Une reprise de session part de la première case
> non cochée.

**Goal:** Qu'un call couvert ne fasse entrer dans la Wheel que les actions qui lui manquent, que les actions sortent d'abord de la Wheel quand un call Wheel les fait sortir, et qu'une opération sur titres ne réordonne plus une coupe — pour que alpha montre 500 ZXAP et aucune ZXAF dans la Wheel.

**Architecture:** Trois changements du moteur de journaux, tous dans `packages/ledger/src/journals/`. (1) `Lot.rankWhen` fixe le rang d'un lot, hérité par les deux morceaux d'une coupe, et le tri d'une opération sur titres le lit. (2) `takeOverShares` compte la part libre de la Wheel et ne reprend que le manque, sur les seuls lots hors Wheel. (3) `LotBook.closePreferring` clôt d'abord des lots Wheel dans une limite en contrats ; `replayGroup` s'en sert pour une vente au même instant qu'un rachat de calls Wheel, `deliverShares` pour l'assignation d'un call Wheel.

**Tech Stack:** TypeScript 6, Vitest 4, Dexie 4 (`fake-indexeddb` en test). Node 22, pnpm.

**Spec:** `docs/specs/2026-09-16-wheel-part-juste-design.md`. Lire aussi `docs/specs/2026-09-09-wheel-actions-couvertes-design.md` §4 et §5 (la reprise que ce sous-projet modifie) et `CLAUDE.md`.

## Global Constraints

- **La reprise reste au strike**, coupée comme au §5 du spec du sous-projet 8 : ligne `integrated` dans la stratégie d'origine, lot W au rang du lot coupé, reliquat T juste après. Seul le *nombre* d'actions reprises change.
- **Une portion se mesure en actions** : 134 actions et un call vendu → 100 reprises, 34 restent.
- **Aucune vente ni livraison sans call Wheel ne change d'ordre** : elles restent FIFO dans l'ordre du carnet (`LotBook.close` ne change pas).
- **« Même instant » est celui du rejeu** : `groupByWhen`, après `mergeFills`. Pas de fenêtre.
- **`openWhen` ne change jamais** : il devient `startWhen` des lignes, le journal date toujours la part reprise du jour du call.
- **L'oracle des journaux ne vieillit pas tout seul.** `STRATEGY_DISTRIBUTION` (`packages/ib-parsers/src/journals.oracle.test.ts`) doit rester `{ wheel: 78, leaps: 55, condors: 4 }` avec zéro écart. S'il bouge, comprendre quel cas avant de toucher à la constante, et le dire.
- **`packages/ledger` ne dépend de rien** et n'émet aucun texte visible.
- **Aucun ticker, identifiant de compte ni montant réel dans un fichier versionné.** `alpha.private.test.ts` n'en écrit aucun ; la sonde de la tâche 5 n'est jamais committée.
- **Un test doit échouer si le comportement change.** Chaque test neuf est lancé avant l'implémentation et doit échouer pour la raison annoncée ; un test qui passe déjà est signalé comme garde-fou, pas comme TDD.
- Code et commentaires en anglais ; documentation et messages de commit en français.
- Chaque commit se termine par :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Le travail se fait dans le worktree `.claude/worktrees/wheel-part-juste` (skill `superpowers:using-git-worktrees`), branche `wheel-part-juste`, mergé sur `main` après revue.
- Avant chaque commit : `pnpm --filter @ib/ledger test` et `pnpm --filter @ib/ledger typecheck` passent.

---

## Structure des fichiers

```
packages/ledger/src/journals/
  book.ts (+ test)          + Lot.rankWhen, sharesPerContract (venu de takeover.ts),
                            insertByOpenWhen → insertByRank, + LotBook.closePreferring
  takeover.ts (+ test)      takeOverShares : part libre de la Wheel, manque sur les lots
                            hors Wheel ; W et T héritent de rankWhen
  classify.ts               importe sharesPerContract de book.ts
  replay.ts (+ test)        replayGroup : priorité Wheel sur rachat ; deliverShares :
                            priorité Wheel sur assignation d'un call Wheel

apps/web/src/db/
  alpha.private.test.ts   + aucune reprise inutile sur le compte réel

CLAUDE.md, docs/points-reportes.md, docs/specs/2026-09-16-wheel-part-juste-design.md
```

---

### Task 1: Le rang d'un lot survit à une opération sur titres

**Files:**
- Modify: `packages/ledger/src/journals/book.ts`
- Modify: `packages/ledger/src/journals/takeover.ts` (fonction `takeOverLot`, `newLot` de W et de T)
- Modify: `packages/ledger/src/journals/classify.ts:8` (import)
- Test: `packages/ledger/src/journals/book.test.ts`, `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Produces: `Lot.rankWhen: string` ; `LotInit` accepte `rankWhen` optionnel, `newLot` le met à `openWhen` par défaut ; `export function sharesPerContract(lot: Lot): number` exporté par `book.ts` (plus par `takeover.ts`).

- [x] **Step 1: Écrire les tests qui échouent**

Dans `book.test.ts`, bloc `describe("newLot")`, ajouter :

```ts
  it("ranks a lot at its own opening unless told otherwise", () => {
    expect(lot("a", -1).rankWhen).toBe("2026-08-01T14:30:00.000Z");
    expect(newLot({ ...lot("b", -1), rankWhen: "2024-01-02T14:30:00.000Z" }).rankWhen).toBe("2024-01-02T14:30:00.000Z");
  });
```

Dans `book.test.ts`, bloc `describe("LotBook.move")`, corriger le test existant « joins lots already open on the destination, oldest first » : le lot spreadé hérite du `rankWhen` de `lotOf(5)`, il faut le dater lui aussi. Remplacer la ligne

```ts
    const newer = newLot({ ...lotOf(5), contract: to, openWhen: "2025-06-02T09:30:00.000Z" });
```

par

```ts
    const newer = newLot({ ...lotOf(5), contract: to, openWhen: "2025-06-02T09:30:00.000Z", rankWhen: "2025-06-02T09:30:00.000Z" });
```

et ajouter dans le même bloc :

```ts
  it("ranks the moved lots by rankWhen, not by openWhen", () => {
    const book = new LotBook();
    // A lot the Wheel took over: opened the day of the call, ranked at the purchase it was cut from.
    const destination = newLot({ ...lotOf(5), contract: to, openWhen: "2025-03-02T09:30:00.000Z", rankWhen: "2025-03-02T09:30:00.000Z" });
    book.open(destination);
    book.open(newLot({ ...lotOf(10), openWhen: "2025-06-02T09:30:00.000Z", rankWhen: "2025-01-02T09:30:00.000Z" }));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([10, 5]);
  });
```

Dans `replay.test.ts`, bloc `describe("buildJournals and corporate actions")`, ajouter :

```ts
  it("keeps the Wheel part of a cut ahead of its remainder through a conversion", () => {
    // 400 of 500 shares taken over by 4 calls, the calls bought back, then a 1-for-1
    // CUSIP change. The taken part opens the day of the call, the remainder keeps the
    // purchase date: sorted by openWhen, the remainder would jump ahead and the plain
    // sale that follows would sell it instead of the Wheel shares ranked before it.
    const CALL = { ticker: "TESTV", right: "C" as const, strike: 20, expiry: "2025-03-21" };
    const report = buildJournals([
      stock({ ticker: "TESTV", quantity: 500, price: 10, when: "2025-01-02T14:30:00.000Z" }),
      option({ ...CALL, quantity: -4, price: 0.5, when: "2025-02-03T14:30:00.000Z" }),
      option({ ...CALL, quantity: 4, price: 0.1, when: "2025-02-10T14:30:00.000Z" }),
      caLeg("TESTP", 500, "2025-02-20T20:25:00.000Z"),
      caLeg("TESTV.OLD", -500, "2025-02-20T20:25:00.000Z"),
      stock({ ticker: "TESTP", quantity: -100, price: 12, when: "2025-03-03T14:30:00.000Z" }),
    ]);
    const open = (strategy: string) =>
      report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy && r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);
    expect(open("wheel")).toBe(300);
    expect(open("others")).toBe(100);
  });
```

Vérifier que `option` est importé en tête de `replay.test.ts` depuis `./fixtures.ts` ; l'ajouter à l'import existant sinon.

- [x] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger exec vitest run src/journals/book.test.ts src/journals/replay.test.ts`
Expected: FAIL — `rankWhen` vaut `undefined` ; « ranks the moved lots by rankWhen » rend `[5, 10]` ; « keeps the Wheel part of a cut ahead » rend `wheel` 400 et `others` 0.

- [x] **Step 3: Implémenter**

Dans `book.ts`, en tête :

```ts
import { contractId, type ContractKey } from "./contract.ts";
import type { CloseEvent, RowKind, RowNote, Strategy } from "./types.ts";
import { DEFAULT_MULTIPLIER } from "../constants.ts";
```

Dans `interface Lot`, juste après `openWhen: string;` :

```ts
  /**
   * Where the lot stands in purchase order. Its own opening for an ordinary lot;
   * for the two lots a Wheel takeover cuts out of a lot, the rank of that lot —
   * the taken part opens the day of the call, and ranking it there would send
   * it behind its own remainder at the next corporate action (spec 17, §5).
   */
  rankWhen: string;
```

Remplacer `LotInit` et `newLot` :

```ts
export type LotInit = Pick<Lot, "id" | "contract" | "strategy" | "kind" | "openWhen" | "openPrice" | "openAmount" | "openCommission" | "quantity" | "openIds"> &
  Partial<Pick<Lot, "rankWhen" | "assigned" | "orphan" | "ratio" | "cover" | "deliveredBy" | "legs" | "parent" | "label" | "note">>;

export function newLot(init: LotInit): Lot {
  return {
    rankWhen: init.openWhen,
    assigned: false,
    orphan: false,
    ratio: null,
    cover: null,
    deliveredBy: null,
    legs: null,
    parent: null,
    label: null,
    note: null,
    ...init,
    remaining: init.quantity,
    exits: 0,
    exitLog: [],
  };
}

/** Shares per contract for a lot: what its delivery showed, or the standard contract. */
export function sharesPerContract(lot: Lot): number {
  return lot.ratio !== null && lot.ratio > 0 ? lot.ratio : DEFAULT_MULTIPLIER;
}
```

Renommer `insertByOpenWhen` en `insertByRank` (déclaration et appel dans `move`), et remplacer son commentaire et sa comparaison :

```ts
  /**
   * Slots a lot among the destination's open lots by `rankWhen` instead of
   * appending it. Insertion order is FIFO order everywhere else in the engine
   * because lots arrive in time order; a conversion breaks that, since the
   * lot it moves may be older than lots the destination already held. The
   * rank, not `openWhen`: a Wheel takeover's taken part opens the day of the
   * call but ranks where the lot it was cut from ranked. Ties go after their
   * equals, so two lots of the same rank keep the order they arrived in — the
   * taken part ahead of its remainder. Closed lots are never stepped over:
   * they keep their place in the history of the contract.
   */
  private insertByRank(lot: Lot): void {
    const id = contractId(lot.contract);
    const list = this.lots.get(id);
    if (!list) {
      this.lots.set(id, [lot]);
      return;
    }
    const at = list.findIndex((other) => other.remaining !== 0 && other.rankWhen > lot.rankWhen);
    if (at < 0) list.push(lot);
    else list.splice(at, 0, lot);
  }
```

Mettre à jour le commentaire de `insertAfter` et de `move` qui citent `insertByOpenWhen` / « own `openWhen` rank » : écrire `insertByRank` / « own `rankWhen` rank ».

Dans `takeover.ts` : supprimer la fonction `sharesPerContract` et l'import de `DEFAULT_MULTIPLIER`, importer `sharesPerContract` depuis `./book.ts` :

```ts
import { newLot, sharesPerContract, type Lot, type LotBook } from "./book.ts";
```

Dans `takeOverLot`, ajouter `rankWhen: lot.rankWhen,` aux deux appels `newLot` (le lot `taken` et le reliquat), juste après leur `openWhen`.

Dans `classify.ts:8`, remplacer l'import :

```ts
import { sharesPerContract } from "./book.ts";
import { coverableLots, takeOverShares } from "./takeover.ts";
```

(Fusionner avec un import existant de `./book.ts` s'il y en a déjà un.)

- [x] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck && pnpm --filter @ib/ib-parsers test`
Expected: PASS, oracle des journaux à zéro écart et `STRATEGY_DISTRIBUTION` inchangée.

- [x] **Step 5: Cocher les cases de la tâche 1 et committer**

```bash
git add packages/ledger/src/journals docs/plans/2026-09-16-wheel-part-juste.md
git commit -m "feat(ledger): le rang d'un lot repris survit à une opération sur titres

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Un call couvre d'abord la Wheel

**Files:**
- Modify: `packages/ledger/src/journals/takeover.ts` (`takeOverShares`, commentaires de `SHARE_EPSILON` et de `takeOverShares`)
- Test: `packages/ledger/src/journals/takeover.test.ts`
- Test: `apps/web/src/db/alpha.private.test.ts`

**Interfaces:**
- Consumes: `sharesPerContract` de `book.ts` (tâche 1).
- Produces: `takeOverShares(ctx, request)` garde sa signature et `TakeoverRequest` ses champs ; seul le nombre d'actions reprises change.

- [x] **Step 1: Écrire les tests qui échouent**

Dans `takeover.test.ts`, ajouter en fin de fichier :

```ts
describe("takeOverShares — la Wheel couvre d'abord", () => {
  const PUT = { right: "P" as const, strike: 12, expiry: "2026-06-19" };
  const PUT_SALE = "2026-05-04T14:30:00.000Z";

  it("takes nothing over when the Wheel already holds enough free shares, even behind an older Others lot", () => {
    // 5 shares bought on the market, then 800 delivered by puts: the 5 come first in the book.
    const transactions = [
      stock({ quantity: 5, price: 10, when: BUY }),
      option({ ...PUT, quantity: -8, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 8 }),
      option({ ...CALL, quantity: -6, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "others").map((r) => [r.quantity, r.endWhen])).toEqual([[5, null]]);
    conserves(transactions);
  });

  it("takes nothing from Others when the Wheel alone covers the call", () => {
    const transactions = [
      stock({ quantity: 134, price: 10, when: BUY }),
      option({ ...PUT, quantity: -1, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "others").map((r) => r.quantity)).toEqual([134]);
    conserves(transactions);
  });

  it("takes over only what an open covered call leaves missing", () => {
    // The first call is covered by the 100 Wheel shares; the second finds none free and takes 100 of the 134.
    const transactions = [
      stock({ quantity: 134, price: 10, when: BUY }),
      option({ ...PUT, quantity: -1, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, strike: 25, quantity: -1, price: 0.4, when: "2026-08-04T14:30:00.000Z" }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report).map((r) => [r.quantity, r.closePrice])).toEqual([[100, 25]]);
    expect(shares(report, "others").filter((r) => r.endWhen === null).map((r) => r.quantity)).toEqual([34]);
    conserves(transactions);
  });

  it("takes 100 of 134 shares for one call", () => {
    // Guard: already true before sub-project 17.
    const transactions = [stock({ quantity: 134, price: 10, when: BUY }), option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL })];
    const report = buildJournals(transactions);
    expect(integrated(report).map((r) => r.quantity)).toEqual([100]);
    expect(shares(report, "wheel").map((r) => r.quantity)).toEqual([100]);
    expect(shares(report, "others").filter((r) => r.endWhen === null).map((r) => r.quantity)).toEqual([34]);
    conserves(transactions);
  });
});
```

Dans `apps/web/src/db/alpha.private.test.ts`, compléter l'import de `@ib/ledger` avec `DEFAULT_MULTIPLIER` et `type JournalRow`, puis ajouter après la fonction `cashChecks` :

```ts
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
```

Dans le test « replays the statements alone: not one difference left, and the cash comes back to zero », juste après `expect(identities.issues).toEqual([]);`, ajouter :

```ts
    // Sub-project 17: a covered call takes over only what the Wheel lacks.
    expect(needlessTakeovers(report.rows)).toBe(0);
```

- [x] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger exec vitest run src/journals/takeover.test.ts`
Expected: FAIL sur les trois premiers tests du bloc (une ligne `integrated` de 5, puis de 100, puis `[[100, 20], [34, 25]]` ou voisin) ; « takes 100 of 134 shares for one call » passe déjà (garde-fou).

Run: `pnpm --filter web exec vitest run src/db/alpha.private.test.ts`
Expected: FAIL, `needlessTakeovers` rend au moins 1 (le test est sauté si `private/` est absent : le signaler et continuer).

- [x] **Step 3: Implémenter**

Dans `takeover.ts`, remplacer le commentaire de `SHARE_EPSILON` :

```ts
/**
 * Below this, a fraction of a share is floating-point noise, not a real
 * position: `toTake` is decremented by divisions and subtractions across
 * several lots (real fractional lots exist, spec's 226.49-share case
 * included), and its residue can land a hair off zero without ever hitting
 * it exactly.
 */
```

Remplacer le commentaire et le corps de `takeOverShares` :

```ts
/**
 * Moves into the Wheel the shares this call lacks (spec 17, §3). The Wheel
 * covers first: its open shares, in contracts, less the covered calls still
 * open, are what it can still back. Only the missing contracts are taken, from
 * the lots outside the Wheel, in book order: each portion is cut out of its lot,
 * closed in its own strategy at the strike, and reopened in the Wheel at the
 * strike (spec 8, §5).
 *
 * Counting the Wheel rather than walking it is what makes this stable over
 * time: a call bought back frees its shares without taking them out of the
 * Wheel, so the next call finds them free and takes nothing, and an older lot
 * outside the Wheel is never taken while the Wheel alone can cover the call.
 */
export function takeOverShares(ctx: ReplayContext, request: TakeoverRequest): void {
  const strike = request.call.strike;
  if (strike === null) return;
  const lots = coverableLots(ctx.book, request.shares);
  const wheel = lots.filter((lot) => lot.strategy === "wheel").reduce((n, lot) => n + lot.remaining / sharesPerContract(lot), 0);
  let toTake = request.contracts - Math.max(0, wheel - request.alreadyCovered);
  for (const lot of lots) {
    if (toTake <= SHARE_EPSILON) return;
    if (lot.strategy === "wheel") continue;
    const per = sharesPerContract(lot);
    const available = lot.remaining / per;
    const take = Math.min(available, toTake);
    // A residue at or below SHARE_EPSILON is noise, not a real fraction of a
    // contract: taking it over would emit a phantom `integrated` row and a
    // phantom Wheel lot for a share that was never really left uncovered.
    if (take <= SHARE_EPSILON) continue;
    toTake -= take;
    // `take === available`: take the remaining shares themselves rather than
    // a product, so no float noise appears on a lot taken over whole.
    takeOverLot(ctx, lot, take === available ? lot.remaining : take * per, strike, request);
  }
}
```

Dans `TakeoverRequest`, le commentaire de `alreadyCovered` devient :

```ts
  /** Contracts the other covered calls still open already back: Wheel shares that are not free. */
```

- [x] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck && pnpm --filter @ib/ib-parsers test`
Expected: PASS, y compris les tests existants de `takeover.test.ts` (« does not take the same lot over twice », « takes nothing over a second time ») et l'oracle inchangé.

Run: `pnpm --filter web exec vitest run src/db/alpha.private.test.ts`
Expected: PASS.

- [x] **Step 5: Cocher les cases de la tâche 2 et committer**

```bash
git add packages/ledger/src/journals apps/web/src/db/alpha.private.test.ts docs/plans/2026-09-16-wheel-part-juste.md
git commit -m "feat(ledger): un call couvert ne reprend que ce qui manque à la Wheel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Une vente au même instant qu'un rachat de calls Wheel vend d'abord la Wheel

**Files:**
- Modify: `packages/ledger/src/journals/book.ts` (+ `LotBook.closePreferring`)
- Modify: `packages/ledger/src/journals/replay.ts` (`replayGroup`)
- Test: `packages/ledger/src/journals/book.test.ts`, `packages/ledger/src/journals/takeover.test.ts`

**Interfaces:**
- Consumes: `sharesPerContract` (tâche 1).
- Produces:
  ```ts
  export interface PreferredClose { closed: ClosedPortion[]; preferredContracts: number }
  LotBook.closePreferring(contract: ContractKey, quantity: number, preferred: (lot: Lot) => boolean, contracts: number): PreferredClose
  export function isWheelShares(lot: Lot): boolean   // book.ts
  ```

- [x] **Step 1: Écrire les tests qui échouent**

Dans `book.test.ts`, bloc `describe("LotBook.insertAfter")` terminé, ajouter un bloc :

```ts
describe("LotBook.closePreferring", () => {
  const SHARES = sharesContract("MQZA", "USD");

  function shareLot(id: string, quantity: number, strategy: "wheel" | "others") {
    return newLot({
      id, contract: SHARES, strategy, kind: "shares", openWhen: "2024-01-02T14:30:00.000Z",
      openPrice: 10, openAmount: -10 * quantity, openCommission: -1, quantity, openIds: [id],
    });
  }

  it("serves the preferred lots first, within the contracts given, then FIFO", () => {
    const book = new LotBook();
    const others = shareLot("others", 300, "others");
    const wheel = shareLot("wheel", 600, "wheel");
    book.open(others);
    book.open(wheel);
    const { closed, preferredContracts } = book.closePreferring(SHARES, -800, isWheelShares, 6);
    expect(closed).toEqual([
      { lot: wheel, quantity: 600 },
      { lot: others, quantity: 200 },
    ]);
    expect(preferredContracts).toBe(6);
  });

  it("folds a lot reached by both passes into one portion", () => {
    const book = new LotBook();
    const wheel = shareLot("wheel", 300, "wheel");
    book.open(wheel);
    const { closed, preferredContracts } = book.closePreferring(SHARES, -250, isWheelShares, 1);
    expect(closed).toEqual([{ lot: wheel, quantity: 250 }]);
    expect(preferredContracts).toBe(1);
    expect(wheel.remaining).toBe(50);
  });

  it("closes like close when no contract is given", () => {
    const book = new LotBook();
    const others = shareLot("others", 5, "others");
    const wheel = shareLot("wheel", 600, "wheel");
    book.open(others);
    book.open(wheel);
    expect(book.closePreferring(SHARES, -600, isWheelShares, 0).closed).toEqual([
      { lot: others, quantity: 5 },
      { lot: wheel, quantity: 595 },
    ]);
  });
});
```

Ajouter `isWheelShares` à l'import de `./book.ts` en tête de `book.test.ts`.

Dans `takeover.test.ts`, ajouter en fin de fichier :

```ts
describe("rachat de calls Wheel et vente d'actions au même instant", () => {
  const PUT = { right: "P" as const, strike: 12, expiry: "2026-06-19" };
  const PUT_SALE = "2026-05-04T14:30:00.000Z";
  const EXIT = "2026-08-20T14:19:06.000Z";

  /** `others` shares bought first, 600 delivered by puts, 6 covered calls sold. */
  const covered = (others: number) => [
    stock({ quantity: others, price: 10, when: BUY }),
    option({ ...PUT, quantity: -6, price: 1, when: PUT_SALE }),
    ...deliver({ ...PUT, quantity: 6 }),
    option({ ...CALL, quantity: -6, price: 0.5, when: SELL_CALL }),
  ];
  const openShares = (report: JournalsReport, strategy: string) =>
    shares(report, strategy).filter((r) => r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);

  it("sells the Wheel shares the bought-back calls covered, not the older Others lot", () => {
    const transactions = [
      ...covered(5),
      option({ ...CALL, quantity: 6, price: 2.6, when: EXIT }),
      stock({ quantity: -600, price: 15, when: EXIT }),
    ];
    const report = buildJournals(transactions);
    expect(openShares(report, "wheel")).toBe(0);
    expect(openShares(report, "others")).toBe(5);
    conserves(transactions);
  });

  it("sells from the Wheel only as many shares as calls were bought back, the rest in book order", () => {
    const transactions = [
      ...covered(300),
      option({ ...CALL, quantity: 6, price: 2.6, when: EXIT }),
      stock({ quantity: -800, price: 15, when: EXIT }),
    ];
    const report = buildJournals(transactions);
    expect(openShares(report, "wheel")).toBe(0);
    expect(openShares(report, "others")).toBe(100);
    conserves(transactions);
  });

  it("keeps book order for a sale with no call bought back at that instant", () => {
    // Guard: already true before sub-project 17.
    const transactions = [...covered(5), stock({ quantity: -600, price: 15, when: EXIT })];
    const report = buildJournals(transactions);
    expect(openShares(report, "others")).toBe(0);
    expect(openShares(report, "wheel")).toBe(5);
    conserves(transactions);
  });

  it("keeps book order when the call bought back at that instant is a LEAPS one", () => {
    // Guard: the priority belongs to Wheel calls only. 505 shares and 6 LEAPS: the
    // 6 calls match the LEAPS capacity exactly, so splitShortCall puts them in LEAPS.
    const LEAPS = { right: "C" as const, strike: 5, expiry: "2028-01-21" };
    const transactions = [
      stock({ quantity: 5, price: 10, when: BUY }),
      option({ ...PUT, quantity: -5, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 5 }),
      option({ ...LEAPS, quantity: 6, price: 7, when: "2026-07-01T14:30:00.000Z" }),
      option({ ...CALL, quantity: -6, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, quantity: 6, price: 2.6, when: EXIT }),
      stock({ quantity: -500, price: 15, when: EXIT }),
    ];
    const report = buildJournals(transactions);
    expect(report.rows.filter((r) => r.kind === "short_call").map((r) => r.strategy)).toEqual(["leaps"]);
    expect(openShares(report, "others")).toBe(0);
    expect(openShares(report, "wheel")).toBe(5);
    conserves(transactions);
  });
});
```

- [x] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger exec vitest run src/journals/book.test.ts src/journals/takeover.test.ts`
Expected: FAIL — `closePreferring` et `isWheelShares` n'existent pas (erreur d'import pour `book.test.ts`) ; « sells the Wheel shares… » rend `wheel` 5 et `others` 0 ; « sells from the Wheel only as many… » rend `wheel` 100 et `others` 0. Les deux garde-fous passent déjà (une fois `book.test.ts` compilable).

- [x] **Step 3: Implémenter**

Dans `book.ts`, après `interface OpenPosition` :

```ts
/** What `LotBook.closePreferring` closed, and how many contracts its first pass used. */
export interface PreferredClose {
  closed: ClosedPortion[];
  preferredContracts: number;
}

/** Long shares held by the Wheel: what a Wheel covered call makes leave first (spec 17, §4). */
export function isWheelShares(lot: Lot): boolean {
  return lot.strategy === "wheel" && lot.kind === "shares";
}
```

Dans `class LotBook`, après `close` :

```ts
  /**
   * Like `close`, but first serves, in book order, the lots `preferred` accepts,
   * up to `contracts` contracts of them — each lot counted with
   * `sharesPerContract` —, then closes what is left FIFO. A lot reached by both
   * passes comes back as one portion, so it makes one row. `preferredContracts`
   * is what the first pass used, for a caller whose limit spans several closes.
   */
  closePreferring(contract: ContractKey, quantity: number, preferred: (lot: Lot) => boolean, contracts: number): PreferredClose {
    const portions = new Map<Lot, number>();
    let left = Math.abs(quantity);
    let budget = contracts;
    for (const lot of this.openLots(contract)) {
      if (left === 0 || budget <= 0) break;
      if (Math.sign(lot.remaining) === Math.sign(quantity) || !preferred(lot)) continue;
      const per = sharesPerContract(lot);
      const take = Math.min(Math.abs(lot.remaining), left, budget * per);
      if (take <= 0) continue;
      lot.remaining -= Math.sign(lot.remaining) * take;
      left -= take;
      budget -= take / per;
      portions.set(lot, take);
    }
    const rest = left === 0 ? [] : this.close(contract, Math.sign(quantity) * left);
    for (const portion of rest) portions.set(portion.lot, (portions.get(portion.lot) ?? 0) + portion.quantity);
    return {
      closed: [...portions].map(([lot, closed]) => ({ lot, quantity: closed })),
      preferredContracts: contracts - budget,
    };
  }
```

Dans `replay.ts`, importer `isWheelShares` depuis `./book.ts` (compléter l'import existant de `./book.ts`) et `sharesContract` depuis `./contract.ts` s'il n'est pas déjà importé.

Dans `replayGroup`, remplacer la boucle des options et le début de la boucle des actions :

```ts
  // Contracts of Wheel covered calls bought back at this instant, per share
  // contract: a sale of those shares at the same instant sells Wheel shares
  // first, up to that many contracts (spec 17, §4.1).
  const wheelBuybacks = new Map<string, number>();
  for (const tx of options) {
    const contract = contractOf(tx);
    const quantity = tx.quantity ?? 0;
    const closed = ctx.book.close(contract, quantity);
    const closedQty = closed.reduce((n, c) => n + c.quantity, 0);
    if (closedQty > 0) closeOptions(tx, contract, closed, closedQty, byTx.get(tx) ?? null, ctx);
    if (!isSettlementShape(tx)) {
      const id = contractId(sharesContract(contract.ticker, contract.currency));
      for (const { lot, quantity: contracts } of closed) {
        if (lot.kind === "short_call" && lot.strategy === "wheel" && lot.cover === "shares") wheelBuybacks.set(id, (wheelBuybacks.get(id) ?? 0) + contracts);
      }
    }
    const rest = quantity - Math.sign(quantity) * closedQty;
    if (rest !== 0) openings.push({ tx, quantity: rest, orphan: closedQty === 0 && isSettlementShape(tx) });
  }
  classifyOpenings(openings, ctx);

  for (const tx of stocks) {
    const contract = contractOf(tx);
    const quantity = tx.quantity ?? 0;
    const whole = Math.abs(quantity);
    const left = quantity - Math.sign(quantity) * consumedShares(tx, pools);
    if (left === 0) continue;
    const budget = left < 0 ? (wheelBuybacks.get(contractId(contract)) ?? 0) : 0;
    const { closed, preferredContracts } = ctx.book.closePreferring(contract, left, isWheelShares, budget);
    if (preferredContracts > 0) wheelBuybacks.set(contractId(contract), budget - preferredContracts);
```

Le reste de la boucle des actions (`for (const portion of closed)`, `rest`, ouverture du lot) ne change pas.

- [x] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck && pnpm --filter @ib/ib-parsers test`
Expected: PASS, oracle inchangé.

- [x] **Step 5: Cocher les cases de la tâche 3 et committer**

```bash
git add packages/ledger/src/journals docs/plans/2026-09-16-wheel-part-juste.md
git commit -m "feat(ledger): une vente au rachat de calls Wheel vend d'abord les actions Wheel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: L'assignation d'un call Wheel livre d'abord des actions Wheel

**Files:**
- Modify: `packages/ledger/src/journals/replay.ts` (`deliverShares`)
- Test: `packages/ledger/src/journals/takeover.test.ts`

**Interfaces:**
- Consumes: `LotBook.closePreferring`, `isWheelShares` (tâche 3).

- [x] **Step 1: Écrire le test qui échoue**

Dans `takeover.test.ts`, ajouter en fin de fichier :

```ts
describe("assignation d'un call Wheel", () => {
  it("delivers Wheel shares, not the older Others lot ahead of them", () => {
    const PUT = { right: "P" as const, strike: 12, expiry: "2026-06-19" };
    const transactions = [
      stock({ quantity: 5, price: 10, when: BUY }),
      option({ ...PUT, quantity: -1, price: 1, when: "2026-05-04T14:30:00.000Z" }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      ...deliver({ ...CALL, quantity: 1 }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "wheel").map((r) => [r.quantity, r.closePrice, r.event])).toEqual([[100, 20, "sold"]]);
    expect(shares(report, "others").map((r) => [r.quantity, r.endWhen])).toEqual([[5, null]]);
    conserves(transactions);
  });
});
```

- [x] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `pnpm --filter @ib/ledger exec vitest run src/journals/takeover.test.ts`
Expected: FAIL — la livraison vend les 5 actions Autres et 95 actions Wheel.

- [x] **Step 3: Implémenter**

Dans `replay.ts`, au début de `deliverShares`, remplacer

```ts
  const closed = ctx.book.close(contract, delivery.sign * delivery.shares);
```

par

```ts
  // A Wheel covered call hands over Wheel shares first (spec 17, §4.2): the
  // Wheel may cover a call with shares ranked behind a lot it never took over.
  const wheelCall = delivery.sign < 0 && lot.kind === "short_call" && lot.strategy === "wheel" && lot.cover === "shares";
  const { closed } = ctx.book.closePreferring(contract, delivery.sign * delivery.shares, isWheelShares, wheelCall ? delivery.shares / delivery.ratio : 0);
```

- [x] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck && pnpm --filter @ib/ib-parsers test`
Expected: PASS, dont « delivers the shares the call covers, not the untouched remainder » (sous-projet 8), oracle inchangé.

- [x] **Step 5: Cocher les cases de la tâche 4 et committer**

```bash
git add packages/ledger/src/journals docs/plans/2026-09-16-wheel-part-juste.md
git commit -m "feat(ledger): l'assignation d'un call Wheel livre d'abord les actions Wheel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Les deux chronologies réelles, rejouées

**Files:**
- Test: `packages/ledger/src/journals/replay.test.ts`
- Sonde jetable, jamais committée : `apps/web/src/db/zz_probe.private.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède ; aucun code de production ne change, sauf si un test révèle un écart (alors : s'arrêter, diagnostiquer avec `superpowers:systematic-debugging`, et le rapporter).

- [x] **Step 1: Écrire les deux tests de chronologie**

Dans `replay.test.ts`, bloc `describe("buildJournals and corporate actions")`, ajouter (les tickers sont synthétiques ; les chronologies sont celles des §2.1 et §2.2 du spec) :

```ts
  const openSharesOf = (report: JournalsReport, strategy: string) =>
    report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy && r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);

  it("replays the chronology of spec 17 §2.1: 500 in the Wheel, 5 in Others", () => {
    const t = "ABC";
    const put = (strike: number, expiry: string) => ({ ticker: t, right: "P" as const, strike, expiry });
    const call = { ticker: t, right: "C" as const, strike: 13.5, expiry: "2025-10-31" };
    const exit = "2025-10-01T14:19:06.000Z";
    const report = buildJournals([
      stock({ ticker: t, quantity: 140, price: 10.9, when: "2023-12-14T18:25:27.000Z" }),
      stock({ ticker: t, quantity: -35, price: 17.5, when: "2024-02-16T14:30:03.000Z" }),
      option({ ...put(10, "2025-03-21"), quantity: -2, price: 0.83, when: "2025-02-11T15:36:51.000Z" }),
      stock({ ticker: t, quantity: 100, price: 10.77, when: "2025-02-11T15:46:32.000Z" }),
      ...deliver({ ...put(10, "2025-03-21"), quantity: 2 }),
      stock({ ticker: t, quantity: -200, price: 10.58, when: "2025-06-25T17:52:10.000Z" }),
      option({ ...put(12, "2025-08-15"), quantity: -3, price: 0.97, when: "2025-07-14T16:09:24.000Z" }),
      option({ ...put(12, "2025-08-29"), quantity: -3, price: 1.02, when: "2025-07-24T13:41:43.000Z" }),
      ...deliver({ ...put(12, "2025-08-15"), quantity: 3 }),
      ...deliver({ ...put(12, "2025-08-29"), quantity: 2, when: "2025-08-27T20:20:00.000Z" }),
      ...deliver({ ...put(12, "2025-08-29"), quantity: 1 }),
      option({ ...call, quantity: -6, price: 0.87, when: "2025-09-18T13:52:44.000Z" }),
      option({ ...call, quantity: 6, price: 2.63, when: exit }),
      stock({ ticker: t, quantity: -600, price: 15.28, when: exit }),
      option({ ...put(19, "2025-11-28"), quantity: -3, price: 2.34, when: "2025-10-16T15:37:13.000Z" }),
      ...deliver({ ...put(19, "2025-11-28"), quantity: 3, when: "2025-11-21T21:20:00.000Z" }),
    ]);
    expect(report.rows.filter((r) => r.event === "integrated")).toEqual([]);
    expect(openSharesOf(report, "wheel")).toBe(500);
    expect(openSharesOf(report, "others")).toBe(5);
  });

  it("replays the chronology of spec 17 §2.2: nothing in the Wheel, 75 in Others", () => {
    const call = (ticker: string, expiry: string) => ({ ticker, right: "C" as const, strike: 3, expiry });
    const report = buildJournals([
      stock({ ticker: "TESTV", quantity: 800, price: 0.7, when: "2023-01-09T16:27:00.000Z" }),
      stock({ ticker: "TESTV", quantity: 500, price: 1.2, when: "2023-11-10T18:30:00.000Z" }),
      stock({ ticker: "TESTV", quantity: -325, price: 1.5, when: "2023-12-05T15:49:00.000Z" }),
      option({ ...call("TESTV", "2026-04-17"), quantity: -9, price: 0.13, when: "2026-03-04T18:08:00.000Z" }),
      option({ ...call("TESTV", "2026-04-17"), quantity: 9, price: 0.05, when: "2026-03-26T15:32:00.000Z" }),
      caLeg("TESTP", 975, "2026-04-03T20:25:00.000Z"),
      caLeg("TESTV.OLD", -975, "2026-04-03T20:25:00.000Z"),
      option({ ...call("TESTP", "2026-05-15"), quantity: -9, price: 0.27, when: "2026-04-14T14:31:01.000Z" }),
      option({ ...call("TESTP", "2026-05-15"), quantity: 7, price: 0.98, when: "2026-05-06T16:00:21.000Z" }),
      stock({ ticker: "TESTP", quantity: -700, price: 3.93, when: "2026-05-06T16:00:21.000Z" }),
      option({ ...call("TESTP", "2026-05-15"), quantity: 2, price: 0.99, when: "2026-05-06T16:01:57.000Z" }),
      stock({ ticker: "TESTP", quantity: -200, price: 3.93, when: "2026-05-06T16:01:57.000Z" }),
    ]);
    // Only the takeover of 2026-03-04, of exactly 900 shares.
    expect(report.rows.filter((r) => r.event === "integrated").reduce((n, r) => n + (r.quantity ?? 0), 0)).toBe(900);
    expect(openSharesOf(report, "wheel")).toBe(0);
    expect(openSharesOf(report, "others")).toBe(75);
  });
```

Compléter les imports de `replay.test.ts` si besoin : `deliver`, `option`, `stock` depuis `./fixtures.ts`, `type JournalsReport` depuis `./types.ts`.

- [x] **Step 2: Lancer les tests**

Run: `pnpm --filter @ib/ledger exec vitest run src/journals/replay.test.ts`
Expected: PASS.

Prouver qu'ils mordent en remettant le moteur de `main` sous les tests, sans rien committer :

```bash
git checkout main -- packages/ledger/src/journals/book.ts packages/ledger/src/journals/takeover.ts packages/ledger/src/journals/classify.ts packages/ledger/src/journals/replay.ts
pnpm --filter @ib/ledger exec vitest run src/journals/replay.test.ts -t "chronology of spec 17"
git checkout HEAD -- packages/ledger/src/journals/book.ts packages/ledger/src/journals/takeover.ts packages/ledger/src/journals/classify.ts packages/ledger/src/journals/replay.ts
```

Expected : les deux tests échouent sur le moteur de `main` (Wheel 505 et Others 0 pour le premier ; une reprise de 975 actions et Wheel 75 pour le second), puis `git status --short` ne montre plus que `replay.test.ts` modifié.

- [x] **Step 3: Vérifier sur le compte réel par une sonde jetable**

Créer `apps/web/src/db/zz_probe.private.test.ts` : copier les lignes 1 à la fin de la fonction `cashChecks` de `alpha.private.test.ts` (ajouter `writeFileSync` à l'import de `node:fs`), puis :

```ts
describe.skipIf(!present)("probe", () => {
  it("dumps open shares per strategy", { timeout: 300_000 }, async () => {
    const { account } = await openAccount();
    for (const { name, text } of statementsOf(account.ibAccountId)) await importFile(db, account, asFile(name, text));
    const { report } = await journals();
    const tickers = (process.env.PROBE_TICKERS ?? "").split(",");
    const out = tickers.map((ticker) => {
      const open = (strategy: string) =>
        report.rows.filter((r) => r.ticker === ticker && r.kind === "shares" && r.strategy === strategy && r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);
      return `${ticker} wheel=${open("wheel")} others=${open("others")}`;
    });
    writeFileSync(process.env.PROBE_OUT!, out.join("\n"));
  });
});
```

Run (depuis `apps/web`, `<scratchpad>` = le répertoire scratchpad de la session) :
`PROBE_TICKERS=ZXAP,ZXAF PROBE_OUT=<scratchpad>/probe.txt npx vitest run src/db/zz_probe.private.test.ts && cat <scratchpad>/probe.txt`
Expected: `ZXAP wheel=500 others=5` et `ZXAF wheel=0 others=75`.

Supprimer la sonde : `rm apps/web/src/db/zz_probe.private.test.ts`, puis `git status --short` ne doit montrer ni la sonde ni aucun fichier de `private/`. Rapporter les deux lignes dans le rapport de tâche, jamais dans un fichier versionné.

- [x] **Step 4: Relancer toute la suite du moteur et le test privé**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ib-parsers test && pnpm --filter web exec vitest run src/db/alpha.private.test.ts`
Expected: PASS.

- [x] **Step 5: Cocher les cases de la tâche 5 et committer**

```bash
git add packages/ledger/src/journals/replay.test.ts docs/plans/2026-09-16-wheel-part-juste.md
git commit -m "test(ledger): les chronologies du sous-projet 17 rejouées

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Documentation et vérification finale

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/points-reportes.md`
- Modify: `docs/specs/2026-09-16-wheel-part-juste-design.md` (statut)

- [x] **Step 1: `CLAUDE.md`**

Dans la règle qui commence par « **Un call vendu sur des actions détenues est un call couvert** », remplacer la phrase « Les actions qu'il couvre entrent alors dans la wheel, **reprises au strike de ce call** : » par :

```markdown
Il couvre d'abord les actions déjà dans la Wheel et libres ; seules celles qui **manquent**
entrent alors dans la wheel, prises hors Wheel dans l'ordre du carnet et **reprises au strike
de ce call** :
```

et ajouter à la fin de cette même règle :

```markdown
**Un call Wheel fait sortir d'abord des actions Wheel** (`LotBook.closePreferring`) : à son
assignation, et quand une vente d'actions tombe au même instant que son rachat, dans la limite
des contrats rachetés. Toute autre vente reste FIFO. Le rang d'un lot est `rankWhen`, que les
deux morceaux d'une coupe héritent : une opération sur titres trie sur lui, jamais sur
`openWhen`.
```

Dans la table des sous-projets, ajouter après la ligne 16 :

```markdown
| 17 | La Wheel ne prend que ce qu'il faut | fait (<date du merge>) |
```

(`<date du merge>` s'écrit au merge, au format `2026-09-16`.)

- [x] **Step 2: `docs/points-reportes.md`**

Dans « Reporté par la reprise d'actions de la wheel (sous-projet 8) », supprimer les deux puces « **Le saut de `takeOverShares` est positionnel, pas nominatif.** … » et « **`insertByOpenWhen` retrie aussi les deux successeurs de la coupe elle-même** … ». Avant « ## Sans échéance », ajouter :

```markdown
## Reporté par le sous-projet 17 (la Wheel ne prend que ce qu'il faut)

- **« Même instant » est strict.** Un rachat de call Wheel et une vente d'actions passés en
  deux ordres séparés d'une seconde ne sont pas liés : la vente reste dans l'ordre du carnet.
  Aucun cas réel observé, alpha les passe à la même seconde.
- **Une vente d'actions Wheel sans rachat de call** reste dans l'ordre du carnet et peut
  vendre un reliquat Autres plus ancien. Voulu : rien ne dit que la vente appartient à la
  Wheel.
- **Une livraison ne choisit toujours pas nominativement les lots Wheel qui couvrent le
  call** : entre deux lots Wheel repris à des strikes différents, l'ordre du carnet décide. Le
  P/L reste dans la Wheel, seule sa répartition entre lignes peut s'intervertir.
```

Ajouter aussi à cette section tout point que la revue des tâches 1 à 5 a jugé non bloquant.

- [x] **Step 3: Statut du spec**

Dans `docs/specs/2026-09-16-wheel-part-juste-design.md`, remplacer `Statut : conçu (2026-09-16).` par `Statut : implémenté (2026-09-16).`

- [x] **Step 4: Vérification complète**

Run: `pnpm check`
Expected: PASS (lint, typecheck, fraîcheur du schéma, build, tests).

- [x] **Step 5: Cocher les cases de la tâche 6 et committer**

```bash
git add CLAUDE.md docs/points-reportes.md docs/specs/2026-09-16-wheel-part-juste-design.md docs/plans/2026-09-16-wheel-part-juste.md
git commit -m "docs: sous-projet 17 livré, règle du call couvert et dette à jour

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [x] **Step 6: Instance de relecture**

Dans le worktree : `pnpm dev:start`, puis donner à l'utilisateur les deux URL (`pnpm dev:status`). Il importe les relevés de alpha et regarde Positions → Wheel avant de décider du merge. Au merge : `pnpm dev:stop` **avant** `git merge` et `git worktree remove`.
