# Sous-projet 24 — L'assignation d'après minuit

Statut : spécifié (2026-09-19).

Le 2026-09-19, la page Consistance des deux comptes signale des écarts de reconstitution après
les assignations de l'échéance du vendredi 2026-09-18 : six lignes sur un compte, quatre sur
l'autre. Chaque assignation est dans le ledger **deux fois**, une fois par Flex, une fois par
l'agent TWS — exactement le symptôme que le sous-projet 18 avait corrigé, sous une cause que sa
règle ne couvre pas.

---

## 1. Périmètre

**Critère de réussite :** une assignation qu'IB traite après minuit, heure de New York, ne
compte qu'une fois, quel que soit l'ordre des synchros ; le doublon déjà écrit disparaît à la
prochaine synchro Flex, sans migration.

Dans le périmètre :

1. la notion de **jour de marché** : la nuit qui suit une séance, et le week-end qui la suit,
   appartiennent à cette séance (§3) ;
2. les deux bornes de propriété de plage qui la lisent — `planFlex` et `planAgent` (§4) ;
3. ce que la correction ne touche pas, et les tests qui le fixent (§5, §6).

Hors périmètre, délibérément (arbitré le 2026-09-19) : le recouvrement entre relevés HTML et
agent quand un compte n'a **aucune** ligne Flex. `planAgent` ne filtre alors rien
(`flexMax === null`) et `planStatement` ne supprime jamais une ligne agent ; le même doublon
passerait. Aucun des comptes réels n'est dans ce cas. La ligne reste consignée dans
`docs/points-reportes.md`.

Hors périmètre aussi : tout calendrier de jours fériés (§8).

---

## 2. Ce que disent les données

### 2.1 La chronologie observée

Relevé de la table `transactions` du profil, lignes postérieures au 2026-09-18 (tickers
anonymisés, une ligne par contrat) :

| `when` stocké | Source | Contrat | Qté |
|---|---|---|---|
| 2026-09-18T16:20:00Z | `flex` | put `ZKVA` échéance du 18 | 2 |
| 2026-09-18T16:20:00Z | `flex` | actions `ZKVA` livrées au strike | 200 |
| 2026-09-18T16:20:00Z | `flex` | quatre calls, mêmes échéance et forme | 12, 3, 71, 27 |
| 2026-09-19T01:02:45Z | `agent` | les six mêmes | idem |
| 2026-09-19T01:16:47Z | `agent` | les quatre du second compte | idem |

Flex date toutes les assignations à 16:20:00 le jour de l'échéance. TWS rend l'exécution à
l'heure où IB l'a réellement traitée : **01:02:45 et 01:16:47, heure de New York, le lendemain**.
Les deux comptes ont leur lot, traité à quatorze minutes d'écart.

### 2.2 Pourquoi la règle du sous-projet 18 ne mord pas

Le sous-projet 18 avait observé la même duplication sur une assignation rendue par TWS à
**22:13** heure de New York — le soir même. Sa correction (`docs/specs/2026-09-16-plage-jours-marche-design.md`)
a donc raisonné en jours civils : Flex possède ses jours entiers, l'agent n'écrit qu'à partir du
jour suivant. Son commentaire dans `planFlex` énonce le pari : *« a response always runs to the
previous close, so its newest day is complete too: whatever the agent reported that day, at
whatever hour, Flex reports it as well »*.

Le pari tient tant que l'heure de traitement d'IB reste du même côté de minuit que le 16:20 de
Flex. Ici elle ne l'est pas :

- `planFlex` (`import.ts:105-110`) déduit `maxDay = 2026-09-18` de ses propres lignes. Les
  lignes agent sont datées `2026-09-19`, donc `day <= maxDay` est faux : elles survivent.
- `planAgent` (`import.ts:178-179`) les avait écrites la nuit même, légitimement : à cet
  instant le dernier jour Flex était le 17, et `2026-09-19 > 2026-09-17`.

Aucune des deux bornes n'est fausse en soi ; c'est la frontière entre elles qui est au mauvais
endroit. Elle est à minuit, alors que la journée de marché d'IB déborde sur les petites heures
du lendemain.

### 2.3 Ce que la base prouve

Le ledger contient **dix lignes `agent` en tout**, et leur heure est `01` pour les dix. Toutes
les autres lignes que l'agent a écrites depuis des semaines ont été absorbées par une synchro
Flex ultérieure, comme prévu. Les seules survivantes sont précisément celles que la borne au
jour civil ne peut pas atteindre : le mécanisme d'absorption fonctionne partout ailleurs, et
c'est bien cette unique frontière qu'il faut déplacer.

### 2.4 Deux pistes écartées par la mesure, pas par le raisonnement

**Un bundle obsolète qui n'aurait pas converti le fuseau.** Écartée : sur les deux comptes,
`lastAgentSyncAt` (vrai UTC) et le `asOf` du snapshot (heure de New York) sont à exactement
quatre heures l'un de l'autre, et le premier de ces deux snapshots a été écrit vingt secondes
*avant* le redémarrage de l'instance Vite ce jour-là. Le bundle qui tournait la nuit précédente
appliquait donc déjà `toReportTime`. `2026-09-19T01:02:45Z` est bien de l'heure de New York.

**Des lignes de 16:20 venues d'un relevé HTML plutôt que de Flex**, cas hors périmètre du
sous-projet 18. Écartée : leur `source` est `flex` et leur `externalId` de la forme
`flex:trade:…`.

**L'`execId` ne date pas le fill.** Tenté puis abandonné : le champ hexadécimal d'un `execId`
IB (`…cf43.6aace557.02.01`) s'interprète bien comme un epoch, mais il s'incrémente d'une seconde
par contrat du lot et tombe le matin de l'échéance, avant la clôture. C'est un compteur d'ordre,
pas l'heure de l'exécution. Ne pas refaire ce calcul.

---

## 3. Le jour de marché

`packages/ledger/src/filter.ts`, à côté de `dayOf`, qui ne change pas :

```ts
const MARKET_DAY_START_HOUR = 4;

export function marketDayOf(when: string): string {
  const at = new Date(`${dayOf(when)}T00:00:00.000Z`);
  if (Number(when.slice(11, 13)) < MARKET_DAY_START_HOUR) at.setUTCDate(at.getUTCDate() - 1);
  while (at.getUTCDay() === 0 || at.getUTCDay() === 6) at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}
```

Deux reculs, dans cet ordre :

- **avant 04:00**, l'ouverture du pré-marché, la ligne appartient au jour civil précédent : IB
  traite les assignations d'une échéance dans la nuit qui la suit, à l'heure où il y arrive ;
- **un jour qui tombe un samedi ou un dimanche** recule jusqu'au vendredi : la fenêtre de
  traitement d'une échéance du vendredi couvre le week-end entier, et rien ne s'exécute ces
  jours-là.

Aucun calcul de fuseau, aucune dépendance ajoutée : tout `when` du ledger est déjà l'heure
murale de New York stampée UTC (sous-projet 18), donc `getUTCDay` donne le jour de la semaine
new-yorkais. `MARKET_DAY_START_HOUR` est défini une seule fois, ici.

Table de vérité :

| `when` | `dayOf` | `marketDayOf` |
|---|---|---|
| `2026-09-19T01:02:45Z` (samedi) | 2026-09-19 | **2026-09-18** (vendredi) |
| `2026-09-19T10:00:00Z` (samedi) | 2026-09-19 | **2026-09-18** |
| `2026-09-20T18:00:00Z` (dimanche) | 2026-09-20 | **2026-09-18** |
| `2026-09-22T01:00:00Z` (mardi) | 2026-09-22 | **2026-09-21** (lundi) |
| `2026-09-22T03:59:59Z` | 2026-09-22 | **2026-09-21** |
| `2026-09-22T04:00:00Z` | 2026-09-22 | 2026-09-22 |
| `2026-09-22T10:00:00Z` | 2026-09-22 | 2026-09-22 |

---

## 4. Les deux points d'application

`packages/ledger/src/import.ts`, deux lignes.

**`planFlex`** — la ligne testée passe en jour de marché, la borne haute seule :

```ts
const day = dayOf(tx.when);
return day >= minDay && marketDayOf(tx.when) <= maxDay;
```

**`planAgent`** — même lecture, contre le dernier jour Flex :

```ts
const kept = flexDay === null ? [...incoming] : incoming.filter((tx) => marketDayOf(tx.when) > flexDay);
```

Sur la chronologie du §2.1 : la ligne agent du samedi 01:02 a pour jour de marché le vendredi
18. Si l'agent passe après Flex, `planAgent` l'ignore ; s'il est passé avant, la synchro Flex la
supprime. Dans les deux sens, une seule assignation.

Tant que Flex n'a pas rattrapé le vendredi, la ligne reste écrite et visible : `flexDay` vaut
alors le 17, et `2026-09-18 > 2026-09-17`. L'assignation du soir ne disparaît pas de
l'Historique en attendant la synchro du lendemain.

---

## 5. Ce qui ne change pas, et pourquoi

- **Les bornes restent des jours civils.** `minDay`, `maxDay` et `flexDay` continuent de sortir
  de `dayOf`. Flex et les relevés stampent à `00:00:00` toute ligne sans heure
  (`parseFlexDateTime`, `packages/ib-parsers/src/common.ts`) : une ligne de trésorerie la plus
  ancienne ou la plus récente de la plage reculerait la plage entière d'un jour.
- **Le plancher reste en jour civil**, pour la même raison en sens inverse : testée en jour de
  marché, une ligne de relevé stampée `00:00:00` le premier jour de la plage Flex tomberait la
  veille et passerait à travers la suppression. Un test le fixe (§6).
- **La borne haute reste déduite des données**, pas du `toDate` déclaré par la réponse (§8).
- **`planStatement` ne change pas** (§1, hors périmètre).
- **Aucune conversion d'heure ne change.** `toReportTime` et la convention du sous-projet 18
  sont correctes et vérifiées (§2.4) ; ce sous-projet ne touche pas aux parseurs.

---

## 6. Tests

TDD, chaque test rouge avant son implémentation.

- **`packages/ledger/src/filter.test.ts`** : la table de vérité du §3, ligne à ligne, plus un
  lundi 01:00 qui recule jusqu'au vendredi précédent.
- **`packages/ledger/src/import.test.ts`**, quatre cas neufs :
  - agent après Flex : assignation Flex `2026-09-18T16:20:00Z`, exécution agent
    `2026-09-19T01:02:45Z` → ignorée, comptée dans `skipped` ;
  - Flex après agent : la même ligne agent déjà en base → supprimée par Flex ;
  - une exécution agent du vrai jour suivant (`2026-09-21T09:35:00Z`, lundi) → écrite, et gardée
    par un Flex dont le dernier jour est le vendredi ;
  - **le garde-fou du plancher** : une ligne de relevé stampée `00:00:00` le premier jour de la
    plage Flex reste supprimée. C'est ce test qui échoue si quelqu'un passe un jour le plancher
    en jour de marché « par symétrie ».
- **Les tests existants de `import.test.ts` restent verts sans retouche** : c'est ce qui prouve
  que ni la borne basse ni `planStatement` n'ont bougé.
- **`apps/web/src/agent/sync.test.ts`** : la chronologie du §2.1 de bout en bout sur
  `fake-indexeddb`, dans les deux ordres de synchro — une seule assignation en base, une
  reconstitution sans écart.
- `pnpm check` **une seule fois à la fin** ; tests ciblés pendant l'itération.

---

## 7. Retour à la normale

Pas de migration Dexie. Les dix lignes en double sont supprimées par la première synchro Flex
qui suit le merge — automatique si la dernière a plus de douze heures
(`apps/web/src/flex/stale.ts`) et une session ouverte, sinon au bouton « Synchroniser » de la
page Sources, compte par compte. Les deux verdicts de la barre de titre repassent au vert.

Supprimer les lignes à la main en attendant ne sert à rien : tant que `planAgent` compare des
jours civils, la passe suivante de l'agent les réécrit.

Après le merge, `pnpm dev:stop && pnpm dev:start` à la racine.

---

## 8. Décisions écartées

| Écarté | Raison |
|---|---|
| Borner Flex sur le `toDate` déclaré plutôt que sur ses données | Paraît plus principiel — la réponse déclare couvrir jusqu'à la veille — mais c'est moins sûr : si Flex annonce le vendredi sans avoir encore posté l'assignation, la ligne de l'agent qui, elle, la porte serait supprimée, et la reconstitution deviendrait fausse jusqu'à la synchro suivante. La borne déduite des données ne supprime jamais ce que Flex n'a pas encore écrit |
| Seuil horaire seul, sans repli sur le vendredi | Ne couvre que la moitié de la fenêtre pendant laquelle IB traite une échéance. Un lot posté un samedi matin rejouerait le même bug, avec le même symptôme muet |
| Un calendrier de jours fériés | Un férié en semaine n'a jamais produit ce symptôme, et il faudrait une source de vérité que le dépôt n'a pas. La règle le laisse non couvert, sciemment |
| Passer aussi les bornes en jour de marché, par symétrie | Les lignes stampées `00:00:00` par Flex et les relevés décaleraient des plages entières, dans les deux sens (§5) |
| Faire dépendre la règle de la forme de la ligne (prix 0, sans commission) | Complexité inutile ici : l'utilisateur ne passe aucun ordre dans la session overnight d'IB, seule situation où le seuil horaire pourrait mordre à tort. Sans cette contrainte, une règle de temps pure suffit |
| Convertir dans l'agent Python | Déjà écarté au sous-projet 18, et sans objet : la conversion est correcte (§2.4) |

---

## 9. Documentation

- Spec fondateur §6.2 : la puce « L'agent n'écrit qu'après le dernier jour Flex » devient « après
  le dernier **jour de marché** Flex », avec la définition et le contre-exemple du samedi 01:02.
  Le paragraphe « Une seule horloge » gagne la phrase qui manquait : la même horloge ne suffit
  pas, il faut aussi que la nuit qui suit une séance lui appartienne.
- `CLAUDE.md` : la règle « Propriété de plage, jamais comparaison de contenu », celle qui commence
  par « Toute heure IB est l'heure murale de New York », et la ligne 24 du tableau des
  sous-projets.
- `docs/points-reportes.md` : la ligne « relevés + agent sans aucune ligne Flex », revue au
  sous-projet 24 et explicitement reportée.
