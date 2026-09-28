# Sous-projet 36 — Les totaux : P/L du jour, P/L non réalisé, valeur totale

Statut : conçu (2026-09-28).

Le tableau de bord ne montre qu'un chiffre de résultat, le *Profit/perte total* réalisé des
journaux (`computeStats`). Les pages de positions montrent ligne par ligne la valeur de marché,
le P/L du jour et le P/L non réalisé, mais aucune somme : pour savoir ce qu'une stratégie a fait
aujourd'hui, ou ce que vaut le compte, il faut additionner à la main. Ce sous-projet ajoute les
sommes, calculées dans le navigateur à partir de ce que la coquille détient déjà — snapshot,
rapport de risque, journaux, cash calé —, jamais stockées, sans rien demander au serveur ni à
l'agent (`reqPnLSingle` suffit, `reqPnL` au niveau du compte n'est pas nécessaire).

---

## 1. Périmètre

**Critère de réussite :** agent présent, le tableau de bord affiche la valeur totale du compte
dans le cadre *Profit/perte total*, un cadre *P/L non réalisé* avec en petit le réalisé du jour,
et un cadre *P/L non réalisé du jour* au-dessus de l'exposition par secteur ; la page Positions
Wheel affiche à côté de son titre le P/L du jour, la valeur et le P/L de ses lignes, et chaque
encadré les mêmes trois chiffres pour ses propres lignes ; une recherche « AAPL » réduit tous ces
en-têtes aux seules lignes AAPL.

Dans le périmètre : les fonctions pures (§2), le tableau de bord (§3), les en-têtes de page et de
tableau (§4), les filtres (§5), les textes (§6), les tests (§7).

Hors périmètre : `reqPnL` et tout champ de P/L au niveau du compte dans l'agent ou le snapshot ;
tout stockage d'un total ; toute conversion entre devises ; une nouvelle colonne de tableau ; les
Journaux, l'Historique et la Suggestion de position, inchangés.

## 2. Ce qui est calculé

Arbitrages de Seb (2026-09-28) :

- **« P/L total » d'un en-tête = la somme de la colonne P/L des lignes affichées** — le non
  réalisé des positions ouvertes, jamais le réalisé historique de la stratégie.
- **Valeur totale du tableau de bord et de la page Positions = valeur de liquidation** :
  valeurs de marché des positions (options vendues négatives) plus le cash calé, par devise.
  Ailleurs (pages de stratégie, en-têtes de tableau), la somme des valeurs de marché des lignes.
- **Réalisé du jour = toute fermeture du jour** : rachat, vente, assignation, exercice,
  expiration. Une ouverture ne réalise rien — une prime encaissée aujourd'hui n'y entre pas.
- **Portée des cadres du tableau de bord = tout le compte**, Autres compris.
- **Une somme partielle s'affiche** : les valeurs connues sont additionnées, le total est marqué
  partiel ; « — » seulement quand aucune ligne n'a de valeur.
- **Les en-têtes suivent les filtres** (§5).

### 2.1 `sumByCurrency` — `packages/coverage/src/totals.ts`

```ts
// CurrencyTotal est défini dans packages/ledger (§2.2), que coverage ré-exporte.
export function sumByCurrency<Row>(rows: readonly Row[], currencyOf: (row: Row) => string,
  pick: (row: Row) => number | null): CurrencyTotal[];
```

Une entrée par devise présente, triée par code. `total` est la somme des valeurs non `null`,
`null` quand toutes le sont ; `missing` compte les lignes à `null`. Jamais de conversion : un
tableau qui mêle USD et EUR rend deux entrées.

### 2.2 `realizedOnDay` — `packages/ledger/src/journals/realized.ts`

```ts
export interface CurrencyTotal { currency: string; total: number | null; missing: number; count: number }
export function realizedOnDay(rows: readonly JournalRow[], day: string): CurrencyTotal[]
```

Somme par devise des `pnl` des lignes de journal, **toutes stratégies, Autres compris**, dont
`endWhen !== null` et `marketDayOf(endWhen) === day`. Une ligne à `pnl` `null` compte dans
`missing`. Un condor n'a qu'une ligne de journal, son composite (`kind === "condor"`) : ses
jambes n'en ont aucune (`journals/rows.ts`, un lot qui a un parent ne rend pas de ligne). Il
compte donc une fois, le jour où sa dernière jambe se ferme, pour tout son `pnl` ; une jambe
fermée seule avant n'entre dans aucun réalisé du jour — limite acceptée, notée dans
`docs/points-reportes.md`. `CurrencyTotal` vit dans `ledger`, dont `coverage` dépend : une seule
définition.

### 2.3 Le jour

« Le jour » est `marketDayOf(snapshot.asOf)` d'un snapshot de source `agent`. Sans snapshot
`agent`, le P/L du jour et le réalisé du jour affichent « — » : les valeurs du jour ne viennent
que de l'agent (règle existante), et un 0 tiré d'un relevé mentirait.

### 2.4 Valeur de liquidation — `packages/coverage/src/totals.ts`

```ts
export function liquidationValue(positions: readonly Position[],
  cash: Readonly<Record<string, number | null>>): CurrencyTotal[];
```

Par devise : somme des `marketValue` du snapshot plus le dernier solde calé de la devise — celui
qu'affiche `CashBalancesCard`, lu par une fonction factorisée `currentCashBalances(rows, checks)`
(`packages/ledger/src/cash.ts`) que la carte reprend : dernière ligne du ledger, sinon l'*Ending
Cash* seul, sinon `null`. Un cash `null` compte dans `missing`. Sans snapshot, « — ».

### 2.5 `WheelShareLine.marketValue`

`WheelShareLine` gagne `marketValue = lastPrice × quantity` (`null` si `lastPrice` l'est), sans
nouvelle colonne. Les parts libre et couverte d'un ticker s'additionnent donc sur leurs
quantités.

## 3. Tableau de bord

Grille inchangée (`md:grid-cols-2`) :

```
┌ Profit/Perte total ──────────┐  ┌ P/L non réalisé du jour ─────┐
│ +12 340,00 USD               │  │ −215,40 USD *                │
│ Valeur totale  184 520,00 USD│  └──────────────────────────────┘
└──────────────────────────────┘  ┌ Exposition par secteur ──────┐
┌ P/L non réalisé ─────────────┐  │ …                            │
│ +3 120,00 USD                │
│ Réalisé du jour  +700,00 USD │
└──────────────────────────────┘
┌ Couverture cash (inchangé) ──┐
```

- Colonne gauche : `PnlTotalCard` gagne une ligne *Valeur totale* (valeur de liquidation) ; un
  nouveau cadre *P/L non réalisé* (somme des `unrealizedPnl` du snapshot) avec en petit
  *Réalisé du jour* ; puis `CashCoverageCard`.
- Colonne droite : un nouveau cadre *P/L non réalisé du jour* (somme des `dailyPnl` du
  snapshot), puis `ExposureCard`.
- Chaque chiffre suit la devise de `CurrencySelect` ; une devise sans valeur affiche « — ».
- Même style que `PnlTotal` : police mono, vert ou rouge selon le signe pour les P/L, neutre
  pour la valeur totale ; « — » en gris.
- Sans snapshot (`report === null`), les nouveaux cadres affichent « — », le reste de la page
  est inchangé.

## 4. En-têtes de page et de tableau

Un composant `HeaderTotals` (`apps/web/src/components/HeaderTotals.tsx`) rend une rangée
compacte, à droite du titre, qui passe à la ligne sur un écran étroit :

```
Positions Wheel      P/L du jour −215,40 · Valeur 42 310,00 · P/L +1 830,00 USD
┌ Ventes de puts      P/L du jour −80,00 · Valeur −1 250,00 · P/L +410,00 USD ┐
```

- Libellé petit et gris, valeur mono ; les deux P/L colorés selon le signe, la valeur neutre.
- Un total partiel porte `*` et une infobulle « n lignes sans valeur ».
- Une ligne par devise quand les lignes en mêlent plusieurs, la devise écrite une fois en fin.
- `FilteredTableBox` gagne une prop optionnelle `totals` rendue dans son `CardHeader` ; les
  pages la passent, rien d'autre ne change dans les tableaux.

Où :

- **Positions** : en-tête de page ; les quatre groupes (`DETAIL_GROUPS`). La carte Cash n'en a
  pas, elle affiche déjà ses valeurs.
- **Wheel, LEAPS, Condors, Autres** (`StrategyPositionsPage`) : en-tête de page et chaque
  encadré rendu. Colonnes sommées : `dailyPnl`, `marketValue`, `unrealizedPnl` ; pour un condor,
  sa colonne `pnl` (réalisé des jambes fermées + latent des ouvertes), fidèle à la règle « somme
  de la colonne P/L ».
- L'en-tête de page additionne les lignes de tous ses encadrés. Aucun double compte : une ligne
  n'est que dans un encadré (parts libre et couverte des actions Wheel distinctes ; les lignes
  de condor, jamais leurs jambes en plus).
- Un `dailyPnl` que `dayShare` abandonne compte dans `missing`, jamais pour 0.

## 5. Filtres

- L'en-tête d'un tableau additionne **ses lignes affichées** : après la recherche par ticker, le
  filtre d'échéance et ses filtres de colonne — les `rows` que la page calcule déjà.
- L'en-tête de page additionne les lignes affichées de tous ses encadrés.
- Page Positions : sans recherche ni filtre actif, sa valeur est la valeur de liquidation, cash
  compris ; dès qu'un filtre est actif, le cash sort et l'infobulle le dit (« hors cash, filtre
  actif »).
- Les cadres du tableau de bord ne sont soumis à aucun filtre.

## 6. Textes

Clés nouvelles dans `apps/web/src/i18n/{fr,en}.json` : *Valeur totale*, *P/L non réalisé*,
*Réalisé du jour*, *P/L non réalisé du jour*, les trois libellés courts d'en-tête (*P/L du
jour*, *Valeur*, *P/L*), l'infobulle de total partiel (pluriel), l'infobulle « hors cash ».

## 7. Tests

Vitest, écrits pour échouer si le comportement change.

- `sumByCurrency` : tout `null`, `null` partiel (`missing`), plusieurs devises triées.
- `realizedOnDay` : un rachat du jour compté ; un put vendu du jour exclu ; une assignation d'un
  samedi 01:02 rattachée au vendredi ; un condor compté le jour de sa dernière jambe ; une ligne
  à `pnl` `null` comptée dans `missing` ; Autres compris.
- `liquidationValue` : positions plus cash ; option vendue négative ; devise sans cash.
- `WheelShareLine.marketValue` : `lastPrice × quantity`, `null` sans prix.
- `apps/web` sur `fake-indexeddb`, ledger semé : le tableau de bord montre les trois nouveaux
  chiffres et « — » sans agent pour ceux du jour ; la page Wheel montre en-tête de page et
  d'encadré, réduits par une recherche ; la page Positions inclut le cash sans filtre et
  l'exclut sous filtre ; un total partiel porte `*`.
