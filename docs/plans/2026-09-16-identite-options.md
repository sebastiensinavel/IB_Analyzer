# Sous-projet 10 — Identité des options sans Flex : plan d'implémentation

> **Pour les agents :** SOUS-SKILL OBLIGATOIRE — exécuter ce plan tâche par tâche avec
> `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`.
> Les cases `- [ ]` suivent l'avancement : **elles se cochent dans le worktree, au fur et à
> mesure, dans le même commit que la tâche**. Une reprise de session part de la première case
> non cochée, jamais d'une reconstitution à partir des commits.

**But :** relevés seuls ou agent seul, les journaux donnent exactement ce que donne Flex — une
option renommée par IB est un seul contrat, quelle que soit la source.

**Architecture :** une transaction d'option nommée par son sous-jacent reconstruit sa forme OSI
empaquetée à partir de ses propres termes, et interroge la table d'identité avec elle
(`canonicalize`). Une règle 9 s'ajoute aux préconditions de `buildIdentities` : la conversion
1 pour 1 d'un sous-jacent greffe l'ancienne orthographe sur la classe d'option du nouveau
ticker, sur preuve qu'une telle classe existe. L'agent publie enfin la forme OSI que TWS lui
donne déjà dans `localSymbol`. Rien n'est stocké : la résolution reste une vue calculée au rejeu.

**Technique :** TypeScript, pnpm workspaces, Vitest. `packages/ledger` (moteur),
`packages/ib-parsers` (sources et fixtures), `apps/web` (test privé seulement).

**Spec :** `docs/specs/2026-09-16-identite-options-design.md` — le plan argumente depuis ce
document ; les deux se lisent ensemble.

## Contraintes globales

- **Aucune donnée réelle dans un fichier versionné** : les fixtures de ce plan sont
  entièrement inventées (`U0000002`, `TSTA`, `TSTB`, `TSTC`). Jamais un identifiant de compte,
  un jeton ou un montant réel.
- **Les trois oracles ne bougent pas d'un octet** : `journals.oracle.test.ts`,
  `corpus.oracle.test.ts`, `cash.oracle.test.ts`, plus l'oracle de `packages/coverage`. Un
  écart est un bug de la tâche en cours, jamais un attendu à mettre à jour.
- **Le ledger stocké n'est pas touché** : pas de version de schéma Dexie, pas de migration,
  `Transaction.symbol` garde ce que la source a écrit.
- **`packages/ledger` ne peut pas importer `@ib/ib-parsers`** ; la dépendance va dans l'autre
  sens.
- **Une valeur absente reste `null`**, jamais `0`.
- `pnpm check` à la racine avant le merge. Messages de commit en français, terminés par
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Préalable : le worktree

Avant la tâche 1, créer le worktree avec `superpowers:using-git-worktrees` :
`.claude/worktrees/identite-options`, branche `identite-options`, depuis `main`. Tout ce qui
suit se fait dedans ; le worktree prend son propre port et sa propre base
(`tools/dev-env/ports.mjs`), il n'y a jamais de port à coder en dur.

---

## Tâche 1 : la forme OSI d'une option décrite par ses termes

**Fichiers :**
- Modifier : `packages/ledger/src/journals/contract.ts`
- Test : `packages/ledger/src/journals/contract.test.ts`

**Interfaces :**
- Consomme : `isPackedOptionSymbol`, `OSI_SYMBOL` (déjà dans le fichier).
- Produit : `packedOptionSymbol(ticker: string, expiry: string | null, right: "C" | "P" | "",
  strike: number | null): string | null`, `optionTerms(symbol: string): string`,
  `expiryOfPacked(symbol: string): string | null`,
  `respellPackedOption(symbol: string, root: string): string | null`. Les tâches 2 et 3 s'en
  servent.

- [x] **Étape 1 : écrire les tests qui échouent**

Ajouter à la fin de `packages/ledger/src/journals/contract.test.ts` :

```ts
describe("packedOptionSymbol", () => {
  it("rebuilds the spelling Flex writes, from what a statement gives", () => {
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", 12.5)).toBe("TSTA  260116C00012500");
    expect(packedOptionSymbol("TSTC", "2027-01-15", "C", 2.5)).toBe("TSTC  270115C00002500");
  });

  it("leaves no padding space for a six-character root", () => {
    expect(packedOptionSymbol("ABCDEF", "2026-04-17", "P", 1)).toBe("ABCDEF260417P00001000");
  });

  it("is always a packed spelling, by the engine's own test", () => {
    expect(isPackedOptionSymbol(packedOptionSymbol("TSTA", "2026-01-16", "C", 12.5)!)).toBe(true);
  });

  it("refuses to invent a name it cannot spell", () => {
    // A root longer than six characters, or carrying anything but letters and
    // digits, has no OSI form at all; so has an option missing a term.
    expect(packedOptionSymbol("TOOLONGX", "2026-01-16", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("BRK.B", "2026-01-16", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("", "2026-01-16", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", null, "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", "16/01/2026", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", "2026-01-16", "", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", null)).toBeNull();
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", 0)).toBeNull();
    // A strike finer than a thousandth would not survive the eight digits.
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", 1.23456)).toBeNull();
  });
});

describe("optionTerms, expiryOfPacked and respellPackedOption", () => {
  it("reads the terms and the expiry of a packed spelling", () => {
    expect(optionTerms("TSTA  260116C00012500")).toBe("260116C00012500");
    expect(expiryOfPacked("TSTA  260116C00012500")).toBe("2026-01-16");
  });

  it("has no expiry to give for a spelling that is not packed", () => {
    expect(expiryOfPacked("TSTA")).toBeNull();
  });

  it("puts the same terms under another root, and refuses a root it cannot spell", () => {
    expect(respellPackedOption("TSTC  270115C00002500", "TSTB")).toBe("TSTB  270115C00002500");
    expect(respellPackedOption("TSTC  270115C00002500", "TOOLONGX")).toBeNull();
    expect(respellPackedOption("TSTC", "TSTB")).toBeNull();
  });
});
```

Compléter l'import en tête du fichier de test avec `packedOptionSymbol`, `optionTerms`,
`expiryOfPacked`, `respellPackedOption` et `isPackedOptionSymbol` s'ils n'y sont pas déjà.

- [x] **Étape 2 : vérifier que les tests échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/contract.test.ts
```

Attendu : ÉCHEC, `packedOptionSymbol is not a function` (ou une erreur de type au chargement).

- [x] **Étape 3 : écrire l'implémentation**

Ajouter dans `packages/ledger/src/journals/contract.ts`, juste après `isPackedOptionSymbol` :

```ts
/** An OSI root: up to six letters or digits, nothing else. */
const OSI_ROOT = /^[A-Za-z0-9]{1,6}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The packed OSI spelling of an option described the way a statement or the
 * agent describes it — its underlying in `symbol`, its terms in their own
 * fields — or `null` when the description cannot produce one.
 *
 * Rebuilding a name is not inventing an alias: the identity table is still
 * fed by the sources alone (spec §3.1). This only gives the engine the key
 * those sources never write.
 */
export function packedOptionSymbol(
  ticker: string,
  expiry: string | null,
  right: "C" | "P" | "",
  strike: number | null,
): string | null {
  const root = ticker.trim();
  if (!OSI_ROOT.test(root)) return null;
  if (right !== "C" && right !== "P") return null;
  if (expiry === null || !ISO_DAY.test(expiry)) return null;
  if (strike === null || !Number.isFinite(strike) || strike <= 0) return null;
  const thousandths = Math.round(strike * 1000);
  // A strike finer than a thousandth has no OSI spelling; rounding it would
  // name another contract.
  if (Math.abs(strike * 1000 - thousandths) > 1e-6 || thousandths > 99_999_999) return null;
  const [year, month, day] = expiry.split("-");
  return `${root.padEnd(6, " ")}${year.slice(2)}${month}${day}${right}${String(thousandths).padStart(8, "0")}`;
}

/** Everything a packed spelling says after its root: expiry, right and strike. */
export function optionTerms(symbol: string): string {
  return symbol.slice(6);
}

/** "TSTC  270115C00002500" -> "2027-01-15"; `null` when the spelling is not packed. */
export function expiryOfPacked(symbol: string): string | null {
  if (!isPackedOptionSymbol(symbol)) return null;
  const terms = optionTerms(symbol);
  return `20${terms.slice(0, 2)}-${terms.slice(2, 4)}-${terms.slice(4, 6)}`;
}

/** The same option terms under another root; `null` when either side has no OSI form. */
export function respellPackedOption(symbol: string, root: string): string | null {
  const trimmed = root.trim();
  if (!isPackedOptionSymbol(symbol) || !OSI_ROOT.test(trimmed)) return null;
  return `${trimmed.padEnd(6, " ")}${optionTerms(symbol)}`;
}
```

- [x] **Étape 4 : vérifier que les tests passent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/contract.test.ts
pnpm --filter @ib/ledger test
```

Attendu : PASS partout. `contract.ts` est exporté par `journals/index.ts` via `export *`, donc
les quatre fonctions sortent du paquet sans rien ajouter.

- [x] **Étape 5 : commit**

```bash
git add packages/ledger/src/journals/contract.ts packages/ledger/src/journals/contract.test.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
feat(ledger): une option décrite par ses termes retrouve sa forme OSI

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 2 : le rejeu cherche la forme reconstruite

**Fichiers :**
- Modifier : `packages/ledger/src/journals/replay.ts:81-89` (la fonction `canonicalize`)
- Test : `packages/ledger/src/journals/replay.test.ts`

**Interfaces :**
- Consomme : `packedOptionSymbol`, `optionTerms` (tâche 1), `tickerOf`,
  `isPackedOptionSymbol`, `ContractIdentities.canonical`.
- Produit : rien de nouveau à l'extérieur. `buildJournals` résout désormais les options
  nommées par leur sous-jacent.

- [x] **Étape 1 : écrire les tests qui échouent**

Ajouter à la fin de `packages/ledger/src/journals/replay.test.ts` :

```ts
describe("canonicalize on an option named by its underlying", () => {
  // A statement names an option by its underlying and puts the terms in their
  // own columns; the packed spelling below is what the same contract wears in
  // Contract Information, under one conid and two names.
  const option = (symbol: string, when: string, quantity: number, price: number): Transaction => ({
    accountId: "test",
    externalId: `html:${symbol}${when}`,
    source: "statement_html",
    kind: "trade",
    symbol,
    secType: "OPT",
    right: "C",
    strike: 12.5,
    expiry: "2026-01-16",
    quantity,
    price,
    amount: -quantity * price * 100,
    commission: -1.06,
    currency: "USD",
    when,
    description: `${symbol} 16JAN26 12.5 C`,
  });

  const transactions = [
    option("TSTA", "2025-03-10T10:00:00.000Z", 3, 7.33),
    option("TSTA1", "2025-11-20T10:00:00.000Z", -3, 4),
  ];

  const identitiesOf = (aliases: string[]) =>
    buildIdentities([
      {
        conid: "700000010",
        secType: "OPT",
        isin: "",
        aliases: aliases.map((ticker) => ({ ticker, firstSeen: "2025-01-01", lastSeen: "2025-12-31" })),
      },
    ]);

  it("files both spellings on one contract, the canonical one", () => {
    const report = buildJournals(transactions, undefined, identitiesOf(["TSTA  260116C00012500", "TSTA1 260116C00012500"]));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].ongoing).toBe(false);
    expect(report.rows[0].contract.ticker).toBe("TSTA1");
  });

  it("leaves both alone when no table knows them", () => {
    const report = buildJournals(transactions);
    expect(report.rows.map((row) => row.contract.ticker).sort()).toEqual(["TSTA", "TSTA1"]);
  });

  it("refuses a canonical whose terms are not the transaction's own", () => {
    // A class that spells two different contracts would move the lot onto
    // terms nobody traded: the engine keeps the name the source wrote.
    const report = buildJournals(transactions, undefined, identitiesOf(["TSTA  260116C00012500", "TSTA1 270115C00002500"]));
    expect(report.rows.map((row) => row.contract.ticker).sort()).toEqual(["TSTA", "TSTA1"]);
  });
});
```

Vérifier que le fichier importe `buildIdentities` depuis `./identities.ts` et `Transaction`
depuis `../types.ts` ; les ajouter à l'import s'ils manquent.

- [x] **Étape 2 : vérifier que les tests échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/replay.test.ts
```

Attendu : ÉCHEC du premier test — 2 lignes au lieu d'une, `contract.ticker` valant `TSTA` et
`TSTA1`. Les deux autres passent déjà : ils fixent ce qui ne doit pas changer.

- [x] **Étape 3 : écrire l'implémentation**

Dans `packages/ledger/src/journals/replay.ts`, compléter l'import de `./contract.ts` avec
`optionTerms` et `packedOptionSymbol`, puis remplacer `canonicalize` par :

```ts
/**
 * The spelling the identity table knows a transaction's contract under.
 *
 * A stock wears its ticker. An option wears its packed OCC symbol, which Flex
 * writes but statements and the agent do not: they name the option by its
 * underlying and leave the terms in their own fields, from which the same
 * spelling is rebuilt (spec §4.2). Anything else — cash, warrants, a row with
 * no `secType` — has no identity to resolve.
 */
function identityKey(tx: Transaction): string | null {
  if (tx.secType === "STK") return tx.symbol;
  if (tx.secType !== "OPT") return null;
  if (isPackedOptionSymbol(tx.symbol)) return tx.symbol;
  return packedOptionSymbol(tickerOf(tx.symbol), tx.expiry, tx.right, tx.strike);
}

/**
 * Rewrites every trade's contract name to its class's canonical one.
 *
 * Only the root may change on an option: a canonical whose terms differ names
 * another contract entirely, and moving the lot there would invent a position
 * nobody holds. A Flex row keeps the packed form it came with, a statement or
 * agent row keeps the shape of its own source — both give `contractOf` the
 * same ticker, hence the same `contractId`.
 *
 * Corporate action rows are left alone, although they are `STK`: their two
 * legs must be resolved at two different instants (`resolveLegs` below), and
 * their tickers are read from the description rather than from `symbol`
 * anyway (`pairCorporateActions`).
 */
function canonicalize(transactions: readonly Transaction[], identities: ContractIdentities): Transaction[] {
  return transactions.map((tx) => {
    if (tx.kind === "corporate_action") return tx;
    const key = identityKey(tx);
    if (key === null) return tx;
    const canonical = identities.canonical(key, tx.when);
    if (canonical === key) return tx;
    if (tx.secType === "STK") return { ...tx, symbol: canonical };
    if (optionTerms(canonical) !== optionTerms(key)) return tx;
    return { ...tx, symbol: isPackedOptionSymbol(tx.symbol) ? canonical : tickerOf(canonical) };
  });
}
```

- [x] **Étape 4 : vérifier que les tests passent, et que les oracles n'ont pas bougé**

```bash
pnpm --filter @ib/ledger test
pnpm --filter @ib/ib-parsers test
```

Attendu : PASS partout, `journals.oracle.test.ts`, `corpus.oracle.test.ts` et
`cash.oracle.test.ts` compris. Un oracle qui bouge ici est un bug de cette tâche.

- [x] **Étape 5 : commit**

```bash
git add packages/ledger/src/journals/replay.ts packages/ledger/src/journals/replay.test.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
feat(ledger): une option nommée par son sous-jacent interroge la table d'identité

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 3 : règle 9, l'option suit la conversion 1:1 de son sous-jacent

**Fichiers :**
- Modifier : `packages/ledger/src/journals/identities.ts:192-238` (`buildIdentities`)
- Modifier : `packages/ledger/src/journals/corporate.ts` (accueille `justBefore`)
- Modifier : `packages/ledger/src/journals/replay.ts:99-102` (importe `justBefore` au lieu de
  le définir)
- Test : `packages/ledger/src/journals/identities.test.ts`

**Interfaces :**
- Consomme : `expiryOfPacked`, `respellPackedOption`, `isPackedOptionSymbol`, `tickerOf`
  (tâche 1), `withoutOldSuffix` et `CorporateActionEvent` (`corporate.ts`).
- Produit : `justBefore(when: string): string`, désormais exporté par `corporate.ts`.
  `buildIdentities` garde exactement sa signature.

- [x] **Étape 1 : déplacer `justBefore`, sans changer un comportement**

Couper `justBefore` de `replay.ts` (avec son commentaire) et le coller dans `corporate.ts`,
exporté :

```ts
/**
 * The instant just before `when`. Rule 4 of §5.2 hands an ambiguous ticker
 * its *after* name from the event's own instant, bounds included — right for
 * the leg a corporate action brings in, wrong for the leg it takes out, whose
 * lots are filed under the name the contract wore before. One millisecond is
 * the finest grain any of our sources timestamps, so nothing can fall in the
 * gap; an unparseable instant simply resolves as it always did.
 */
export function justBefore(when: string): string {
  const at = Date.parse(when);
  return Number.isNaN(at) ? when : new Date(at - 1).toISOString();
}
```

Dans `replay.ts`, ajouter `justBefore` à l'import de `./corporate.ts`.

- [x] **Étape 2 : extraire `resolve` de `buildIdentities`, sans changer un comportement**

Dans `identities.ts`, renommer le corps actuel de `buildIdentities` en `resolve`, et laisser
`buildIdentities` l'appeler :

```ts
/** Rules 1 to 6, applied to the classes rules 7 and 8 have settled. */
function resolve(contracts: readonly IdentityInput[], events: readonly CorporateActionEvent[]): ContractIdentities {
  // ... corps actuel, à partir de `const claims = new Map<string, string[]>();`
  // et jusqu'au `return { canonical: …, issues };`, inchangé.
}

export function buildIdentities(inputs: readonly IdentityInput[], events: readonly CorporateActionEvent[] = []): ContractIdentities {
  const contracts = namedContracts(graftActionAliases(inputs, events));
  return resolve(contracts, events);
}
```

```bash
pnpm --filter @ib/ledger test
pnpm --filter @ib/ib-parsers test
```

Attendu : PASS partout, sans qu'un seul test ait été modifié — c'est ce qui prouve que
l'extraction ne change rien.

- [x] **Étape 3 : commit de la préparation**

```bash
git add packages/ledger/src/journals/identities.ts packages/ledger/src/journals/corporate.ts packages/ledger/src/journals/replay.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
refactor(ledger): resolve et justBefore extraits, sans changement de comportement

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [x] **Étape 4 : écrire les tests qui échouent**

Ajouter à la fin de `packages/ledger/src/journals/identities.test.ts` :

```ts
describe("buildIdentities on an option whose underlying was converted 1 for 1 (rule 9)", () => {
  // TSTB became TSTC on 2026-04-03, a pure 1-for-1 merger. The option kept its
  // conid and merely changed spelling — but the statement was written after the
  // event, so its Contract Information knows only the new name. Nothing but the
  // event says the option was ever called TSTB.
  const OLD_ISIN = "US0000000012";
  const NEW_ISIN = "US0000000013";
  const WHEN_9 = "2026-04-03T20:25:00.000Z";
  const OPTION_OLD = "TSTB  270115C00002500";
  const OPTION_NEW = "TSTC  270115C00002500";

  const stocks = [
    input("700000021", [["TSTB", "2026-01-01", "2026-12-31"], ["TSTB.OLD", "2026-01-01", "2026-12-31"]], "STK", OLD_ISIN),
    input("700000022", [["TSTC", "2026-01-01", "2026-12-31"]], "STK", NEW_ISIN),
  ];
  const option = input("700000023", [[OPTION_NEW, "2026-01-01", "2026-12-31"]], "OPT");
  const event = {
    when: WHEN_9,
    from: { ticker: "TSTB.OLD", isin: OLD_ISIN, quantity: -975 },
    to: { ticker: "TSTC", isin: NEW_ISIN, quantity: 975 },
    cash: null,
    ids: [],
  };

  it("grafts the old spelling onto the option's class, and resolves it", () => {
    const identities = buildIdentities([...stocks, option], [event]);
    expect(identities.canonical(OPTION_OLD, "2026-03-04T13:06:53.000Z")).toBe(OPTION_NEW);
    expect(identities.canonical(OPTION_NEW, "2026-05-21T12:07:48.000Z")).toBe(OPTION_NEW);
    expect(identities.issues).toEqual([]);
  });

  it("does nothing at all without the event: the graft is what links them", () => {
    const identities = buildIdentities([...stocks, option]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses a merger that pays cash: the new contract is not the old one continued", () => {
    const identities = buildIdentities([...stocks, option], [{ ...event, cash: { amount: 1290.40, realizedPnl: 180.40 } }]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses a ratio that is not 1: the option's terms would have been adjusted", () => {
    const identities = buildIdentities([...stocks, option], [{ ...event, to: { ...event.to, quantity: 100 } }]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
  });

  it("refuses an option already expired when the event happened", () => {
    const expired = input("700000024", [["TSTC  260101C00002500", "2026-01-01", "2026-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, expired], [event]);
    expect(identities.canonical("TSTB  260101C00002500", WHEN_9)).toBe("TSTB  260101C00002500");
  });

  it("refuses a spelling another class already claims: the file knows better", () => {
    const other = input("700000025", [[OPTION_OLD, "2025-01-01", "2025-12-31"]], "OPT");
    const identities = buildIdentities([...stocks, option, other], [event]);
    expect(identities.canonical(OPTION_OLD, WHEN_9)).toBe(OPTION_OLD);
    expect(identities.issues).toEqual([]);
  });

  it("refuses a departure root that has no OSI spelling", () => {
    const longStocks = [
      input("700000021", [["TOOLONGX", "2026-01-01", "2026-12-31"]], "STK", OLD_ISIN),
      input("700000022", [["TSTC", "2026-01-01", "2026-12-31"]], "STK", NEW_ISIN),
    ];
    const identities = buildIdentities([...longStocks, option], [{ ...event, from: { ...event.from, ticker: "TOOLONGX" } }]);
    expect(identities.canonical(OPTION_NEW, WHEN_9)).toBe(OPTION_NEW);
    expect(identities.issues).toEqual([]);
  });

  it("does not let the grafted spelling become the class's canonical name", () => {
    const identities = buildIdentities([...stocks, option], [event]);
    expect(identities.canonical(OPTION_NEW, "2026-12-31T00:00:00.000Z")).toBe(OPTION_NEW);
  });
});
```

- [x] **Étape 5 : vérifier que les tests échouent**

```bash
pnpm --filter @ib/ledger exec vitest run src/journals/identities.test.ts
```

Attendu : ÉCHEC du premier test — `canonical(OPTION_OLD)` rend `OPTION_OLD`. Les sept autres
passent déjà : ce sont les refus, et ils doivent rester verts après l'implémentation.

- [x] **Étape 6 : écrire l'implémentation**

Dans `identities.ts`, compléter l'import de `./contract.ts` avec `expiryOfPacked`,
`respellPackedOption` et `tickerOf`, celui de `./corporate.ts` avec `withoutOldSuffix`, puis
ajouter avant `buildIdentities` :

```ts
/**
 * Rule 9: an option follows the 1-for-1 conversion of its underlying.
 *
 * When IB converts a stock share for share — a CUSIP change, a name change, a
 * merger paid entirely in shares — the OCC hands the option contract the new
 * ticker without touching its terms, and IB keeps the conid. But a statement
 * written after the event lists only the spelling of the day: unlike a stock,
 * whose action carries a `(TICKER, NAME, ISIN)` triple for rule 8 to read, an
 * option leaves no witness at all. The event is the only thing that says which
 * name the option wore before.
 *
 * So the graft is made on proof, never on inference: it requires a class that
 * already spells the option under the *new* ticker with these very terms, and
 * it refuses a spelling any other class claims — that file knows better, and
 * merging two real positions is worse than leaving one name unresolved
 * (rule 6). Ratio and cash are what make the terms trustworthy: a ratio other
 * than 1, or a merger that pays cash, adjusts the contract in ways no source
 * of ours reports.
 *
 * The alias is stamped with the event's own day, like rule 8's, so it can
 * never outrank the class's current name in `canonicalOf`.
 */
function followUnderlyingRenames(
  contracts: readonly IdentityInput[],
  events: readonly CorporateActionEvent[],
  resolved: ContractIdentities,
): readonly IdentityInput[] {
  const claimed = new Set<string>();
  for (const input of contracts) for (const alias of input.aliases) claimed.add(alias.ticker);
  const working = contracts.map((input) => ({ ...input, aliases: [...input.aliases] }));
  let grafted = false;
  // Newest event first: a ticker renamed twice (A -> B -> C) grafts B from the
  // later event, and the earlier one then finds B already there to graft A.
  const newestFirst = [...events].sort((a, b) => (a.when < b.when ? 1 : -1));
  for (const event of newestFirst) {
    if (event.cash !== null) continue;
    if (event.to.quantity !== -event.from.quantity) continue;
    const day = event.when.slice(0, 10);
    const arrivals = new Set([event.to.ticker, resolved.canonical(event.to.ticker, event.when)]);
    // The names the underlying wore before: what the trades of that time are
    // filed under. IB's own "X.OLD" is never one of them.
    const departures = new Set([withoutOldSuffix(event.from.ticker)]);
    for (const input of working) {
      if (!input.aliases.some((alias) => alias.ticker === event.from.ticker)) continue;
      for (const alias of input.aliases) if (!isOld(alias.ticker)) departures.add(alias.ticker);
    }
    for (const arrival of arrivals) departures.delete(arrival);
    if (departures.size === 0) continue;
    for (const input of working) {
      if (input.secType !== "OPT") continue;
      for (const alias of [...input.aliases]) {
        if (!isPackedOptionSymbol(alias.ticker)) continue;
        if (!arrivals.has(tickerOf(alias.ticker))) continue;
        const expiry = expiryOfPacked(alias.ticker);
        // An option already expired cannot have been renamed by this event.
        if (expiry === null || expiry < day) continue;
        for (const departure of departures) {
          const spelling = respellPackedOption(alias.ticker, departure);
          if (spelling === null || claimed.has(spelling)) continue;
          input.aliases.push({ ticker: spelling, firstSeen: day, lastSeen: day });
          claimed.add(spelling);
          grafted = true;
        }
      }
    }
  }
  return grafted ? working : contracts;
}
```

Puis remplacer `buildIdentities` par :

```ts
export function buildIdentities(inputs: readonly IdentityInput[], events: readonly CorporateActionEvent[] = []): ContractIdentities {
  const contracts = namedContracts(graftActionAliases(inputs, events));
  // Rule 9 needs the names the underlying wore, which rules 1 to 6 alone can
  // give; option classes share no spelling with stock classes, so resolving
  // twice is safe and the second pass only ever sees more aliases.
  const resolved = resolve(contracts, events);
  const followed = followUnderlyingRenames(contracts, events, resolved);
  return followed === contracts ? resolved : resolve(followed, events);
}
```

- [x] **Étape 7 : vérifier que tout passe, oracles compris**

```bash
pnpm --filter @ib/ledger test
pnpm --filter @ib/ib-parsers test
```

Attendu : PASS partout. Les trois oracles ne bougent pas.

- [x] **Étape 8 : commit**

```bash
git add packages/ledger/src/journals/identities.ts packages/ledger/src/journals/identities.test.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
feat(ledger): règle 9, une option suit la conversion 1:1 de son sous-jacent

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 4 : deux relevés minuscules et entièrement synthétiques

**Fichiers :**
- Créer : `packages/ib-parsers/tests/fixtures/statement_opt_2025.htm`
- Créer : `packages/ib-parsers/tests/fixtures/statement_opt_2026.htm`
- Créer : `packages/ib-parsers/src/optionRenames.test.ts`

**Interfaces :**
- Consomme : `parseActivityStatement`, `mergeIdentities`, `buildIdentities`,
  `pairCorporateActions`, `buildJournals`.
- Produit : rien qu'un test. Les deux fixtures sont la preuve versionnée des deux cas.

- [x] **Étape 1 : écrire la fixture de 2025 (l'option ajustée)**

Créer `packages/ib-parsers/tests/fixtures/statement_opt_2025.htm` :

```html
<html>
<head><title>U0000002 Activity Statement January 1, 2025 - December 31, 2025 - Interactive Brokers</title></head>
<body>

<div id="tblTransactions_U0000002Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered" id="summaryDetailTable">
<thead>
<tr>
<th align="left">Symbol</th>
<th align="left">Date/Time</th>
<th align="right">Quantity</th>
<th align="right">T. Price</th>
<th align="right">C. Price</th>
<th align="right">Proceeds</th>
<th align="right">Comm/Fee</th>
<th align="right">Basis</th>
<th align="right">Realized P/L</th>
<th align="right">MTM P/L</th>
<th align="right">Code</th>
</tr>
</thead>
<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="11">Equity and Index Options</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="11">USD</td></tr>
</tbody>
<tbody>
<tr>
<td>TSTA 16JAN26 12.5 C</td>
<td>2025-03-10, 10:00:00</td>
<td align="right">3</td>
<td align="right">7.3300</td>
<td align="right">7.5000</td>
<td align="right">-2,199.00</td>
<td align="right">-1.06</td>
<td align="right">2200.06</td>
<td align="right">0.00</td>
<td align="right">51.00</td>
<td align="right">O</td>
</tr>
<tr>
<td>TSTA1 16JAN26 12.5 C</td>
<td>2025-11-20, 10:00:00</td>
<td align="right">-3</td>
<td align="right">4.0000</td>
<td align="right">4.0000</td>
<td align="right">1,200.00</td>
<td align="right">-1.06</td>
<td align="right">-2200.06</td>
<td align="right">-1,001.12</td>
<td align="right">0.00</td>
<td align="right">C</td>
</tr>
</tbody>
</table>
</div>
</div>

<div id="tblContractInfoU0000002Body" class="sectionContent">
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
<tr><td class="header-asset" align="left" valign="middle" colspan="9">Equity and Index Options</td></tr>
<tr>
<td>TSTA  260116C00012500, TSTA1 260116C00012500</td><td>TSTA1 16JAN26 12.5 C</td><td align="right">700000010</td>
<td>&nbsp;</td><td>TSTA1</td><td>CBOE</td><td align="right">100</td><td>OPTION</td><td>&nbsp;</td>
</tr>
</table>
</div>
</div>

<div id="tblOpenPositions_U0000002Body" class="sectionContent">
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
</table>
</div>
</div>

</body>
</html>
```

Le compte est `U0000002`, le ticker `TSTA` : rien de réel. La section *Open Positions* n'a que
son en-tête — l'option est sortie, le compte ne détient rien à la fin de la période.

- [x] **Étape 2 : écrire la fixture de 2026 (la conversion 1:1)**

Créer `packages/ib-parsers/tests/fixtures/statement_opt_2026.htm` :

```html
<html>
<head><title>U0000002 Activity Statement January 1, 2026 - December 31, 2026 - Interactive Brokers</title></head>
<body>

<div id="tblTransactions_U0000002Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered" id="summaryDetailTable">
<thead>
<tr>
<th align="left">Symbol</th>
<th align="left">Date/Time</th>
<th align="right">Quantity</th>
<th align="right">T. Price</th>
<th align="right">C. Price</th>
<th align="right">Proceeds</th>
<th align="right">Comm/Fee</th>
<th align="right">Basis</th>
<th align="right">Realized P/L</th>
<th align="right">MTM P/L</th>
<th align="right">Code</th>
</tr>
</thead>
<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="11">Stocks</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="11">USD</td></tr>
</tbody>
<tbody>
<tr>
<td>TSTB</td>
<td>2026-01-15, 10:00:00</td>
<td align="right">975</td>
<td align="right">1.2100</td>
<td align="right">1.3000</td>
<td align="right">-1,179.75</td>
<td align="right">-1.00</td>
<td align="right">1180.75</td>
<td align="right">0.00</td>
<td align="right">87.75</td>
<td align="right">O</td>
</tr>
</tbody>
<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="11">Equity and Index Options</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="11">USD</td></tr>
</tbody>
<tbody>
<tr>
<td>TSTB 15JAN27 2.5 C</td>
<td>2026-03-04, 13:06:53</td>
<td align="right">14</td>
<td align="right">0.7500</td>
<td align="right">0.8000</td>
<td align="right">-1,050.00</td>
<td align="right">-6.76</td>
<td align="right">987.65</td>
<td align="right">0.00</td>
<td align="right">70.00</td>
<td align="right">O</td>
</tr>
<tr>
<td>TSTC 15JAN27 2.5 C</td>
<td>2026-05-21, 12:07:48</td>
<td align="right">-14</td>
<td align="right">2.4700</td>
<td align="right">2.4700</td>
<td align="right">3,458.00</td>
<td align="right">-6.76</td>
<td align="right">-987.65</td>
<td align="right">2,394.48</td>
<td align="right">0.00</td>
<td align="right">C</td>
</tr>
</tbody>
</table>
</div>
</div>

<div id="tblCorporateActions_U0000002Body" class="sectionContent">
<div class="table-responsive">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="table table-bordered">
<thead>
<tr>
<th align="left">Report Date</th>
<th align="left">Date/Time</th>
<th align="left">Description</th>
<th align="right">Quantity</th>
<th align="right">Proceeds</th>
<th align="right">Value</th>
<th align="right">Realized P/L</th>
<th align="right">Code</th>
</tr>
</thead>
<tr><td class="header-asset" align="left" valign="middle" colspan="8">Stocks</td></tr>
<tr><td class="header-currency" align="left" valign="middle" colspan="8">USD</td></tr>
<tr>
<td>2026-04-06</td>
<td>2026-04-03, 20:25:00</td>
<td>TSTB(US0000000012) Merged(Acquisition) WITH US0000000013 1 for 1 (TSTC, TEST C CORP, US0000000013)</td>
<td align="right">975</td>
<td align="right">0.00</td>
<td align="right">3617.25</td>
<td align="right">0.00</td>
<td align="right">&nbsp;</td>
</tr>
<tr>
<td>2026-04-06</td>
<td>2026-04-03, 20:25:00</td>
<td>TSTB(US0000000012) Merged(Acquisition) WITH US0000000013 1 for 1 (TSTB.OLD, TEST B INC, US0000000012)</td>
<td align="right">-975</td>
<td align="right">0.00</td>
<td align="right">-3617.25</td>
<td align="right">0.00</td>
<td align="right">&nbsp;</td>
</tr>
</table>
</div>
</div>

<div id="tblContractInfoU0000002Body" class="sectionContent">
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
<tr>
<td>TSTB.OLD</td><td>TEST B INC</td><td align="right">700000021</td>
<td>US0000000012</td><td>TSTB.OLD</td><td>NASDAQ</td><td align="right">1</td><td>COMMON</td><td>&nbsp;</td>
</tr>
<tr>
<td>TSTC</td><td>TEST C CORP</td><td align="right">700000022</td>
<td>US0000000013</td><td>TSTC</td><td>NASDAQ</td><td align="right">1</td><td>COMMON</td><td>&nbsp;</td>
</tr>
<tr><td class="header-asset" align="left" valign="middle" colspan="9">Equity and Index Options</td></tr>
<tr>
<td>TSTC  270115C00002500</td><td>TSTC 15JAN27 2.5 C</td><td align="right">700000023</td>
<td>&nbsp;</td><td>TSTC</td><td>CBOE</td><td align="right">100</td><td>OPTION</td><td>&nbsp;</td>
</tr>
</table>
</div>
</div>

<div id="tblOpenPositions_U0000002Body" class="sectionContent">
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
<tr><td class="header-currency" align="left" valign="middle" colspan="9">USD</td></tr>
</tbody>
<tbody>
<tr>
<td>TSTC</td>
<td align="right">975</td>
<td align="right">1</td>
<td align="right">1.21</td>
<td align="right">1,179.75</td>
<td align="right">3.7100</td>
<td align="right">3,617.25</td>
<td align="right">2,437.50</td>
<td align="right">&nbsp;</td>
</tr>
</tbody>
</table>
</div>
</div>

</body>
</html>
```

Le relevé est écrit après la fusion : son *Contract Information* ne connaît l'option que sous
`TSTC  270115C00002500`, et l'action sortante sous `TSTB.OLD`. C'est exactement la forme qui
n'a aucun témoin de l'ancien nom de l'option.

- [x] **Étape 3 : écrire le test**

Créer `packages/ib-parsers/src/optionRenames.test.ts` :

```ts
/// <reference types="node" />
// Two hand-written statements, a few kilobytes each and not one real figure:
// the two shapes a renamed option takes when Flex is absent (spec §7.1 of
// docs/specs/2026-09-16-identite-options-design.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIdentities, buildJournals, pairCorporateActions, type IdentityInput } from "@ib/ledger";
import { mergeIdentities } from "./identity.ts";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const TARGET = { accountId: "opt", ibAccountId: "U0000002" };
const OPTION_OLD = "TSTB  270115C00002500";
const OPTION_NEW = "TSTC  270115C00002500";
const LATE = "9999-12-31T23:59:59.999Z";

const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
const html2025 = read("statement_opt_2025.htm");
const html2026 = read("statement_opt_2026.htm");

/** Rewrites one cell of the single row that contains `marker`. */
function editRow(html: string, marker: string, from: string, to: string): string {
  const row = (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((candidate) => candidate.includes(marker));
  expect(row, `a row containing ${marker}`).toBeDefined();
  const edited = row!.replace(from, to);
  expect(edited, `${from} inside the row containing ${marker}`).not.toBe(row);
  return html.replace(row!, edited);
}

/**
 * The identity table and the journals `useJournals` would build from these
 * statements: every alias of a file is stamped with that file's own window,
 * exactly as `mergeContractRecords` does (apps/web/src/db/contracts.ts, read
 * as a reference — this package cannot import apps/web).
 */
function replay(htmls: readonly string[]) {
  const parsed = htmls.map((html) => parseActivityStatement(html, TARGET));
  const windows = new Map<string, { firstSeen: string; lastSeen: string }>();
  for (const p of parsed) {
    const { periodStart: start, periodEnd: end } = p.statement!;
    for (const identity of p.identities) {
      for (const ticker of identity.tickers) {
        const key = `${identity.conid}|${ticker}`;
        const seen = windows.get(key);
        if (!seen) windows.set(key, { firstSeen: start, lastSeen: end });
        else {
          if (start < seen.firstSeen) seen.firstSeen = start;
          if (end > seen.lastSeen) seen.lastSeen = end;
        }
      }
    }
  }
  const inputs: IdentityInput[] = mergeIdentities(parsed.map((p) => p.identities)).map((identity) => ({
    conid: identity.conid,
    secType: identity.secType,
    isin: identity.isin,
    aliases: identity.tickers.map((ticker) => ({ ticker, ...windows.get(`${identity.conid}|${ticker}`)! })),
  }));
  const transactions = parsed.flatMap((p) => p.transactions);
  const { events } = pairCorporateActions(transactions);
  const identities = buildIdentities(inputs, events);
  const snapshot = parsed[parsed.length - 1].snapshot!;
  return {
    parsed,
    inputs,
    events,
    identities,
    report: buildJournals(transactions, { asOf: snapshot.asOf, positions: snapshot.positions }, identities),
  };
}

describe("two statements, no Flex, two options IB renamed", () => {
  it("parses both files without a single issue", () => {
    for (const { issues } of replay([html2025, html2026]).parsed) expect(issues).toEqual([]);
  });

  it("reconstructs the last statement's positions exactly", () => {
    const { report, identities } = replay([html2025, html2026]);
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);
    expect(identities.issues).toEqual([]);
  });

  it("files each option under the one name it wears today", () => {
    const labels = replay([html2025, html2026]).report.rows.map((row) => row.label);
    // The adjusted option, closed under its new spelling; the converted one,
    // bought under the old ticker and sold under the new.
    expect(labels).toContain("TSTA1 Jan16'26 12.5 Call");
    expect(labels).toContain("TSTC Jan15'27 2.5 Call");
    expect(labels).not.toContain("TSTA Jan16'26 12.5 Call");
    expect(labels).not.toContain("TSTB Jan15'27 2.5 Call");
  });

  it("owes the converted option's name to the event alone (rule 9)", () => {
    const { inputs, events } = replay([html2025, html2026]);
    expect(buildIdentities(inputs, events).canonical(OPTION_OLD, LATE)).toBe(OPTION_NEW);
    expect(buildIdentities(inputs).canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });

  it("refuses the graft when the event's ratio is not 1", () => {
    const edited = editRow(html2026, "(TSTC, TEST C CORP,", ">975<", ">100<");
    expect(replay([html2025, edited]).identities.canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });

  it("refuses the graft when the event pays cash", () => {
    const edited = editRow(html2026, "(TSTB.OLD, TEST B INC,", ">0.00</td>", ">1,290.40</td>");
    expect(replay([html2025, edited]).identities.canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });

  it("refuses the graft on an option that had already expired", () => {
    const edited = editRow(html2026, "TSTC  270115C00002500", "270115", "260101");
    expect(replay([html2025, edited]).identities.canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });
});
```

- [x] **Étape 4 : lancer le test**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/optionRenames.test.ts
```

Attendu : PASS. Si « parses both files without a single issue » échoue, lire le `detail` de
l'anomalie : c'est presque toujours un nombre de `<td>` qui ne correspond pas au nombre de
`<th>` de son bloc. Les fixtures se corrigent, jamais l'assertion.

- [x] **Étape 5 : vérifier que rien d'autre n'a bougé**

```bash
pnpm --filter @ib/ib-parsers test
pnpm --filter @ib/ledger test
```

Attendu : PASS partout.

- [x] **Étape 6 : commit**

```bash
git add packages/ib-parsers/tests/fixtures/statement_opt_2025.htm packages/ib-parsers/tests/fixtures/statement_opt_2026.htm packages/ib-parsers/src/optionRenames.test.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
test(parsers): deux relevés synthétiques portent les deux formes de renommage d'option

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 5 : l'agent publie la forme OSI de ses options

**Fichiers :**
- Modifier : `packages/ib-parsers/src/agent.ts:152-171` (`identityOf`)
- Test : `packages/ib-parsers/src/agent.test.ts`

**Interfaces :**
- Consomme : `isPackedOptionSymbol` (`@ib/ledger`), `OPTION_TYPES` (déjà dans `agent.ts`).
- Produit : rien de nouveau. `parseAgentSnapshot(...).identities` porte désormais, pour une
  option US, la forme OSI que la règle 7 accepte.

- [x] **Étape 1 : écrire les tests qui échouent**

Ajouter dans le `describe("parseAgentSnapshot contract identities", …)` de
`packages/ib-parsers/src/agent.test.ts` :

```ts
  it("gives an option the packed spelling TWS puts in localSymbol (rule 7)", () => {
    const parsed = parseAgentSnapshot(payload, ACCOUNT);
    const option = parsed.identities.find((i) => i.conid === "700000001");
    expect(option).toMatchObject({ secType: "OPT", tickers: ["SYMB  261218C00180000"] });
  });

  it("keeps the underlying when the market does not spell options in OSI", () => {
    // A non-US option: `localSymbol` is not a packed spelling, so the identity
    // carries the underlying, which rule 7 then drops — exactly as before.
    const parsed = parseAgentSnapshot(withPosition({ localSymbol: "C OESX 20261218 180 M" }), ACCOUNT);
    const option = parsed.identities.find((i) => i.conid === "700000001");
    expect(option?.tickers).toEqual(["SYMB"]);
  });

  it("leaves a stock and a currency pair untouched", () => {
    const parsed = parseAgentSnapshot(payload, ACCOUNT);
    expect(parsed.identities.find((i) => i.conid === "265598")?.tickers).toEqual(["SYMA"]);
    expect(parsed.identities.find((i) => i.conid === "12087792")?.tickers).toEqual(["EUR.USD"]);
  });
```

- [x] **Étape 2 : vérifier que les tests échouent**

```bash
pnpm --filter @ib/ib-parsers exec vitest run src/agent.test.ts
```

Attendu : ÉCHEC du premier test, `tickers` valant `["SYMB"]`. Les deux autres passent déjà.

- [x] **Étape 3 : écrire l'implémentation**

Dans `packages/ib-parsers/src/agent.ts`, ajouter `isPackedOptionSymbol` à l'import de
`@ib/ledger`, puis remplacer `identityOf` par :

```ts
/**
 * TWS always gives a conId and never an ISIN. The ticker is the spelling that
 * names *this* contract: for an option, the packed OSI form TWS puts in
 * `localSymbol` — the only spelling rule 7 accepts, since `symbol` is the
 * underlying and would make every option of one stock claim its ticker. A
 * market that does not spell options in OSI leaves the underlying there, which
 * rule 7 drops, exactly as it did before this rule existed.
 */
function identityOf(contract: AgentContract, fields: ContractFields): ContractIdentity | null {
  const conid = String(contract.conId);
  if (conid === "0") return null;
  const ticker =
    OPTION_TYPES.has(fields.secType) && isPackedOptionSymbol(fields.localSymbol)
      ? fields.localSymbol
      : fields.symbol;
  if (ticker === "") return null;
  return {
    conid,
    isin: "",
    secType: fields.secType,
    currency: contract.currency,
    description: describeAgentContract(fields),
    tickers: [ticker],
  };
}
```

- [x] **Étape 4 : vérifier que les tests passent**

```bash
pnpm --filter @ib/ib-parsers test
pnpm --filter web test
```

Attendu : PASS partout. `apps/web` compte parce que `syncAgent` écrit ces identités dans le
store `contracts` et qu'`addMissingSectors` ne lit que les identités `STK` : aucune forme OSI
ne doit apparaître dans la table sectorielle.

⚠️ BLOCAGE : alpha.private.test.ts échoue (4 écarts attendus, 0 trouvés) car tasks 1-4 ont
déjà fixé l'option logic. Ce test sera corrigé en tâche 6. Les trois oracles passent.

- [x] **Étape 5 : commit**

```bash
git add packages/ib-parsers/src/agent.ts packages/ib-parsers/src/agent.test.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
feat(parsers): l'agent publie la forme OSI que TWS donne à ses options

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 6 : les données réelles passent à zéro écart

**Fichiers :**
- Modifier : `apps/web/src/db/alpha.private.test.ts:99-123`

**Interfaces :**
- Consomme : tout ce qui précède.
- Produit : la preuve, sur les fichiers réels de `private/`, que relevés seuls égale Flex.

Ce test se saute tout seul quand `private/` est absent (`describe.skipIf`). Sur une machine qui
n'a pas les fichiers réels, cette tâche se réduit à vérifier que la suite reste verte, et le
résultat doit être signalé comme non vérifié.

- [x] **Étape 1 : mesurer l'état avant**

```bash
pnpm --filter web exec vitest run src/db/alpha.private.test.ts
```

Attendu, si `private/` est là : PASS — le test fige encore 4 écarts et 1 orphelin. C'est la
mesure d'avant, pas un succès.

- [x] **Étape 2 : écrire l'attendu neuf**

Dans `apps/web/src/db/alpha.private.test.ts`, renommer le troisième test et remplacer son
bloc de réconciliation :

```ts
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
```

Le reste du test — le bloc `cashChecks` et ses assertions — ne change pas.

- [x] **Étape 3 : lancer le test**

```bash
pnpm --filter web exec vitest run src/db/alpha.private.test.ts
```

Attendu : PASS, les quatre tests. Si les écarts ne tombent pas à zéro, ne pas relâcher
l'assertion : lire quels contrats restent en écart et remonter à la règle qui ne s'applique
pas — c'est le moteur qui a tort, pas l'oracle.

- [x] **Étape 4 : vérification complète**

```bash
pnpm check
pnpm --filter @ib/ledger test
pnpm --filter @ib/ib-parsers test
pnpm --filter web test
pnpm --filter @ib/coverage test
```

Attendu : PASS partout, les trois oracles inchangés. **Ne rien annoncer comme terminé avant
d'avoir vu ces sorties** — skill `superpowers:verification-before-completion`.

- [x] **Étape 5 : commit**

```bash
git add apps/web/src/db/alpha.private.test.ts docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
test(web): relevés seuls, alpha reconstruit son portefeuille sans un écart

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 7 : documents, revue de branche, merge

**Fichiers :**
- Modifier : `CLAUDE.md`
- Modifier : `docs/specs/2026-09-09-operations-sur-titres-design.md` (§5.2, §7)
- Modifier : `docs/specs/2026-09-10-fichier-seul-design.md` (§2.5)
- Modifier : `docs/specs/2026-09-16-identite-options-design.md` (ligne de statut)
- Modifier : `docs/points-reportes.md`

- [x] **Étape 1 : `CLAUDE.md`**

Trois retouches :

1. La règle « Une option n'entre dans une classe que sous sa forme OSI empaquetée » (§ Règles
   qui mordent) gagne une phrase : *« Une transaction qui nomme l'option par son sous-jacent
   reconstruit cette forme depuis ses termes (`packedOptionSymbol`) pour interroger la table ;
   et une conversion 1 pour 1 du sous-jacent greffe l'ancienne orthographe sur la classe du
   nouveau ticker, sur preuve qu'elle existe (spec §5.2, règle 9). »*
2. La phrase sur `alpha` (oracles du cash) : remplacer
   « Relevés seuls, son portefeuille garde 4 écarts d'options renommées, figés par
   `alpha.private.test.ts` jusqu'au sous-projet 10 » par « Relevés seuls, son portefeuille se
   reconstruit sans un écart depuis le sous-projet 10 ». La phrase suivante, sur l'écart USD du
   relevé 2026 importé seul, ne change pas.
3. Le tableau des sous-projets : la ligne 10 passe à « fait (2026-09-16) ».

- [x] **Étape 2 : les specs**

- `2026-09-09-operations-sur-titres-design.md` §5.2 : ajouter la règle 9 à la liste, sur le
  modèle des règles 7 et 8, en renvoyant au spec du sous-projet 10 pour le détail ; préciser
  dans la règle 7 que la table ne retient que la forme OSI, mais que la reconstruire depuis les
  termes d'une transaction est le chemin inverse, et qu'il est autorisé. Au §7 (« Ce qui reste
  faux »), retirer la ligne que ce sous-projet referme.
- `2026-09-10-fichier-seul-design.md` §2.5 : indiquer que le cas est refermé par le
  sous-projet 10, en gardant la description des deux options — c'est la mesure d'origine.
- `2026-09-16-identite-options-design.md` : la ligne de statut passe à « implémenté
  (2026-09-16) ».

- [x] **Étape 3 : `docs/points-reportes.md`**

Ouvrir une section « Reporté par le sous-projet 10 » avec les cinq points du §8 du spec :
ratio différent de 1, fusion avec cash, racine suffixée côté cible, agent qui a besoin de deux
passes, appariement couverture/livraison par ticker brut. Puis refermer les deux entrées que ce
sous-projet règle : « Un split du sous-jacent ne renomme toujours pas les options qui le
suivent » (sous-projet 7) devient vraie du seul ratio différent de 1, et « Relevés seuls, une
option renommée en cours de vie ouvre un écart de portefeuille » (sous-projet 9) disparaît.

- [x] **Étape 4 : commit des documents**

```bash
git add CLAUDE.md docs/specs docs/points-reportes.md docs/plans/2026-09-16-identite-options.md
git commit -m "$(cat <<'EOF'
docs: sous-projet 10 livré, règle 9 et dette à jour

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [x] **Étape 5 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche complète. Traiter les retours avec
`superpowers:receiving-code-review` : vérifier techniquement chaque remarque avant de
l'appliquer, et inscrire dans `docs/points-reportes.md` ce qui est délibérément reporté.

- [x] **Étape 6 : instance de relecture**

```bash
pnpm dev:start
```

Donner les deux URL à Seb : il regarde la branche avant de décider du merge. L'instance tourne
sur les ports du worktree, sans gêner celle de la racine.

- [x] **Étape 7 : merge**

Avant tout, `pnpm dev:stop` **dans le worktree** — après le merge, plus rien ne dira quels
processus lui appartenaient. Puis invoquer `superpowers:finishing-a-development-branch` pour
merger `identite-options` sur `main` et retirer le worktree, après un dernier `pnpm check`.
