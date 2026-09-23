# Sous-projet 30 — Les stratégies actives d'un compte

Statut : conçu (2026-09-23).

L'application reconstitue trois stratégies (Wheel, LEAPS, Condors) plus Autres, et le menu
porte une section pour chacune. Un utilisateur qui ne pratique que la Wheel voit pourtant trois
sections dont il n'a que faire, et ses rares achats de calls longs s'y rangent en « LEAPS ».

Ce sous-projet laisse chaque compte Interactive Brokers choisir ses stratégies actives. Une
stratégie inactive disparaît du menu, et ce qu'elle aurait pris va dans Autres. Deux comptes
suivis dans le même navigateur peuvent avoir des stratégies différentes.

Rien n'est stocké hors du réglage lui-même : les journaux restent une vue calculée du ledger,
recalculée dès qu'une case change.

---

## 1. Périmètre

**Critère de réussite :** sur un compte où seule la Wheel est active, un call XYZ acheté à six
mois, puis un call XYZ vendu à un mois contre lui, se rangent tous deux dans Autres ; le menu ne montre que les sections Wheel et Autres ; la page Autres montre le call
vendu avec le badge `leaps` que lui donne la couverture IB, pas `UNCOVERED` ; le tableau de bord
ne compte que la Wheel. Cochez LEAPS : les deux lignes passent dans le journal LEAPS, la section
LEAPS réapparaît, le tableau de bord les compte.

Dans le périmètre : le réglage par compte (§2), le classement du moteur (§3), statistiques,
capital et tableau de bord (§4), la couverture lue par Autres (§5), l'application — Sources de
données, menu, routes, graphes (§6), la déclaration unique des stratégies (§7), la
documentation (§8), les tests (§9).

Hors périmètre : la barre de titre et la page Consistance (le moteur de couverture IB ignore
les stratégies), la table sectorielle, la Suggestion de position (elle mesure en valeur de
risque, jamais par stratégie), l'état d'affichage `localStorage` des tableaux d'une stratégie
désactivée, qui reste en place et resservira si on la réactive. Aucune transition pour les
comptes existants : un compte sans réglage est un compte « Wheel seule ».

## 2. Le réglage

`AccountRecord.strategies?: ActivableStrategy[]` (`apps/web/src/db/schema.ts`), champ
facultatif, non indexé : ni version Dexie ni migration. Il se lit **par une seule fonction**,
`activeStrategies(account)` (`apps/web/src/lib/strategies.ts`), sur le modèle de
`flexRelayMode` : absent vaut `["wheel"]`, `DEFAULT_ACTIVE_STRATEGIES`. Une liste vide est
permise et veut dire « tout dans Autres ». La fonction rend la liste dans l'ordre de
`ACTIVABLE_STRATEGIES`, dédoublonnée, sans valeur inconnue — une valeur qu'un navigateur plus
récent aurait écrite et que celui-ci ne connaît pas est ignorée, jamais une erreur.

L'écriture passe par `setActiveStrategies(db, accountId, strategies)` (`db/accounts.ts`, qui écrit
déjà la fiche), qui écrit toujours la liste complète, jamais un champ absent.

La sauvegarde chiffrée emporte la fiche du compte, donc le réglage, sans rien changer. L'export
local `.json.gz` aussi.

## 3. Le classement

`buildJournals(transactions, snapshot?, identities?, active?)` reçoit un quatrième argument,
`active: readonly ActivableStrategy[]`, **qui vaut `ACTIVABLE_STRATEGIES` quand il est absent**.
Le moteur appelé sans liste garde donc exactement son comportement d'avant : l'oracle
`flex_journals_corpus.xml` et tous les tests existants restent verts sans changement. Le défaut
« Wheel seule » appartient à l'application, jamais au moteur.

Le contexte de rejeu (`ReplayContext`) porte l'ensemble actif ; `classify.ts` le lit à trois
endroits, et nulle part ailleurs :

- **Condors inactif** : `classifyOpenings` n'appelle pas `detectCondor`. Un groupe d'au moins
  deux contrats ouvert au même instant, même sous-jacent, même échéance, va **tout entier** dans
  Autres — le sort que connaît déjà toute combinaison qui n'est pas un condor. Ses jambes ne
  passent jamais une à une par le classement des ouvertures seules : un put vendu d'une aile
  entrerait dans la Wheel et un call vendu y reprendrait des actions, alors que la couverture IB
  les voit couverts par l'autre aile.
- **LEAPS inactif** : un call acheté ne devient jamais LEAPS (`openSingle`), il va dans Autres.
  Aucun lot `leaps` n'existant, `leapsCapacity` vaut 0 de lui-même ; il est néanmoins court-circuité
  à 0, pour que la règle ne dépende pas d'un effet de bord.
- **Wheel inactive** : un put vendu va dans Autres, et `wheelCapacity` vaut 0 : aucun call vendu
  n'est jamais classé Wheel, aucune action n'est reprise (`takeOverShares`), aucun lot n'est Wheel.
  `splitShortCall` n'est pas modifié : avec une capacité Wheel nulle, il envoie déjà le call aux
  LEAPS s'ils le couvrent, sinon à Autres.

La règle générale, que les trois cas appliquent : **une ouverture est proposée aux seules
stratégies actives ; si aucune ne la prend, elle va dans Autres.** Tout ce qui suit le classement
— livraison d'actions qui hérite de la stratégie de l'option, `closePreferring`, opérations sur
titres, fusion des tranches — reste tel quel : il lit la stratégie déjà posée sur le lot.

Une ligne orpheline va dans Autres, comme aujourd'hui, quel que soit le réglage.

## 4. Statistiques, capital et tableau de bord

`JournalsReport.stats` et `.capital` gardent leur type `Record<CapitalScope, …>`. Pour une
stratégie inactive, les deux valent `[]` : elle n'a ni statistiques ni capital, et sa page n'est
de toute façon plus atteignable (§6.3).

**La portée `portfolio` lit la liste active**, jamais la constante à trois stratégies :
`SCOPE_STRATEGIES` devient une fonction `scopeStrategies(scope, active)`, qui rend `[scope]` pour
une stratégie et `active` pour `portfolio`. Le tableau de bord ne compte donc que les stratégies
actives, toujours par un seul appel de `computeStats` et `computeCapital` sur plusieurs
stratégies, jamais par addition. Autres n'y entre jamais : ce qu'une stratégie désactivée aurait
pris sort du tableau de bord. C'est voulu (décision de l'utilisateur, 2026-09-23). Avec aucune
stratégie active, le tableau de bord montre son état vide.

## 5. Autres lit la couverture réelle

Jusqu'ici, Autres voulait dire « ce que rien ne couvre » : `STRATEGY_COVER_SOURCES.others` est
vide, chaque vente d'Autres porte `UNCOVERED ×|quantité|`, et `migratedContracts` retranche toutes
les ventes d'Autres du nu qui peut migrer. Une stratégie désactivée y envoie désormais des ventes
couvertes : un call contre un LEAPS, un put garanti par du cash, une jambe de condor.

**Autres possède les sources de couverture des stratégies inactives.**
`strategyCoverSources(strategy, active)` (`packages/coverage/src/strategy.ts`) remplace la
constante :

| Stratégie | Sources |
|---|---|
| `wheel` | `cash`, `stock` |
| `leaps` | `leaps` |
| `condors` | `spread` |
| `others` | l'union des sources des stratégies **inactives** |

Avec les trois stratégies actives, Autres ne possède rien : le comportement d'avant.

- **`migratedContracts`** reçoit les sources d'Autres. La part nue d'Autres vaut ses ventes moins
  ce que ses propres sources couvrent, plafonné par ses ventes ; ce qui peut migrer depuis une
  stratégie active vaut `uncoveredQuantity − part nue d'Autres`. Avec des sources vides, c'est la
  formule d'avant, mot pour mot. Seules les stratégies actives peuvent perdre des contrats
  (`COVERED_STRATEGIES` filtré par `active`).
- **`strategyPositions(rows, strategy, snapshot, active?)`** pose sur une ligne d'Autres les
  allocations de ses sources, plafonnées par la ligne (`cappedCoverage`), comme pour toute
  stratégie. `active` absent vaut toutes.
- **Badges et filtre Couverture d'Autres** (`strategyCoverageBadges`, `strategyCoverageValues`,
  `apps/web/src/lib/riskReport.ts`) : les badges d'allocation de la ligne, puis
  `UNCOVERED ×reste` quand `|quantité| − Σ allocations` est positif. Le filtre rend les mêmes
  valeurs : les sources présentes, plus `UNCOVERED` s'il reste un nu. Une ligne d'Autres sans
  aucune allocation garde exactement son badge d'avant.

La barre de titre ne change pas : son verdict Couverture lit le moteur IB, qui ignore les
stratégies. La page Autres ne peut donc toujours pas le contredire.

## 6. L'application

### 6.1 Sources de données

Une carte « Stratégies actives », après la carte du compte : une case par entrée de
`ACTIVABLE_STRATEGIES`, dans cet ordre, avec son libellé de menu. Cocher ou décocher écrit
aussitôt (§2), sans bouton Enregistrer. Une phrase sous les cases : ce qu'une stratégie décochée
aurait pris va dans Autres, et le tableau de bord ne compte que les stratégies cochées.

### 6.2 Le calcul

`useJournals(accountId)` lit la fiche du compte et passe `activeStrategies(account)` à
`buildJournals` ; la liste entre dans les dépendances du `useMemo`, donc cocher recalcule tout.
`AccountDataProvider` expose la liste active à côté des journaux, par un `useAccountStrategies`
qui lève hors du fournisseur comme les deux autres.
Aucune page ne relit la fiche pour la recalculer elle-même.

### 6.3 Le menu et les routes

`NAV_SECTIONS` (`apps/web/src/lib/navigation.ts`) déclare, sur chaque section de stratégie, la
stratégie qu'elle sert (`strategy?: ActivableStrategy`). La barre latérale masque une section
dont la stratégie est inactive ; la section Autres, sans `strategy`, reste toujours visible.

Une route de stratégie inactive — `journal/<s>`, `positions/<s>`, `stats/<s>` — redirige vers
`dashboard` du même compte (`<Navigate replace>`), par un garde unique posé dans le routeur
autour des trois pages. `findNavItem` ne change pas.

### 6.4 Les graphes

Positions (`PositionGroupCard`) et Suggestion de position (`PositionSuggestionsCard`) passent à
`PositionChartRow` les stratégies actives plus `others`, au lieu de `STRATEGIES`. Une page de
stratégie dessine toujours la sienne seule (Autres compris). `strategyLevels` ne change pas.

### 6.5 Aide

`help.app.text` (fr, en) dit que les stratégies suivies se choisissent par compte dans Sources de
données.

## 7. Une seule déclaration des stratégies

`ACTIVABLE_STRATEGIES = ["wheel", "leaps", "condors"] as const` (`packages/ledger/src/journals/types.ts`)
est la seule liste ; `ActivableStrategy` en est dérivé, `StatsStrategy` devient son alias, et
`STRATEGIES` est `[...ACTIVABLE_STRATEGIES, "others"]`. `DEFAULT_ACTIVE_STRATEGIES = ["wheel"]` vit
dans `apps/web/src/lib/strategies.ts`, le défaut étant un choix de l'application.

Ajouter une stratégie demandera : son entrée dans cette liste, sa règle dans `classify.ts`, ses
sources de couverture (§5), sa section de menu, ses routes et ses libellés. La carte de Sources de
données, le garde des routes, la portée du tableau de bord et les graphes suivent d'eux-mêmes.
Aucune architecture de « stratégies en modules » n'est posée d'avance (approche C écartée, §10).

## 8. Documentation

`CLAUDE.md` : la règle du tableau de bord (portée `portfolio` = stratégies actives), la règle des
positions de stratégie (Autres possède les sources des stratégies inactives), une règle nouvelle
sur le réglage (lu par `activeStrategies` seul, défaut Wheel seule, moteur par défaut à trois
stratégies), et la ligne 30 du registre.

## 9. Tests

Moteur (`packages/ledger`) :
- Wheel inactive : un put vendu va dans Autres ; un call vendu sur des actions achetées va dans
  Autres sans reprise ni événement `integrated` ; avec les LEAPS actifs, un call vendu contre un
  LEAPS reste LEAPS.
- LEAPS inactif : un call acheté à six mois va dans Autres, un call vendu contre lui aussi.
- Condors inactif : les quatre jambes d'un condor vont dans Autres, aucune ne va dans la Wheel
  même quand elle est active.
- Aucune stratégie active : toutes les lignes sont dans Autres, `stats.portfolio` et
  `capital.portfolio` sont vides.
- `stats.portfolio` suit la liste active ; une stratégie inactive a `stats` et `capital` vides.
- L'oracle rejoué sans quatrième argument : zéro écart, inchangé.

Couverture (`packages/coverage`) :
- `strategyCoverSources` pour chaque combinaison utile.
- `migratedContracts` avec une vente d'Autres couverte : ce qui migre depuis une stratégie
  active n'en est pas réduit ; avec des sources vides, les cas existants inchangés.
- `strategyPositions(…, "others", …)` pose l'allocation `leaps` sur un call quand les LEAPS sont
  inactifs.

Application (`apps/web`, `fake-indexeddb`, ledger semé) :
- `activeStrategies` : absent → Wheel ; vide → vide ; valeur inconnue ignorée ; ordre canonique.
- Sources de données : décocher LEAPS écrit la fiche ; le journal LEAPS se vide et Autres reçoit
  ses lignes.
- Menu : sections masquées selon le réglage, Autres toujours là ; deux comptes, deux menus.
- Route d'une stratégie inactive redirigée vers le tableau de bord.
- Page Autres : badge `leaps` et filtre Couverture `leaps` sur un call quand les LEAPS sont
  inactifs, `UNCOVERED ×n` pour le seul reste nu.

## 10. Décisions écartées

- **Reclasser après coup** (rejouer avec toutes les stratégies puis renommer les lignes
  inactives en `others`) : la Wheel aurait déjà coupé des lots au strike et la capacité LEAPS
  déjà déclaré couverts des calls ; Autres hériterait de ces artefacts.
- **Stratégies en modules** (un « preneur » par stratégie derrière une interface) : le classement
  arbitre entre stratégies (`splitShortCall`, condors détectés par groupe avant les ouvertures
  seules) ; le réécrire pour des stratégies inconnues mettrait en jeu un moteur validé par oracle.
  À reconsidérer quand une quatrième stratégie arrivera.
- **Autres dans le tableau de bord quand une stratégie est désactivée** : écarté par
  l'utilisateur ; le tableau de bord ne compte que les stratégies actives.
- **Gérer la transition des comptes existants** : écarté par l'utilisateur.
