# Sous-projet 24 — L'assignation d'après minuit : plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — `superpowers:subagent-driven-development`.
> Les étapes sont des cases à cocher (`- [ ]`) : **cocher dans le worktree au fur et à mesure,
> dans le même commit que la tâche**. Le plan de la branche est l'état d'avancement ; une
> reprise de session repart de la première case non cochée.

**Objectif :** une assignation qu'IB traite après minuit, heure de New York, ne compte qu'une
fois dans le ledger, quel que soit l'ordre des synchros Flex et agent.

**Architecture :** une fonction pure `marketDayOf` dans `packages/ledger/src/filter.ts` rattache
une heure d'avant 04:00 au jour civil précédent, puis un week-end au vendredi. `planFlex` et
`planAgent` (`packages/ledger/src/import.ts`) la lisent **sur les lignes de l'agent seulement**,
et **sur la borne haute seulement**. Aucune autre couche ne change : ni parseur, ni schéma
Dexie, ni composant.

**Pile :** TypeScript, Vitest, monorepo pnpm. Aucune dépendance ajoutée.

**Spec :** `docs/specs/2026-09-19-assignation-apres-minuit-design.md` — la lire en entier avant
la tâche 1.

## Contraintes globales

- `MARKET_DAY_START_HOUR = 4` est défini **une seule fois**, dans `packages/ledger/src/filter.ts`.
- Les bornes `minDay`, `maxDay`, `flexDay` restent calculées avec `dayOf`. Jamais avec
  `marketDayOf`.
- Le plancher de `planFlex` (`day >= minDay`) reste en jour civil.
- Seules les lignes `source === "agent"` basculent en jour de marché. Une ligne `flex` ou
  `statement_html` garde son jour civil, des deux côtés.
- `planStatement` ne change pas du tout.
- Aucune migration Dexie, aucun changement de parseur, aucun changement d'affichage.
- Tout `when` du ledger est déjà l'heure murale de New York stampée UTC : `marketDayOf` ne fait
  **aucun** calcul de fuseau.
- Commits en français, sujet à l'impératif, comme le reste du dépôt. Terminer chaque message par
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `pnpm check` **une seule fois, à la tâche 4**. Pendant les tâches 1 à 3, uniquement les tests
  ciblés indiqués.

---

### Tâche 1 : `marketDayOf`

**Fichiers :**
- Modifier : `packages/ledger/src/filter.ts`
- Test : `packages/ledger/src/filter.test.ts`

**Interfaces :**
- Consomme : `dayOf(when: string): string`, déjà dans `filter.ts`.
- Produit : `marketDayOf(when: string): string` — rend `YYYY-MM-DD`. Exporté depuis
  `packages/ledger/src/filter.ts`, donc automatiquement depuis `@ib/ledger`
  (`src/index.ts` fait déjà `export * from "./filter.ts"` : **ne rien ajouter** à `index.ts`).
  La tâche 2 l'importe par `import { dayOf, marketDayOf } from "./filter.ts";`.

- [x] **Étape 1 : écrire le test qui échoue**

Ajouter à la fin de `packages/ledger/src/filter.test.ts`, et corriger la ligne d'import du haut
du fichier en `import { dayOf, marketDayOf } from "./filter.ts";` :

```ts
describe("marketDayOf", () => {
  it("keeps an ordinary session hour on its own day", () => {
    expect(marketDayOf("2026-09-22T10:00:00.000Z")).toBe("2026-09-22");
  });

  it("hands the small hours to the day before: IB books an assignment in the night that follows it", () => {
    expect(marketDayOf("2026-09-22T01:00:00.000Z")).toBe("2026-09-21");
    expect(marketDayOf("2026-09-22T03:59:59.999Z")).toBe("2026-09-21");
    expect(marketDayOf("2026-09-22T04:00:00.000Z")).toBe("2026-09-22");
  });

  it("walks a weekend back to the Friday, whatever the hour", () => {
    expect(marketDayOf("2026-09-19T01:02:45.000Z")).toBe("2026-09-18");
    expect(marketDayOf("2026-09-19T10:00:00.000Z")).toBe("2026-09-18");
    expect(marketDayOf("2026-09-20T18:00:00.000Z")).toBe("2026-09-18");
  });

  it("crosses the weekend from a Monday's small hours", () => {
    expect(marketDayOf("2026-09-21T01:00:00.000Z")).toBe("2026-09-18");
  });

  it("crosses a month and a year boundary", () => {
    expect(marketDayOf("2026-10-01T02:00:00.000Z")).toBe("2026-09-30");
    expect(marketDayOf("2026-01-01T02:00:00.000Z")).toBe("2025-12-31");
  });
});
```

Repères de calendrier, vérifiés : 2026-09-18 vendredi, 09-19 samedi, 09-20 dimanche,
09-21 lundi, 09-22 mardi, 09-30 mercredi, 2026-10-01 jeudi, 2025-12-31 mercredi.

- [x] **Étape 2 : lancer le test et vérifier qu'il échoue**

Depuis `packages/ledger` : `npx vitest run src/filter.test.ts`
Attendu : ÉCHEC, `marketDayOf` n'est pas exporté.

- [x] **Étape 3 : écrire l'implémentation minimale**

Ajouter à `packages/ledger/src/filter.ts`, après `dayOf` :

```ts
const MARKET_DAY_START_HOUR = 4;

/**
 * The market day a `when` belongs to. IB books an expiration's assignments in the night that
 * follows it, stamped at the hour it got to them — 01:02 on a Saturday for the Friday 16:20
 * that Flex reports. Those hours are the previous session's business, so anything before
 * 04:00 (the pre-market open) counts as the day before, and a day that lands on a weekend
 * walks back to the Friday. No holiday calendar: a weekday holiday is not covered, and
 * nothing has ever needed it. No time-zone maths either — every ledger `when` is already New
 * York's wall clock stamped UTC (ib-parsers' `toReportTime`).
 */
export function marketDayOf(when: string): string {
  const at = new Date(`${dayOf(when)}T00:00:00.000Z`);
  if (Number(when.slice(11, 13)) < MARKET_DAY_START_HOUR) at.setUTCDate(at.getUTCDate() - 1);
  while (at.getUTCDay() === 0 || at.getUTCDay() === 6) at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}
```

- [x] **Étape 4 : lancer le test et vérifier qu'il passe**

Depuis `packages/ledger` : `npx vitest run src/filter.test.ts`
Attendu : SUCCÈS, 6 tests (le `dayOf` existant compris).

- [x] **Étape 5 : commiter**

```bash
git add packages/ledger/src/filter.ts packages/ledger/src/filter.test.ts docs/plans/2026-09-19-assignation-apres-minuit.md
git commit -m "$(cat <<'EOF'
Ajouter marketDayOf : la nuit et le week-end appartiennent à la séance

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tâche 2 : `planFlex` et `planAgent` lisent le jour de marché

**Fichiers :**
- Modifier : `packages/ledger/src/import.ts` (ligne d'import, `planFlex` ~107-111, `planAgent` ~179)
- Test : `packages/ledger/src/import.test.ts`

**Interfaces :**
- Consomme : `marketDayOf` de la tâche 1.
- Produit : rien de neuf. `planImport`, `ImportPlan`, `ImportBatch` gardent leurs signatures.

**Ce que ce changement ne doit pas faire**, et qui est couvert par un test existant à ne pas
toucher : supprimer une ligne de relevé stampée `00:00:00` le lendemain du dernier jour Flex.
Le test `deletes rows of other sources over its whole days, bounds included` a une ligne
`html("next-day", "2026-03-06T00:00:00.000Z")` qui doit rester en vie. S'il devient rouge, la
bascule a été appliquée à toutes les sources au lieu de l'agent seul.

- [x] **Étape 1 : mettre à jour les deux tests existants que le comportement change**

Dans `packages/ledger/src/import.test.ts`, `describe("planImport from the agent")`, remplacer la
constante du bloc :

```ts
  const flexMax = "2026-09-08T20:00:00.000Z";
```

(mardi ; les fixtures actuelles tombaient un samedi et un dimanche, donc le même jour de marché,
ce qui rendait quatre des six tests du bloc vides de sens.)

Remplacer le premier test du bloc en entier :

```ts
  it("writes only the market days after Flex's last day: Flex reports that day in full", () => {
    const atBound = agent("at-bound", flexMax);
    const laterThatDay = agent("later-that-day", "2026-09-08T23:59:59.999Z");
    const overnight = agent("overnight", "2026-09-09T01:02:45.000Z");
    const nextDay = agent("next-day", "2026-09-09T09:30:00.000Z");
    const before = agent("before", "2026-09-08T19:59:59.000Z");
    const plan = planImport(existing, { source: "agent", transactions: [atBound, laterThatDay, overnight, nextDay, before], period: null });
    expect(plan.upsert).toEqual([nextDay]);
    expect(plan.skipped).toBe(4);
  });
```

Puis, dans le même bloc, déplacer les quatre dates de week-end restantes d'un jour de marché
utile — remplacements littéraux, un par occurrence :

- `agent("a", "2026-09-06T14:00:00.000Z")` → `agent("a", "2026-09-09T14:00:00.000Z")`
- `agent("gone", "2026-09-06T09:00:00.000Z")` → `agent("gone", "2026-09-09T09:00:00.000Z")`
- `agent("new", "2026-09-06T15:00:00.000Z")` → `agent("new", "2026-09-09T15:00:00.000Z")`
- `agent("x", "2026-09-06T15:00:00.000Z")` → `agent("x", "2026-09-09T15:00:00.000Z")` (deux
  occurrences, dans « is idempotent » et « returns a fresh array »)

Dans `describe("planImport from Flex, over agent rows")`, remplacer le corps du premier test :

```ts
  it("retires agent rows over its whole last market day: Flex replaces the day the agent wrote", () => {
    const existing = [
      agent("morning", "2026-09-08T14:00:00.000Z"),
      agent("after", "2026-09-08T20:00:00.001Z"),
      agent("overnight", "2026-09-09T01:02:45.000Z"),
      agent("next-day", "2026-09-09T09:30:00.000Z"),
    ];
    const incoming = [flex("1", "2026-09-01T10:00:00.000Z"), flex("2", "2026-09-08T20:00:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:morning", "agent:after", "agent:overnight"]);
    expect(plan.dropped).toEqual([{ kind: "trade", count: 3 }]);
  });
```

- [x] **Étape 2 : ajouter les quatre tests neufs**

Dans `describe("planImport from the agent")`, après le test
`leaves out an assignment Flex already dated at 16:20 that TWS reports in the evening` :

```ts
  it("leaves out an assignment IB only booked after midnight: that night is Friday's business", () => {
    const flexAssignment = [flex("put", "2026-09-18T16:20:00.000Z"), flex("stk", "2026-09-18T16:20:00.000Z")];
    const overnight = [agent("put", "2026-09-19T01:02:45.000Z"), agent("stk", "2026-09-19T01:02:45.000Z")];
    const plan = planImport(flexAssignment, { source: "agent", transactions: overnight, period: null });
    expect(plan.upsert).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("still writes the next real market day: Monday after a Friday expiry", () => {
    const flexAssignment = [flex("put", "2026-09-18T16:20:00.000Z")];
    const monday = agent("mon", "2026-09-21T09:35:00.000Z");
    const plan = planImport(flexAssignment, { source: "agent", transactions: [monday], period: null });
    expect(plan.upsert).toEqual([monday]);
    expect(plan.skipped).toBe(0);
  });
```

Dans `describe("planImport from Flex, over agent rows")`, après le test
`retires the evening assignment the agent wrote before Flex dated it at 16:20` :

```ts
  it("retires the assignment IB booked after midnight, which Flex dates 16:20 the day before", () => {
    const existing = [agent("put", "2026-09-19T01:02:45.000Z"), agent("stk", "2026-09-19T01:02:45.000Z")];
    const incoming = [
      flex("open", "2026-09-01T10:00:00.000Z"),
      flex("put", "2026-09-18T16:20:00.000Z"),
      flex("stk", "2026-09-18T16:20:00.000Z"),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:put", "agent:stk"]);
  });

  it("never shifts a row of another source: only TWS stamps the hour IB booked something", () => {
    const existing = [agent("overnight", "2026-09-19T01:02:45.000Z"), html("cash", "2026-09-19T00:00:00.000Z")];
    const incoming = [flex("open", "2026-09-01T10:00:00.000Z"), flex("last", "2026-09-18T16:20:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:overnight"]);
  });
```

- [x] **Étape 3 : lancer les tests et vérifier qu'ils échouent**

Depuis `packages/ledger` : `npx vitest run src/import.test.ts`
Attendu : ÉCHEC sur les six tests touchés ou ajoutés. Les vingt-quatre autres passent déjà.

- [x] **Étape 4 : écrire l'implémentation minimale**

Dans `packages/ledger/src/import.ts` :

```ts
import { dayOf, marketDayOf } from "./filter.ts";
```

Dans `planFlex`, le filtre `doomed` :

```ts
  const doomed = existing.filter((tx) => {
    if (tx.source === "flex") return false;
    const day = dayOf(tx.when);
    // Only the agent stamps the hour IB *booked* something, and IB books an expiration's
    // assignments in the night that follows it. Flex stamps 16:20 and a statement stamps the
    // transaction's own hour, or midnight when it gives none: shifting those would retire a
    // statement row dated the day after Flex's last one, which Flex will never replace.
    const upper = tx.source === "agent" ? marketDayOf(tx.when) : day;
    return day >= minDay && upper <= maxDay;
  });
```

Dans `planAgent`, la dernière ligne avant le `return` :

```ts
  const kept = flexDay === null ? [...incoming] : incoming.filter((tx) => marketDayOf(tx.when) > flexDay);
```

Réécrire aussi les deux commentaires de bloc qui énoncent l'ancienne règle :

- dans le commentaire de `planFlex`, la phrase « *And a response always runs to the previous
  close, so its newest day is complete too: whatever the agent reported that day, at whatever
  hour, Flex reports it as well.* » devient : la réponse court jusqu'à la clôture de la veille,
  donc son dernier **jour de marché** est complet — la nuit qui le suit comprise, où IB passe
  les assignations de l'échéance, et le week-end qui suit un vendredi.
- dans le commentaire de `planAgent`, « *writes only the days after Flex's newest day* » devient
  « only the **market** days after Flex's newest day », avec l'exemple de l'assignation d'un
  vendredi passée le samedi à 01:02 à côté de celle de 22:13 qui y est déjà.

- [x] **Étape 5 : lancer les tests et vérifier qu'ils passent**

Depuis `packages/ledger` : `npx vitest run`
Attendu : SUCCÈS, tous les fichiers du paquet. En particulier
`deletes rows of other sources over its whole days, bounds included` doit être **vert sans avoir
été touché**.

- [x] **Étape 6 : commiter**

```bash
git add packages/ledger/src/import.ts packages/ledger/src/import.test.ts docs/plans/2026-09-19-assignation-apres-minuit.md
git commit -m "$(cat <<'EOF'
Propriété de plage : l'agent bascule en jour de marché, Flex non

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tâche 3 : la chronologie réelle, de bout en bout

**Fichiers :**
- Test : `apps/web/src/agent/sync.test.ts` (ajouter un `describe` à la fin, ne rien modifier
  d'existant)

**Interfaces :**
- Consomme : `planImport` via `syncAgent`, déjà en place après la tâche 2. Les aides du fichier
  — `payload()`, `answer()`, `ok()`, `ACCOUNT`, `NOW`, le `beforeEach` qui vide les tables — sont
  déjà définies en haut du fichier et réutilisables telles quelles.
- Produit : rien. C'est un test de non-régression sur le chemin réel.

L'ordre inverse (Flex qui arrive après l'agent) est couvert au niveau de `planImport` par la
tâche 2 ; ce bloc couvre l'ordre agent-après-Flex de bout en bout, comme le fait déjà le bloc
`syncAgent over an assignment Flex already reported` pour le cas de 22:13.

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à la fin de `apps/web/src/agent/sync.test.ts` :

```ts
describe("syncAgent over an assignment IB only booked after midnight", () => {
  const ZKVA = {
    conId: 11, symbol: "ZKVA", localSymbol: "ZKVA", secType: "STK", right: "", strike: 0,
    lastTradeDateOrContractMonth: "", multiplier: "", currency: "USD",
  };
  const ZKVA_PUT = {
    conId: 12, symbol: "ZKVA", localSymbol: "ZKVA  260918P00025000", secType: "OPT", right: "P", strike: 25,
    lastTradeDateOrContractMonth: "20260918", multiplier: "100", currency: "USD",
  };
  const put: Pick<Transaction, "symbol" | "secType" | "right" | "strike" | "expiry"> = {
    symbol: "ZKVA  260918P00025000", secType: "OPT", right: "P", strike: 25, expiry: "2026-09-18",
  };
  const flexRow = (id: string, when: string, fields: Partial<Transaction>): Transaction => ({
    accountId: "beta", externalId: `flex:trade:${id}`, source: "flex", kind: "trade", symbol: "ZKVA", secType: "STK",
    right: "", strike: null, expiry: null, quantity: 0, price: 0, amount: 0, commission: 0, currency: "USD", when,
    description: "", ...fields,
  });
  const execution = (execId: string, contract: typeof ZKVA, shares: number, price: number, time: string) => ({
    execId, time, acctNumber: "U1234567", side: "BOT", shares, price, cumQty: shares, avgPrice: price, orderRef: "",
    contract, commission: null, commissionCurrency: null,
  });
  // Friday's expiry. Flex dates the assignment 16:20 on the 18th; IB only got to booking it at
  // 01:02:45 on the Saturday, New York time — 05:02:45 UTC, the hour TWS reports it at.
  const flexLedger = [
    flexRow("open", "2026-09-01T10:00:00.000Z", { ...put, quantity: -2, price: 1.1, amount: 220, commission: -1.3 }),
    flexRow("put", "2026-09-18T16:20:00.000Z", { ...put, quantity: 2 }),
    flexRow("stk", "2026-09-18T16:20:00.000Z", { quantity: 200, price: 25, amount: -5000 }),
  ];
  const overnightPass = payload({
    fetchedAt: "2026-09-19T16:12:05.000Z",
    positions: [{ ...ZKVA, position: 200, averageCost: 25, marketPrice: 26, marketValue: 5200, unrealizedPNL: 200 }],
    executions: [
      execution("put", ZKVA_PUT, 2, 0, "2026-09-19T05:02:45+00:00"),
      execution("stk", ZKVA, 200, 25, "2026-09-19T05:02:45+00:00"),
    ],
  });

  it("writes none of it, and the ledger reconciles with the live snapshot", async () => {
    await db.transactions.bulkPut(flexLedger);
    const outcome = await syncAgent(ok(overnightPass), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 0, positions: 1 });

    const ledger = await db.transactions.where("accountId").equals("beta").toArray();
    expect(ledger.map((row) => row.externalId).sort()).toEqual(["flex:trade:open", "flex:trade:put", "flex:trade:stk"]);
    const snapshot = await db.snapshots.get("beta");
    expect(snapshot?.asOf).toBe("2026-09-19T12:12:05.000Z");
    const report = buildJournals(ledger, { asOf: snapshot!.asOf, positions: snapshot!.positions });
    expect(report.reconciliation.differences).toEqual([]);
  });

  it("still writes Monday's fill, the first market day Flex does not own", async () => {
    await db.transactions.bulkPut(flexLedger);
    const monday = payload({ executions: [execution("buy", ZKVA, 10, 26, "2026-09-21T13:35:00+00:00")] });
    const outcome = await syncAgent(ok(monday), ACCOUNT);
    expect(outcome).toMatchObject({ status: "ok", transactions: 1 });
    expect((await db.transactions.get(["beta", "agent:buy"]))?.when).toBe("2026-09-21T09:35:00.000Z");
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue sur la bonne assertion**

Depuis `apps/web` : `npx vitest run src/agent/sync.test.ts`

Si la tâche 2 est déjà commitée, ce test doit **passer du premier coup** : c'est alors un test
de non-régression, pas un test rouge. Le vérifier en le lançant sur le commit précédent :

```bash
git checkout HEAD~1 -- packages/ledger/src/import.ts   # l'ancienne règle, un instant
npx vitest run src/agent/sync.test.ts                  # doit ÉCHOUER
git checkout HEAD -- packages/ledger/src/import.ts     # remettre la nouvelle
```

Attendu sur l'ancien `import.ts` : ÉCHEC — `transactions: 2` au lieu de `0`, et
`reconciliation.differences` non vide.

**Ne jamais utiliser `git stash` ici** : la pile de stash est partagée avec le checkout
principal et les autres worktrees. Les trois commandes ci-dessus n'en ont pas besoin.

Si `reconciliation.differences` n'est pas vide **avec** le nouveau `import.ts`, c'est la graine
du test qui est fausse, pas le moteur : vérifier que le ledger Flex ferme bien le put (−2 puis
+2) et livre 200 actions au strike, et que le snapshot en porte 200.

- [ ] **Étape 3 : lancer la suite du paquet**

Depuis `apps/web` : `npx vitest run src/agent/`
Attendu : SUCCÈS, aucun test existant touché.

- [ ] **Étape 4 : commiter**

```bash
git add apps/web/src/agent/sync.test.ts docs/plans/2026-09-19-assignation-apres-minuit.md
git commit -m "$(cat <<'EOF'
Fixer de bout en bout l'assignation passée après minuit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tâche 4 : documentation et vérification complète

**Fichiers :**
- Modifier : `CLAUDE.md`, `docs/specs/2026-09-03-architecture-design.md` (§6.2 et §12),
  `docs/points-reportes.md`, `docs/specs/2026-09-19-assignation-apres-minuit-design.md` (statut)

**Interfaces :** aucune.

- [ ] **Étape 1 : spec fondateur §6.2**

Dans `docs/specs/2026-09-03-architecture-design.md`, section « 6.2 Propriété de plage » :

- la puce « **L'agent n'écrit qu'après** le dernier jour Flex, en jours entiers : une réponse
  Flex court jusqu'à la clôture de la veille, son dernier jour est complet. » devient : l'agent
  n'écrit qu'après le dernier **jour de marché** Flex. Le jour de marché d'une heure d'avant
  04:00 est la veille, et celui d'un samedi ou d'un dimanche le vendredi précédent : IB passe
  les assignations d'une échéance dans la nuit qui la suit, parfois après minuit. Seules les
  lignes de l'agent sont lues ainsi ; Flex et les relevés gardent leur jour civil.
- au paragraphe « **Une seule horloge** (sous-projet 18) », ajouter la phrase qui manquait :
  la même horloge ne suffit pas, il faut encore que la nuit qui suit une séance lui appartienne
  (sous-projet 24) — sinon une assignation passée à 01:02 le samedi échappe au vendredi que Flex
  possède.

- [ ] **Étape 2 : spec fondateur §12**

Ajouter la ligne 24 au tableau des sous-projets : « L'assignation d'après minuit : propriété de
plage en jour de marché » — fait (2026-09-19).

- [ ] **Étape 3 : `CLAUDE.md`**

- Dans la règle « **Propriété de plage, jamais comparaison de contenu** », après la phrase sur
  `fromDate`, ajouter : la borne haute se lit en **jour de marché** pour les seules lignes de
  l'agent — avant 04:00 la veille, un week-end le vendredi —, parce qu'IB passe les assignations
  d'une échéance dans la nuit qui la suit. `marketDayOf` et `MARKET_DAY_START_HOUR` vivent dans
  `packages/ledger/src/filter.ts`.
- Dans la règle qui commence par « **Toute heure IB est l'heure murale de New York** », remplacer
  « l'agent n'écrit qu'après le dernier jour Flex » par « après le dernier jour **de marché**
  Flex », en gardant l'exemple de 16:20 et en ajoutant celui du samedi 01:02.
- Ajouter la ligne 24 au tableau des sous-projets, même libellé qu'à l'étape 2.

- [ ] **Étape 4 : `docs/points-reportes.md`**

La ligne du recouvrement relevés + agent **sans aucune ligne Flex** : la garder, et noter qu'elle
a été revue au sous-projet 24 et reportée délibérément — `planAgent` ne filtre rien quand
`flexMax === null`, `planStatement` ne supprime jamais une ligne agent, et aucun compte réel
n'est dans ce cas.

- [ ] **Étape 5 : statut de la spec**

Dans `docs/specs/2026-09-19-assignation-apres-minuit-design.md`, remplacer
`Statut : spécifié (2026-09-19).` par `Statut : implémenté (2026-09-19).`

- [ ] **Étape 6 : vérification complète**

Depuis la racine du worktree : `pnpm check`
Attendu : SUCCÈS — lint, typage, build, tous les tests. C'est le seul `pnpm check` du
sous-projet.

- [ ] **Étape 7 : commiter**

```bash
git add CLAUDE.md docs/
git commit -m "$(cat <<'EOF'
Documenter le sous-projet 24 : le jour de marché

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Étape 8 : démarrer l'instance de dev du worktree pour la relecture**

Depuis la racine du worktree : `pnpm dev:start`, puis donner à Seb les deux URL (Vite et Django,
sur les ports du worktree). L'instance **reste démarrée** ; elle ne sera arrêtée qu'au merge, par
`pnpm dev:stop` **avant** `git merge` et `git worktree remove`.

Note de relecture pour Seb : ce sous-projet ne change aucun pixel. Ce qu'il y a à regarder est la
page Consistance des deux comptes **après** une synchro Flex — et cette synchro ne peut pas se
faire depuis le worktree sans y rejouer tes imports. La vérification réelle se fera sur `main`
après le merge, au bouton « Synchroniser ».
