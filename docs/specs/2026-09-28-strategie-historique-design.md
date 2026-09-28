# Sous-projet 37 — La stratégie de chaque ligne de l'Historique

Statut : implémenté (2026-09-28).

L'Historique liste les transactions du compte sans dire à quelle stratégie chacune a servi : pour
savoir qu'un achat d'actions est parti dans la Wheel, ou qu'une vente de 300 actions en a pris
100 à la Wheel et 200 à Autres, il faut ouvrir les journaux. Ce sous-projet ajoute une colonne
« Stratégie » à l'Historique, un badge par stratégie, calculée dans le navigateur depuis les
journaux que la coquille détient déjà — jamais stockée, rien demandé au serveur ni à l'agent.

---

## 1. Périmètre

**Critère de réussite :** sur un compte dont la Wheel a repris par un call couvert une partie
d'actions achetées au marché, la ligne de l'achat d'origine porte les badges `Autres` et `Wheel`,
la ligne du call vendu porte `Wheel` seul, un dépôt porte « — », et le filtre de la colonne
réduit l'Historique aux seules lignes de la stratégie cochée.

Dans le périmètre : la fonction pure du moteur (§2), la colonne et ses badges (§3), le filtre
(§4), les largeurs (§5), les textes (§6), les tests (§7).

Hors périmètre : une quantité par stratégie dans le badge (§2.3) ; le tri de la colonne (§4) ;
toute table, store ou migration Dexie ; toute autre page que l'Historique.

Arbitrages de Seb (2026-09-28) :

- **Le badge porte le nom de la stratégie seul**, jamais une quantité.
- Dépôts, dividendes, intérêts et change n'appartiennent à aucune stratégie : « — ».
- La clôture `integrated` d'une reprise au strike ne donne pas sa stratégie d'origine au call
  couvert qui l'a provoquée (§2.2).

## 2. Ce qui est calculé

### 2.1 `transactionStrategies` — `packages/ledger/src/journals/transactionStrategies.ts`

```ts
export function transactionStrategies(rows: readonly JournalRow[]): Map<string, Strategy[]>;
```

Lit `JournalsReport.rows` et rend, pour chaque `externalId` qu'une ligne de journal nomme, les
stratégies de ces lignes, sans doublon, dans l'ordre de `STRATEGIES` (Wheel, LEAPS, Condors,
Autres). Une transaction absente de la map n'appartient à aucune stratégie.

- Les `openIds` d'une ligne comptent toujours pour sa stratégie.
- Ses `closeIds` comptent aussi, **sauf quand `event === "integrated"`** (§2.2).
- Un condor se lit sur sa ligne composite **et sur ses jambes** : le composite porte les
  `openIds` de ses jambes, mais leurs `closeIds` seulement une fois toutes les jambes fermées
  (`journals/condor.ts`). Les ids de `legs` sont donc relus, selon les mêmes règles — une aile
  rachetée pendant que le condor reste ouvert porte Condors.
- Les tranches fondues d'un ordre (`journals/fills.ts`) gardent tous leurs ids dans `openIds` /
  `closeIds` : chaque tranche reçoit la stratégie de la ligne.
- Les stratégies sont celles que `buildJournals` a calculées avec la liste active du compte : une
  stratégie inactive n'apparaît jamais, ce qu'elle aurait pris est dans Autres.

Exportée par `packages/ledger/src/journals/index.ts`. Aucun texte : l'application traduit.

Une conversion d'opération sur titres (split, changement de CUSIP, renommage 1 pour 1) reporte
les lots sans nommer ses jambes : ses lignes affichent « — », comme un dividende. Les jambes
d'une fusion mixte, elles, portent la stratégie des lots qu'elles ferment ou ouvrent.

### 2.2 La reprise au strike

Quand un call couvert fait entrer dans la Wheel des actions détenues hors Wheel
(`journals/takeover.ts`), le lot d'origine est clos dans sa stratégie par un événement
`integrated` dont les `closeIds` sont ceux du call. Ce call est une opération de la Wheel : il ne
reçoit pas Autres ou LEAPS pour autant. L'achat d'origine des actions, lui, figure dans les
`openIds` des deux morceaux — le reste chez Autres, la part reprise dans la Wheel — et porte
donc les deux badges : c'est le cas légitime de plusieurs stratégies sur une ligne.

### 2.3 Pourquoi pas de quantité

Une ligne de journal fond plusieurs tranches d'un ordre ; quand ce lot est ensuite réparti entre
stratégies par une sortie, rien ne dit quelle tranche est allée où. Une quantité par badge serait
fausse dans ce cas, et élargirait la colonne. Le nom seul est toujours juste.

## 3. La colonne

- Clé `strategy`, placée **juste après `symbol`** dans `HISTORY_COLUMNS` et `historyColumnSpecs`.
- La page Historique calcule la map par `useMemo` sur `useAccountJournals()` — les journaux sont
  déjà calculés une fois dans la coquille, aucune page n'appelle `useJournals`. Tant que les
  journaux chargent, la cellule reste vide (ni badge ni « — ») ; prêts, une ligne sans stratégie
  affiche « — ».
- Un badge par stratégie, sur une seule ligne, dans l'ordre de §2.1, espacés de `gap-1` ; la
  cellule garde `h-9 truncate` : aucune ligne ne grandit (`HISTORY_ROW_HEIGHT`), un débordement
  est coupé, jamais renvoyé à la ligne.
- Teintes, dans un seul tableau `STRATEGY_BADGE` (`apps/web/src/lib/strategyBadges.ts`),
  tons discrets fond léger + texte de la même teinte, reprises des rôles existants de la
  palette (`chartColors.ts`, `index.css`) :
  - **Wheel** : ambre (variante `warning`) ;
  - **LEAPS** : violet (série 3, rôle LEAPS), par le token `chart-4` d'`index.css`, jamais un
    hexadécimal ;
  - **Condors** : teal (variante `success`) — Wheel et Condors échangés à la demande de Seb ;
  - **Autres** : contour neutre (`outline`), sans teinte.
  Le tableau est un `Record<Strategy, { variant, className? }>` : ajouter une stratégie sans sa
  teinte ne compile pas.

## 4. Filtre et tri

- Colonne `enum` à plusieurs valeurs, comme la Couverture de Positions : `value` rend le tableau
  des stratégies de la ligne, `[]` — une liste vide — quand elle n'en a aucune (que le filtre
  compte sous `—`), `label` traduit.
  Le filtre lit les valeurs, jamais le texte des badges.
- **Non triable** (`sortable: false`), comme la Couverture : le moteur de vue ne trie pas une
  valeur multiple, et un ordre sur la première stratégie seule serait arbitraire.
- La vue reste l'état `ib2:tableView:<compte>:history` existant ; un critère sur `strategy` s'y
  ajoute sans migration.

## 5. Les largeurs

Les douze colonnes sont remesurées d'une passe par un script, à 1280 px sur les libellés
français, avec pour la nouvelle colonne son en-tête et le cas le plus long, `Wheel` + `Autres`
côte à côte. Les pourcentages de `HISTORY_COLUMNS` restent à 100 au total. Pas d'itération sur
captures ; `pnpm check` une fois à la fin.

## 6. Textes

`history.columns.strategy` : « Stratégie » / « Strategy ». Les noms de badge vivent dans un bloc
`history.strategies` à quatre clés — le bloc de noms existant ne couvre que les trois stratégies
activables : Wheel, LEAPS, Condors, Autres / Others.

## 7. Tests

- `transactionStrategies.test.ts` : une vente coupée entre Wheel et Autres porte les deux ; une
  reprise au strike donne Wheel seul au call et Autres + Wheel à l'achat d'origine ; les jambes
  d'un condor portent Condors, une aile rachetée pendant que le condor reste ouvert aussi ; un
  LEAPS acheté porte LEAPS ; une stratégie inactive n'apparaît jamais ; un dépôt est absent ;
  des tranches fondues portent toutes la stratégie ; ordre de `STRATEGIES`.
- `historyColumns.test.ts` : la colonne `strategy` suit `symbol`, les largeurs somment à 100,
  sa valeur est la liste des stratégies ou `[]`.
- Page Historique sur `fake-indexeddb` avec un ledger semé : les badges s'affichent, « — » pour
  un dépôt, le filtre Wheel ne garde que les lignes Wheel.
- `CLAUDE.md` : la règle (vue calculée, jamais stockée, nom seul, `integrated` exclu) et la
  ligne 37 du registre.
