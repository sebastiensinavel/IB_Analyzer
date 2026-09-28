# Sous-projet 34 — La page Positions Condors, un condor par ligne

Statut : spec en relecture (2026-09-28).

La page Positions de la stratégie Condors montre aujourd'hui les jambes une à une, dans les
encadrés « Options achetées » et « Options vendues » de la page Positions (sous-projet 21). Avec
plusieurs condors en cours, on ne voit plus quelle jambe appartient à quel condor, ni surtout si
chaque condor est en gain ou en perte : il faudrait additionner à la main quatre lignes dispersées
dans deux tableaux.

Ce sous-projet regroupe les jambes sous leur condor, comme le journal des Condors le fait déjà :
une ligne par condor, ses quatre jambes dépliables en dessous. C'est une vue calculée, jamais
stockée, comme `strategyPositions` (sous-projet 16).

---

## 1. Périmètre

**Critère de réussite :** avec deux iron condors vendus en cours sur le même compte, la page
Positions Condors montre deux lignes, chacune avec son crédit, son coût de clôture et son P/L ;
un clic sur le chevron d'une ligne montre ses quatre jambes, et la somme des P/L des jambes
vaut le P/L du condor.

Dans le périmètre : la vue calculée `condorPositions` (§2), la ligne du condor et ses jambes (§3,
§4), la jambe nue (§5), l'encadré, la recherche, les échéances, le tri et les filtres (§6), les
textes (§7), les tests (§8).

Hors périmètre : le moteur de journaux (classification, `detectCondor`, `condorRows`), le
journal des Condors, le capital, le Dashboard, la barre de titre, la page Positions et les pages
Wheel, LEAPS et Autres. La page Autres montre toujours la part nue d'une jambe de condor
(sous-projet 22), sans changement. **Les condors achetés** (put vendu < put acheté < call acheté
< call vendu) ne sont pas reconnus par `detectCondor` et partent dans Autres : ce sous-projet ne
les reconnaît pas et ne prépare aucun tableau pour eux (arbitré le 2026-09-28, §9).

## 2. La vue calculée

`condorPositions(rows, snapshot)` dans `packages/coverage/src/condors.ts`, exportée par
`@ib/coverage`. Elle lit les lignes composites du journal (`kind === "condor"`,
`strategy === "condors"`) **ouvertes** (`endWhen === null`) et rend une `CondorLine` par ligne
composite, jamais par lot : un condor racheté en partie est déjà plusieurs lignes au journal
(`condorRows`, une par groupe d'unités de même sortie) ; la partie close y a une date de fin et
ne paraît pas, la partie ouverte paraît avec la quantité qu'elle couvre. La page montre donc
exactement les condors ouverts du journal.

Chaque jambe (`row.legs`) est appariée au snapshot par `contractId(leg.contract)`, la clé de la
réconciliation, comme `strategyPositions`. Seul le dernier prix d'IB (`marketPrice`) et les
valeurs du jour en sont lus ; quantité et prix d'entrée restent ceux du journal.

`strategyPositions` n'est plus appelée pour la page Condors. Elle garde son comportement pour
toute autre lecture (la page Autres continue d'y lire la part nue des jambes de condor).

## 3. La ligne du condor

Sur les douze colonnes de `POSITION_COLUMNS`, dans leur ordre actuel :

| Colonne | Contenu |
|---|---|
| Position | libellé du journal (`formatCondorLabel`, p. ex. `XSP Oct17'26 IC 560/565/600/605`), précédé du chevron de dépliage |
| Type | `iron condor` ; `partial iron condor` dès qu'une de ses jambes est fermée — libellés du moteur, en anglais et tels quels comme `KIND_LABELS` (`CONDOR_KIND_LABELS`) |
| Secteur | secteur du sous-jacent, lu dans la table sectorielle |
| Valeur de marché | somme des valeurs de marché des jambes ouvertes |
| Quantité | quantité du composite, négative : −n condors vendus |
| Prix init. | crédit net par action encaissé à l'ouverture (`openPrice` du composite) |
| Dernier prix | coût net de clôture par action des jambes ouvertes : Σ −signe(quantité) × dernier prix |
| Var. jour | toujours « — » (§3.2) |
| P&L jour | somme des P&L du jour des jambes ouvertes |
| P/L latent | **P/L total** du condor (§3.1) |
| Décision | règle de rachat sur le condor (§3.3) |
| Couverture | vide, sauf une jambe nue (§5) |

Une valeur qui dépend d'une jambe ouverte sans prix (ou sans valeur du jour) est `null` et
s'affiche « — » : valeur de marché, dernier prix, P&L jour, P/L total et décision. Sans snapshot,
toutes le sont.

### 3.1 P/L total

Le P/L d'un condor est ce qu'il rapporterait clôturé maintenant : **le réalisé de ses jambes
fermées plus le latent de ses jambes ouvertes** (arbitré le 2026-09-28). Réalisé d'une jambe
fermée : le `pnl` de sa ligne de journal, commissions comprises. Latent d'une jambe ouverte :
`valeur de marché − prix d'entrée × quantité × multiplicateur`, la formule de `strategyPositions`.
Pour un condor complet, c'est le latent seul. La colonne garde son titre partagé ; sur un condor
partiel, une infobulle sur la cellule donne la part réalisée.

### 3.2 Var. jour

Un pourcentage rapporté à la valeur d'un condor, proche de zéro et de signe variable, ne veut
rien dire. La colonne reste « — » sur la ligne du condor, et donne sur une jambe ouverte la
variation de sa position IB (`dayShare`), comme aujourd'hui.

### 3.3 Décision

`evaluateBuyback(crédit, coût de clôture)` : « Racheter » quand le coût net de clôture est
tombé à `crédit / BUYBACK_RATIO` ou moins, « Garder » sinon (arbitré le 2026-09-28). Seulement
pour un condor complet ; un condor partiel a « — », son crédit d'origine ne se compare plus aux
jambes qui restent.

## 4. Les jambes dépliées

Un chevron dans la cellule Position déplie les quatre jambes sous leur condor, dans l'ordre de
`CondorLegs` (put acheté, put vendu, call vendu, call acheté), en retrait et en teinte atténuée,
comme dans le journal (`JournalPage`). Même douze colonnes :

- **Jambe ouverte** : libellé du contrat, type (Put acheté…), secteur, valeur de marché,
  quantité, prix d'entrée, dernier prix, variation et P&L du jour (`dayShare`), P/L latent.
  Aucune décision par jambe.
- **Jambe fermée** : type suivi de « fermée », prix d'entrée, **prix de clôture** dans Dernier
  prix, P/L réalisé ; valeur de marché et valeurs du jour « — ».

Un clic ailleurs sur la ligne du condor ouvre le graphe de cours du sous-jacent, comme sur les
autres pages, avec les niveaux des seuls Condors (`strategyLevels`). Un clic sur une jambe ne fait
rien. Le dépliage est un état de la page, jamais mémorisé.

## 5. Une jambe nue reste dans son condor

Quand l'aile d'un condor est fermée et sa jambe vendue gardée, IB voit cette vente nue :
`uncoveredQuantity` du contrat dans le rapport de risque. La règle du sous-projet 22 ferait
quitter cette part à la page de stratégie. **Pour les Condors, la jambe reste dans son condor**
(arbitré le 2026-09-28) : l'en retirer fausserait le P/L total, qui est l'objet de la page.

La part nue des Condors sur un contrat est celle que `migratedContracts` leur retire déjà pour
la page Autres (sous-projet 22) : les deux pages lisent le même nombre et ne se contredisent
jamais. Elle se répartit entre les jambes vendues ouvertes qui portent ce contrat, chacune au plus sa
quantité : d'abord celles dont l'aile du même côté (même right, jambe achetée) est fermée — ce
sont elles qu'IB voit nues —, puis les autres, dans l'ordre d'ouverture des condors. Une jambe qui en reçoit porte le
badge `UNCOVERED ×n` dans Couverture, et la ligne de son condor `UNCOVERED ×Σn`. Le filtre de
Couverture de l'encadré lit la valeur `UNCOVERED`, jamais le texte du badge. La page Autres
continue de montrer cette même part : la jambe paraît sur deux pages, jamais deux fois sur une
seule. CLAUDE.md note l'exception.

## 6. La page

`STRATEGY_BOXES.condors` déclare un seul encadré, `condors`, titré « Condors en cours », à la
place d'« Options achetées » et d'« Options vendues ». Un encadré sans ligne ne se rend pas,
comme aujourd'hui ; la page montre alors « aucun résultat ».

La recherche par ticker, la barre d'échéances (`expiryChoices` sur les échéances des condors) et
le tri et les filtres par colonne portent **sur les lignes de condor seules**, comme au journal :
une jambe suit toujours son condor et n'est jamais filtrée à part. Les colonnes se trient et se
filtrent sur les valeurs de la ligne du condor ; la Couverture sur `UNCOVERED` ou rien.

La vue de l'encadré est un état d'affichage en `localStorage`, sous la clé
`ib2:tableView:<compte>:positions:condors:condors`, effacée par `deleteAccount` avec les autres.
Les clés des anciens encadrés `optionBuys` et `optionSells` des Condors ne sont plus lues.

## 7. Textes

En français et en anglais (`apps/web/src/i18n/{fr,en}.json`) : le titre de l'encadré (« Condors
en cours » / « Open condors »), le marqueur de jambe fermée (« fermée » / « closed »), l'infobulle du
réalisé (« dont réalisé {{amount}} » / « of which realized {{amount}} ») et les libellés du
chevron (réutiliser `journal.expand` / `journal.collapse`). Les types restent les libellés
anglais du moteur (§3), comme ceux des jambes.

## 8. Tests

Vitest écrits à la main sur `condorPositions` (`packages/coverage`) :

- condor complet : crédit, coût de clôture, valeur de marché, P/L total = Σ latents, décision
  « Racheter » sous la moitié du crédit et « Garder » au-dessus ;
- condor partiel (aile call rachetée) : type partiel, P/L = réalisé + latent, décision `null` ;
- rachat partiel en unités : seule la part ouverte paraît, à sa quantité ;
- jambe ouverte sans prix : valeurs dépendantes `null`, jamais 0 ;
- sans snapshot : une ligne par condor, prix et P/L `null` ;
- jambe nue : badge sur la jambe et sur le condor ; deux condors sur le même contrat, la part nue
  va à celui dont l'aile est fermée, même ouvert après l'autre ;
- deux condors sur les mêmes strikes, ouverts à des instants différents : deux lignes.

Page (`StrategyPositionsPage.test.tsx`, `fake-indexeddb`, ledger semé en base) : une ligne par
condor, ses jambes absentes puis présentes après un clic sur le chevron, P/L total affiché,
recherche par ticker qui garde les jambes sous leur condor, plus aucun encadré « Options
achetées » ni « Options vendues » sur la page Condors.

## 9. Décisions arbitrées

- Jambes dépliables sous leur condor, comme au journal, plutôt que masquées (2026-09-28).
- P/L total (réalisé + latent) sur un condor partiel, plutôt que le latent seul (2026-09-28).
- Règle de rachat appliquée au condor entier, pour un condor complet seulement (2026-09-28).
- Une jambe nue reste dans son condor, par exception à la règle du sous-projet 22 (2026-09-28).
- Colonnes dans l'ordre de `POSITION_COLUMNS`, Secteur compris (2026-09-28).
- Un seul tableau, les ventes : la reconnaissance des condors achetés n'est pas faite ici
  (2026-09-28).
