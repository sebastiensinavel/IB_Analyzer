# Sous-projet 5 — Journaux Wheel, LEAPS, Condors, Others et leurs statistiques

> Spec validé en brainstorming le 7 septembre 2026. Décline le spec fondateur
> `2026-09-03-architecture-design.md` (§6.5, §9, §12), qui reste la référence pour tout ce
> qui n'est pas précisé ici. Les sous-projets 1 à 4 fixent les conventions de `ledger`,
> `ib-parsers`, de la base Dexie et des pages que ce spec étend. Il amende le spec fondateur
> sur trois points, listés au §11.

---

## 1. Périmètre

Livrer les journaux de stratégie : quatre pages qui reconstituent, depuis le ledger d'un
compte, les positions ouvertes et fermées de chaque stratégie, une ligne par position ; trois
pages de statistiques avec le résultat total et un histogramme mensuel ; et un contrôle de
cohérence qui compare le portefeuille reconstitué par le rejeu au snapshot courant.

**Dans le périmètre :**

- `packages/ledger` : le moteur `buildJournals`, ses types de sortie, la fonction de libellé
  des contrats, les statistiques.
- `packages/ib-parsers` : l'anonymiseur Flex amendé pour produire un corpus complet, et la
  fixture qui en sort.
- `apps/web` : le hook `useJournals`, quatre pages Journal, trois pages Statistiques, la carte
  de cohérence, deux sections de menu, i18n.
- Mise à jour de `CLAUDE.md`, du spec fondateur et de `docs/points-reportes.md`.

**Hors périmètre :**

- Un nouveau champ sur `Transaction` pour le code IB (`A`, `Ep`, `Ex`) : les événements sont
  inférés (§3.3). La colonne `Code` du relevé HTML reste non lue.
- Les `corporate_action` (split, fusion, changement de symbole) : non rejouées, elles
  apparaissent comme écart dans le contrôle de cohérence.
- La conversion de devises dans les statistiques : tout est par devise, sans conversion.
- Filtres avancés (période, statut, stratégie croisée), export, tri par colonne.
- Toute écriture en base : les journaux sont une vue calculée du ledger.

---

## 2. Les décisions structurantes

### 2.1 Un seul moteur de rejeu, dans `packages/ledger`

Une fonction pure parcourt le ledger trié une seule fois et remplit les quatre journaux en
même temps. Elle tient un livre de lots ouverts par contrat et, par sous-jacent, l'état
nécessaire à l'arbitrage des calls vendus : actions issues d'assignation et LEAPS détenus.
L'alternative — un moteur par journal — obligerait chaque journal à recalculer cet état
commun, avec le risque que Wheel et LEAPS ne racontent pas la même histoire. Classer à
l'import est écarté aussi : la classification dépend d'événements ultérieurs (une vente de
put n'est « assignée » qu'après coup) et de tout l'historique ; un réimport changerait les
étiquettes, et `Transaction` resterait pollué par une notion de présentation.

À la fin du rejeu, le livre des lots ouverts *est* le portefeuille reconstitué. Sa comparaison
au snapshot courant (§4) valide que le ledger est complet — et sert d'oracle au moteur.

### 2.2 Les événements sont inférés, pas stockés

Ni Flex (la query de l'utilisateur n'a pas la colonne `notes`) ni l'agent ne disent qu'une
option a été assignée, exercée ou a expiré. Le relevé HTML le dit dans sa colonne `Code`,
que le parseur ne lit pas. Le moteur infère l'événement de la forme de la transaction (§3.3),
identique dans les trois sources : une fermeture d'option à prix 0 sans commission, avec ou
sans livraison d'actions au strike au même instant. Mesuré sur le Flex réel de `beta` :
13 fermetures à prix 0, 7 avec livraison, 6 sans, et aucune option fermée à prix 0 hors de
ce motif. Lire `Code` devient un point reporté, à reprendre si l'inférence se trompe un jour.

### 2.3 Une ligne par lot et par événement de sortie

Une position ouverte en une fois mais fermée en plusieurs fois (4 puts vendus, 2 rachetés,
2 assignés) donne une ligne par événement de sortie, prime et commission initiales réparties
au prorata. Chaque ligne a donc une seule date de fin, un seul prix final et un seul
gain/perte. Un condor fait exception : une ligne pour ses quatre jambes (§3.5).

### 2.4 Statistiques en flux de trésorerie

Un gain ou une perte compte le mois où l'argent bouge : une prime le mois de la vente, un
rachat le mois du rachat. Les positions en cours comptent donc déjà leur prime. Les actions
issues d'une assignation ou d'un exercice sont l'exception : rien à l'achat, le résultat
`revente − achat` au mois de la revente. Idem pour un LEAPS : la prime payée ne compte pas,
le résultat à la revente compte.

### 2.5 Sept routes, deux sections de menu

`/accounts/:id/journal/{wheel,leaps,condors,others}` dans la section **Stratégies**,
`/accounts/:id/stats/{wheel,leaps,condors}` dans une nouvelle section **Statistiques**.
Des pages, pas des onglets : un écran par route, comme partout ailleurs.

---

## 3. `packages/ledger` : le moteur

Nouveau répertoire `src/journals/`, exporté par `index.ts`. Fonctions pures, aucune
dépendance : le moteur n'a pas besoin de multiplicateur (§3.4), donc pas de dépendance de
`ledger` vers `coverage`, qui dépend déjà de `ledger`.

### 3.1 Entrée

```ts
buildJournals(transactions: readonly Transaction[], snapshot?: JournalSnapshot): JournalsReport
```

- `transactions` : le ledger du compte, dans n'importe quel ordre ; le moteur le trie par
  `compareTransactions` (`order.ts`).
- `snapshot` : `{ asOf: string; positions: Position[] }`, optionnel, pour le contrôle de
  cohérence (§4). `asOf` est un jour `YYYY-MM-DD` (Flex) ou un instant ISO (agent), comme
  `SnapshotRecord.asOf`.

Seuls les `trade` en `STK` et `OPT` dont `quantity` est renseignée et différente de zéro
entrent dans le rejeu, plus les `trade` `OPT` sans quantité (`OptionCashSettlement`, §3.3). Dividendes, intérêts, frais,
forex, `WAR` et autres `secType` sont ignorés.

### 3.2 Lots

Un **contrat** est identifié par `symbol`, `secType`, `right`, `strike`, `expiry`, `currency`.

Un **lot** naît d'une transaction d'ouverture : contrat, stratégie (§3.4), date, prix,
`amount`, `commission`, quantité signée, quantité restante, transactions d'origine. Une
transaction de signe opposé sur un contrat qui a des lots ouverts les ferme en **FIFO** ;
si sa quantité dépasse le total ouvert, l'excédent ouvre un nouveau lot de l'autre signe.
Deux ventes du même put à deux dates font deux lots, jamais fusionnés.

Une fermeture partielle scinde le lot : la part fermée devient une ligne (§3.6), prime et
commission initiales au prorata de la quantité ; le reste garde sa date et son prix
d'origine.

### 3.3 Événements de sortie

L'événement d'une fermeture d'option est déterminé par la forme de la transaction :

| Forme | Événement |
|---|---|
| `price > 0` | `buyback` (lot court) ou `sold` (lot long) |
| `price === 0`, commission nulle ou absente, une livraison d'actions existe (§ ci-dessous) | `assigned` (lot court) ou `exercised` (lot long) |
| `price === 0`, commission nulle ou absente, aucune livraison | `expired` |

**Livraison d'actions** : une transaction `STK` du même `symbol`, au même `when`, dont le
`price` est égal au `strike` et dont le signe est celui qu'impose le contrat (put assigné →
achat ; call assigné → vente ; call exercé → achat ; put exercé → vente). Elle est consommée
par la fermeture qui l'a réclamée et ne passe pas par le classement ordinaire de §3.4 : elle
ouvre un lot d'actions **dans le journal de l'option** (put assigné, call exercé) ou ferme
les lots d'actions détenus, FIFO (call assigné, put exercé). Si la livraison dépasse les
actions détenues, l'excédent ouvre un lot d'actions à découvert dans Others. Une même
livraison peut servir plusieurs lots d'options du même contrat (quatre puts vendus en deux
fois, tous assignés) : elle est consommée dans l'ordre FIFO des lots.

**Règlement en espèces** : un `trade` `OPT` sans quantité (`OptionCashSettlement`, XSP, SPX)
est rapproché de la fermeture à prix 0 du même contrat, le même jour ; son `amount` devient
le total final de cette ligne (l'événement reste `assigned` ou `exercised`, sans livraison).
Sans fermeture correspondante, il devient une ligne Others sans quantité : ligne Others de
`kind` `settlement`, quantité `null`, `openTotal` = son `amount`.

Une fermeture d'actions est `sold` (lot long) ou `buyback` (lot court).

**Fermeture sans lot ouvert** (historique tronqué, cas `alpha`) : en général
indétectable — une vente sans lot long est simplement une ouverture courte, classée comme
telle. Le seul cas reconnaissable est une transaction à prix 0 sans commission (la forme
d'une expiration, d'une assignation ou d'un exercice, §3.3) qui ne trouve aucun lot ouvert,
ou une livraison d'actions qu'aucune option ne réclame. Elle ouvre alors un lot de son
propre signe dans Others, marqué `orphan`, qui se comporte ensuite comme un lot ordinaire :
il apparaît dans le journal Others et dans le contrôle de cohérence (§4), où il explique
l'écart au lieu de le cacher.

### 3.4 Classement, à l'ouverture

L'ouverture d'un lot fixe sa stratégie, une fois pour toutes. Les jambes `OPT` d'un même
sous-jacent ouvertes au même `when` sont examinées ensemble avant tout autre classement :

1. **Condor** : quatre jambes, même échéance, quantités égales, put acheté < put vendu <
   call vendu < call acheté → un lot composite (§3.5).
2. **Autre combinaison** de deux jambes ou plus au même `when` sur la même échéance →
   Others, une ligne par jambe. Un LEAPS et un call vendu le même jour à échéances
   différentes ne forment pas une combinaison : chacun suit les règles ci-dessous.
3. **Put vendu seul** → Wheel.
4. **Call acheté seul** : échéance à `LEAPS_MIN_MONTHS = 3` mois calendaires ou plus après le
   jour de l'achat (`expiry >= addMonths(day(when), 3)`) → LEAPS ; sinon → Others.
5. **Call vendu seul**, `N` contrats. Soit `Aw` la capacité Wheel restante du sous-jacent
   (actions issues d'assignation ou d'exercice détenues, en contrats-équivalents, moins les
   calls vendus déjà couverts par elles et encore ouverts) et `Lw` la capacité LEAPS
   restante (LEAPS ouverts moins les calls vendus déjà couverts par eux et encore ouverts) :
   - `Aw = Lw = 0` → Others (call nu, ou couvert par des actions achetées directement) ;
   - `N >= Aw + Lw` → `Aw` en Wheel, `Lw` en LEAPS, l'excédent nu en Others : jusqu'à trois
     lignes, jamais une quantité comptée deux fois ;
   - `N = Aw` → Wheel ; `N = Lw` → LEAPS ;
   - sinon, `strike >= prix moyen d'assignation` du sous-jacent → `min(N, Aw)` en Wheel, le
     reste en LEAPS ; `strike <` ce prix → `min(N, Lw)` en LEAPS, le reste en Wheel.
   Le prix moyen d'assignation est la moyenne pondérée des prix (strikes) des lots
   d'actions issus d'assignation encore détenus.
6. **Put acheté seul**, **actions achetées ou vendues directement** (sans livraison
   d'option) → Others.

**Contrats-équivalents** : un lot d'actions livré par assignation ou exercice mémorise le
ratio `actions ÷ contrats` observé sur sa livraison (100 en pratique) ; sa capacité de
couverture est `restant ÷ ratio`. Le moteur ne connaît aucun multiplicateur.

Une fermeture ne reclasse jamais : un call vendu couvert par des actions assignées reste
en Wheel même si les actions sont vendues avant lui.

### 3.5 Condor

Un lot composite : quatre sous-lots, une ligne. Label `SPY Aug29'26 IC 620/625/660/665`
(strikes croissants), quantité = nombre de condors, prix initial = crédit net par condor,
total initial = somme des `amount` des quatre jambes, commission initiale = somme des
commissions. Chaque jambe se ferme par sa propre transaction (rachat, expiration, plus
rarement assignation, traitée comme en §3.3) ; la ligne est fermée quand les quatre jambes
le sont, date de fin = dernière fermeture, prix final = débit net par condor, total final =
somme des `amount` de fermeture, commission finale = somme. Une fermeture partielle en
quantité (2 condors sur 4 rachetés) scinde le composite en deux lignes, jambes comprises,
comme un lot ordinaire.

Une jambe fermée par assignation avec livraison d'actions ouvre un lot d'actions dans
Others ; ce cas n'est pas attendu dans une stratégie de condors et n'a pas de traitement
particulier.

### 3.6 Ligne de journal

```ts
interface JournalRow {
  id: string;                 // stable : externalId d'ouverture + rang de sortie
  strategy: "wheel" | "leaps" | "condors" | "others";
  kind: "short_put" | "short_call" | "long_call" | "long_put" | "shares" | "short_shares" | "condor" | "settlement";
  ticker: string;
  label: string;              // "MQZA Oct02'26 17 Call", "MQZA", "SPY Aug29'26 IC 620/625/660/665"
  currency: string;
  startDate: string;          // YYYY-MM-DD
  quantity: number | null;    // signée : -4 pour quatre puts vendus, +200 pour des actions ; null pour un règlement en espèces non rapproché
  openPrice: number | null;
  openTotal: number | null;   // amount d'ouverture, signé (prime reçue positive)
  openCommission: number | null;
  openNet: number | null;     // openTotal + openCommission
  assigned: boolean;          // option : assignée ou exercée ; actions : livrées par une option
  endDate: string | null;
  closePrice: number | null;
  closeTotal: number | null;
  closeCommission: number | null;
  closeNet: number | null;
  pnl: number | null;         // openNet + closeNet, null tant que la ligne est en cours
  ongoing: boolean;
  event: "buyback" | "sold" | "expired" | "assigned" | "exercised" | null;
  orphan: boolean;
  openIds: string[];          // externalId des transactions d'ouverture
  closeIds: string[];
  legs?: JournalRow[];        // condor seulement : les quatre jambes
}
```

Règles de remplissage :

- Une ligne d'option fermée par assignation ou exercice a `closePrice = 0`, `closeTotal = 0`
  (ou le règlement en espèces), `assigned = true`, `event` renseigné. Une ligne d'actions
  née d'une livraison a `assigned = true` dès l'ouverture ; des actions achetées directement
  ont `assigned = false`. C'est ce champ qui distingue les deux pour la couleur (§7.1) et
  les statistiques (§5).
- **`ongoing`** : `true` tant que le lot n'est pas fermé. Un put assigné garde `ongoing =
  true` tant que les actions qu'il a livrées ne sont pas toutes revendues, comme demandé ;
  son `pnl` est néanmoins calculé (prime nette), la ligne actions portant le résultat de la
  revente. Un call exercé suit la même règle avec les actions qu'il a livrées.
- `pnl` d'une ligne actions = `closeNet + openNet` (revente moins achat), `null` en cours.
- Une valeur absente reste `null`, jamais `0`.
- Les montants sont dans la devise de la transaction, jamais convertis.
- Tri de sortie : `startDate` décroissante, puis `id`.

### 3.7 Libellés

`formatContractLabel(contract)` dans `src/journals/label.ts` : `MQZA Oct02'26 17 Call`,
`MQZA Oct02'26 17 Put`, `MQZA` pour des actions, `SPY Aug29'26 IC 620/625/660/665` pour un
condor. Anglais quelle que soit la langue, comme les positions. Les strikes s'écrivent sans
zéros inutiles (`17`, `17.5`).

### 3.8 Sortie

```ts
interface JournalsReport {
  rows: JournalRow[];                    // toutes stratégies, triées
  reconciliation: Reconciliation;        // §4
  stats: Record<"wheel" | "leaps" | "condors", StrategyStats[]>;   // §5
}
```

Les pages filtrent `rows` par stratégie. `others` n'a pas de statistiques.

---

## 4. Contrôle de cohérence

```ts
interface Reconciliation {
  asOf: string | null;                   // null sans snapshot
  differences: { contract: ContractKey; label: string; ledgerQty: number; snapshotQty: number }[];
  orphans: JournalRow[];
}
```

- Le rejeu de comparaison s'arrête aux transactions dont `when` est **au plus** au `asOf`
  du snapshot (jour entier pour un `asOf` Flex, instant pour un `asOf` agent) : les
  exécutions intraday de l'agent viennent après un snapshot Flex de la veille. Les journaux
  et les statistiques, eux, utilisent tout le ledger. Concrètement, le moteur rejoue une fois
  tout le ledger et relève l'état des lots au passage de la borne.
- Les lots ouverts à la borne, agrégés par contrat, sont comparés aux positions du snapshot
  en `STK` et `OPT`, sur `symbol`, `secType`, `right`, `strike`, `expiry`, **en quantité
  seulement**, jamais en prix. Toute position d'un côté absente de l'autre, ou de quantité
  différente, est une différence. Les positions d'autres `secType` sont ignorées.
- Sans snapshot : `asOf = null`, `differences = []`, et l'écran le dit (§7.2).
- Une liste vide est l'**oracle** du moteur (§9.2). `alpha`, dont l'historique ne remonte
  pas à l'ouverture du compte, restera en écart par construction : l'écran l'affiche comme
  une information, jamais comme une erreur.

---

## 5. Statistiques

```ts
interface StrategyStats {
  currency: string;
  total: number;
  months: { month: string; pnl: number }[];   // "2026-08", mois consécutifs du premier au dernier flux, zéros inclus
  incomplete: number;                          // contributions ignorées faute de montant
}
```

Une entrée par devise présente dans les lignes de la stratégie, sans conversion. Par ligne :

| `kind` | À l'ouverture (mois de `startDate`) | À la fermeture (mois de `endDate`) |
|---|---|---|
| option, condor | `openNet` | `closeNet` |
| `shares`, `short_shares` avec `assigned = true` | rien | `pnl` |
| `long_call`, `long_put` | rien | `pnl` |

Une ligne `shares` ouverte par un achat direct (Others) n'a pas de statistiques, Others n'en
ayant pas. `total` = somme de toutes les contributions ; il inclut donc les primes des
positions en cours (§2.4). Une contribution `null` (montant absent) est ignorée et comptée
dans un champ `incomplete: number` de `StrategyStats`, affiché en note.

---

## 6. `apps/web` : hook

`useJournals(accountId): JournalsView` dans `db/hooks.ts` :

```ts
type JournalsView =
  | { status: "loading" }
  | { status: "ready"; report: JournalsReport };
```

`useLedger` + `useSnapshot`, puis `useMemo(() => buildJournals(ledger, snapshot ?? undefined))`.
Aucune écriture en base ; le calcul se refait à chaque changement du ledger ou du snapshot,
ce qui reste instantané à l'échelle d'un compte (quelques centaines de lignes par an).

---

## 7. Pages

### 7.1 Journal (`JournalPage`, quatre routes)

Un composant, paramétré par la stratégie. De haut en bas :

- Titre, filtre texte sur le ticker (même motif que Positions).
- **Carte de cohérence** (§7.2), identique sur les quatre pages.
- **Table** dans un conteneur `overflow-x-auto`, seize colonnes dans l'ordre demandé : Date
  début, Label, Ticker, Quantité, Prix initial, Prix total initial, Commission initiale,
  Assigné, Prix total initial net, Date fin, Prix final, Prix total final, Commission
  finale, Prix total final net, Gain/perte, En cours. Assigné et En cours s'affichent `1`
  ou `0`. Valeur absente → « — ». Montants au format de `formatAmount`, prix au format de
  `formatPrice`.
- **Condor** : ligne repliée par défaut, un bouton de dépli montre les quatre jambes en
  lignes secondaires, mêmes colonnes.
- **Couleur de la cellule Label**, par `kind` et `ongoing`, dans les quatre journaux :

  | Ligne | Couleur |
  |---|---|
  | `shares` avec `assigned = true`, en cours | bleu |
  | `short_call` en cours | orange |
  | `short_put` en cours et non assigné, `long_call`, `condor` en cours | vert |
  | `short_put` assigné, encore en cours | aucune (la ligne d'actions porte le bleu) |
  | tout le reste | aucune |

  Trois classes utilitaires sur des jetons de `index.css`, pas des couleurs en dur dans le
  composant ; lisibles en thème sombre.
- État vide : « Aucune position pour cette stratégie ». État de chargement : une ligne.

### 7.2 Carte de cohérence (`ReconciliationCard`)

Trois états :

- **conforme** : `differences` vide et snapshot présent — « Portefeuille reconstitué conforme
  au snapshot du {date} », badge vert ;
- **écarts** : liste `label : ledger N, snapshot M`, plus les lignes orphelines s'il y en a,
  badge ambre, texte qui explique qu'un historique incomplet suffit à l'expliquer ;
- **sans snapshot** : « Aucun snapshot de positions : importez un Flex ou lancez l'agent »,
  neutre, avec un lien vers Sources de données.

### 7.3 Statistiques (`StatsPage`, trois routes)

- Carte **Profit/Perte total**, un montant par devise, vert ou rouge selon le signe.
- **Histogramme mensuel** ECharts (`renderer: "svg"`, comme la jauge du Dashboard) : une
  barre par mois, verte si positive, rouge si négative, tooltip avec le montant ; couleurs
  lues dans le même tableau de jetons clair/sombre que la jauge, à factoriser dans
  `lib/chartColors.ts` pour que les deux pages partagent la source.
- Un sélecteur de devise n'apparaît que si la stratégie en compte plusieurs.
- Note « n montants absents ignorés » si `incomplete > 0`.
- État vide : « Aucune donnée ».

### 7.4 Menu et routes

- `router.tsx` : les trois `PlaceholderPage` remplacées, `journal/others` et
  `stats/{wheel,leaps,condors}` ajoutées ; `premiums → journal/wheel` conservée.
- `app-sidebar.tsx` : section Stratégies à quatre entrées, nouvelle section Statistiques à
  trois entrées, entre Stratégies et Configuration.
- `PlaceholderPage` supprimée si plus rien ne l'utilise.
- i18n `fr` et `en` : clés `nav.others`, `nav.sections.stats`, `nav.statsWheel`…, `journal.*`,
  `stats.*`, `reconciliation.*`.

---

## 8. `packages/ib-parsers` : corpus d'oracle

L'anonymiseur `scripts/anonymize-flex.mjs` reçoit une option `--full` qui lève le plafond de
40 lignes par section, et trois amendements qui valent pour les deux modes :

- les **strikes** sont mappés par rang croissant (comme les montants), pour préserver
  l'ordre `K1 < K2 < K3 < K4` d'un condor ;
- une transaction `STK` de commission nulle dont le `tradePrice` est égal à un strike
  d'option du fichier reçoit le **strike mappé** comme prix, pour préserver l'égalité
  `prix de livraison = strike` qui porte l'inférence des assignations (§3.3). Le mappage
  des montants du reste de la ligne (`proceeds`, `cost`, `netCash`) reste celui des autres
  lignes : la cohérence `proceeds = −quantité × prix` n'est pas préservée et le moteur ne
  s'y fie jamais. La garde de commission nulle — la même qu'une livraison porte toujours —
  évite qu'une transaction `STK` ordinaire, commissionnée, dont le prix coïncide par
  hasard avec un strike du fichier, ne fabrique une fausse égalité et donc une assignation
  fantôme ;
- les **quantités** (actions, contrats, `position` des Open Positions) sont **laissées
  réelles**, délibérément, dans les deux modes. Le contrôle de cohérence (§4) exige une
  identité additive — la quantité d'une position doit égaler la somme des quantités des
  transactions de ce même contrat — et la seule famille de fonctions additives est la
  multiplication par une constante, `f(x) = S×x`, quelle que soit cette constante,
  laquelle se divise toujours pour retrouver x. Anonymiser les quantités tout en gardant
  un oracle de réconciliation significatif est donc mutuellement exclusif : une revue de
  dépôt a retrouvé jusqu'à 291 des 291 quantités réelles d'options à partir de la fixture
  committée, sous une échelle par contrat pourtant conçue pour varier d'un contrat à
  l'autre. Le propriétaire du dépôt a tranché en faveur de l'oracle : la taille des
  positions n'est pas jugée assez sensible pour renoncer à une réconciliation authentique.
  Tous les autres champs (compte, identifiants, tickers, strikes, montants, ISIN) restent
  anonymisés. Dette actée dans `docs/points-reportes.md`.

La commande `node scripts/anonymize-flex.mjs --full ../../private/flex_<compte>_<date>.xml
> tests/fixtures/flex_journals_corpus.xml` produit la fixture, committée. La fixture
existante `flex_activity_sample.xml` **n'est pas régénérée** par ce sous-projet : le corpus
de `tools/coverage-oracle` en dérive, et la régénérer demanderait le run Python que ce
sous-projet exclut délibérément (`pnpm oracle`). Elle sera régénérée à la prochaine
régénération de l'oracle de couverture.

---

## 9. Tests

### 9.1 `packages/ledger`, Vitest

Fixtures de séquences écrites à la main avec `tx()` de `fixtures.ts`, une par règle, chaque
test comparant la liste de `JournalRow` attendue **à l'identique** (`toEqual` sur les
champs métier) :

- cycle Wheel complet : vente de put, assignation, ligne actions, deux ventes de call, call
  assigné, ligne actions fermée, `ongoing` du put qui passe à `false` ;
- sortie en plusieurs événements : 4 puts, 2 rachetés, 2 assignés, prorata ;
- les quatre cas d'arbitrage du call vendu (`N >= Aw + Lw`, `N = Aw`, `N = Lw`, strike
  au-dessus et en dessous du prix moyen d'assignation) ;
- LEAPS avec call couvert le même jour, échéances différentes ; seuil de 3 mois à la limite,
  des deux côtés ;
- condor entier, expiration des quatre jambes ; jambes rachetées une à une, date de fin =
  dernière ; fermeture partielle en quantité ;
- spread à deux jambes → Others, une ligne par jambe ;
- `OptionCashSettlement` rapproché, et non rapproché ;
- fermeture orpheline ; call assigné au-delà des actions détenues ;
- règlement à prix 0 d'un lot dont la livraison sert deux lots ;
- statistiques sur ces mêmes fixtures : mois, total, devise, `incomplete` ;
- contrôle de cohérence : borne `asOf` Flex (jour) et agent (instant), différence de
  quantité, position absente d'un côté ;
- `formatContractLabel` sur les quatre formes.

### 9.2 Oracle

`journals.oracle.test.ts` parse `flex_journals_corpus.xml` avec `parseFlexXml`, rejoue le
ledger contre le snapshot du même fichier et exige `differences = []` et `orphans = []`, plus
un comptage exact des événements (7 `assigned`, 6 `expired` sur le corpus, sous forme de
constantes commentées) et la répartition exacte des lignes par stratégie (`wheel`, `leaps`,
`condors`, `others`), pour que les tâches 5 et 6 de classement soient aussi couvertes par cet
oracle plutôt que seulement par les fixtures écrites à la main. Un second test,
`journals.private.test.ts`, fait de même sur
`private/flex_<compte>_<date>.xml` et est **ignoré** (`describe.skipIf`) quand le fichier
est absent : il ne tourne que sur la machine de l'auteur et jamais en CI, mais garantit que
l'anonymisation n'a pas maquillé un défaut.

### 9.3 `apps/web`, Vitest sur `fake-indexeddb`

Ledger semé en base, jamais de hook moqué :

- `JournalPage` : lignes présentes pour la stratégie et absentes pour les autres, colonnes
  dans l'ordre, couleurs de label par `kind`, dépli d'un condor, filtre ticker, état vide ;
- `ReconciliationCard` : trois états ;
- `StatsPage` : total par devise, histogramme rendu (`data-testid`), sélecteur de devise
  absent avec une seule devise, note `incomplete` ;
- `app-sidebar` : sept entrées, deux sections ; routes.

### 9.4 Validation visuelle

`run-frontend --import=private/flex_<compte>_<date>.xml --ib-account=…` puis capture des
sept pages, pour l'œil ; pas de test Playwright nouveau.

---

## 10. Ordre du plan

1. Types, `ContractKey`, `formatContractLabel`.
2. Lots, FIFO, scission, événements inférés, livraisons, règlement en espèces, orphelins.
3. Classement Wheel et LEAPS, arbitrage des calls vendus.
4. Condors, combinaisons vers Others.
5. Contrôle de cohérence ; anonymiseur amendé, corpus, oracle.
6. Statistiques.
7. `useJournals`, `JournalPage`, `ReconciliationCard`, couleurs.
8. `StatsPage`, `chartColors`.
9. Routes, menu, i18n, suppression de `PlaceholderPage`.
10. Documents (§11), revue de branche, merge.

Le moteur est fini et vérifié par l'oracle avant qu'une page n'existe.

---

## 11. Documents amendés et dette

### 11.1 Spec fondateur

- §6.5 : les règles d'appariement renvoient à ce spec ; un quatrième journal, Others.
- §9 : quatre routes de journal et trois routes de statistiques ; section Statistiques.
- §12 : sous-projet 5 fait.

### 11.2 `CLAUDE.md`

- Tableau des sous-projets : 5 fait.
- Règles qui mordent : « Les journaux sont une vue calculée du ledger, jamais stockée » ;
  « Les événements d'option (assignation, exercice, expiration) sont inférés par
  `buildJournals`, jamais lus d'une colonne » ; « `LEAPS_MIN_MONTHS` vit dans
  `packages/ledger` ».

### 11.3 `docs/points-reportes.md`

- La colonne `Code` du relevé HTML n'est pas lue.
- Les `corporate_action` ne sont pas rejouées.
- Statistiques sans conversion de devises.
- Filtres avancés, tri par colonne, export des journaux.
- L'anonymiseur ne préserve pas `proceeds = −quantité × prix`.
- Et tout ce que la revue de branche aura relevé.

---

## 12. Décisions prises pendant le brainstorming

- LEAPS = call acheté avec une échéance à 3 mois calendaires ou plus.
- Une ligne par condor, jambes au dépli.
- Une ligne par événement de sortie, prorata sur l'initial.
- Statistiques en flux de trésorerie, mois de l'encaissement.
- « Ajouter aux deux journaux » = scinder la vente de calls en deux lignes, jamais dupliquer.
- Condor en cours en vert, comme un put vendu ou un call acheté en cours.
- Aucun champ `code` sur `Transaction` ; inférence.
- Pages séparées pour les statistiques, deux sections de menu.
