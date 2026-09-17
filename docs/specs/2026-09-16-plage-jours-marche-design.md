# Sous-projet 18 — Propriété de plage en jours de marché

Statut : implémenté (2026-09-16).

Sur le compte réel `alpha`, la page Consistance signale cinq écarts de reconstitution après
les assignations du 2026-09-15 : IQZA 200 au lieu de 100, un put IQZA à +1, PQ 800 au lieu de
400, deux puts PQ à +2. Chaque assignation est dans le ledger **deux fois**, une fois par Flex,
une fois par l'agent TWS.

---

## 1. Périmètre

**Critère de réussite :** une assignation rapportée par Flex et par l'agent ne compte qu'une
fois, quel que soit l'ordre des synchros ; la migration aligne la base existante de
l'utilisateur sur la convention de fuseau, sans nouvel import, et le doublon déjà écrit
disparaît à la prochaine synchro Flex — automatique si la dernière a plus de douze heures
(`apps/web/src/flex/stale.ts`) et une session ouverte, sinon au bouton « Synchroniser » de la
page Sources.

Dans le périmètre :

1. l'heure de l'agent suit la convention des fichiers IB, l'heure de New York (§3) ;
2. Flex possède ses jours entiers, l'agent n'écrit qu'à partir du jour qui suit (§4) ;
3. une migration Dexie ramène à cette convention les lignes et le snapshot déjà écrits par
   l'agent (§5) ;
4. le badge « En direct » garde l'heure de la pendule de l'utilisateur (§6).

Hors périmètre : la conversion en vrai UTC des heures Flex et relevés (§8), le recouvrement
entre relevés HTML et agent sans aucune ligne Flex, l'agent Python (il envoie toujours du vrai
UTC, inchangé).

---

## 2. Ce que disent les données

### 2.1 Deux heures pour une même assignation

Filtre IQZA de l'Historique, vue globale :

| `when` affiché | Ligne | Commission | Source |
|---|---|---|---|
| 2026-09-15 16:20:00 | put racheté +1, 100 IQZA livrées à 60 | 0.00 | Flex |
| 2026-09-16 02:13:46 | put racheté +1, 100 IQZA livrées à 60 | — | agent |

Flex date toutes les assignations à 16:20:00 le jour de l'échéance : dans
`private/flex_<compte>_<date>.xml`, toutes les lignes `notes="A"` portent `;162000`. TWS
rend l'exécution à l'heure où IB l'a réellement traitée, le soir.

### 2.2 Deux fuseaux

- **Flex et relevés HTML** donnent une heure murale sans fuseau, stampée UTC sans conversion
  (`packages/ib-parsers/src/common.ts`, `toIso`). Sur les données de alpha, cette heure est
  celle de New York : les exécutions de la réponse Flex et du relevé 2026 tombent toutes entre
  09h et 16h (quelques lignes isolées hors séance mises à part).
- **L'agent** rend un vrai instant UTC (`apps/tws-agent/ib_tws_agent/main.py`,
  `to_utc_isoformat`), que `parseAgentSnapshot` garde tel quel.

02:13:46 UTC est donc 22:13:46 à New York, le 2026-09-15.

### 2.3 Pourquoi le doublon survit

`planAgent` écrit une ligne strictement postérieure à `max(when)` Flex ; `planFlex` supprime les
lignes des autres sources jusqu'à ce même instant, jamais au-delà. 2026-09-16T02:13:46 est
après 2026-09-15T16:20:00 : l'agent l'écrit, Flex ne la supprime pas. Aligner les fuseaux ne
suffit pas — 22:13 reste après 16:20 — et raisonner en jours sans aligner les fuseaux non plus :
la ligne de l'agent tombe le 16 en UTC.

`docs/points-reportes.md` (sous-projet 4) affirmait que `reqExecutions` ne rend pas les
assignations. C'est faux : l'agent les rend, sans commission.

---

## 3. Une seule convention d'heure

`packages/ib-parsers/src/common.ts` gagne :

- `IB_REPORT_TIME_ZONE = "America/New_York"`, une seule définition ;
- `toReportTime(instant: string): string` — un vrai instant ISO vers l'heure murale de New York
  à cet instant, stampée UTC comme `toIso` le fait pour les fichiers. Calculée par
  `Intl.DateTimeFormat` avec `timeZone: IB_REPORT_TIME_ZONE`, qui porte l'heure d'été ; aucune
  dépendance ajoutée. Millisecondes conservées. La conversion UTC → heure locale n'est jamais
  ambiguë, heure d'été comprise.

Exemples :

| Vrai instant | `toReportTime` |
|---|---|
| `2026-09-16T02:13:46.000Z` (EDT, UTC−4) | `2026-09-15T22:13:46.000Z` |
| `2026-01-15T15:30:00.000Z` (EST, UTC−5) | `2026-01-15T10:30:00.000Z` |
| `2026-03-08T07:30:00.000Z` (après le passage à l'heure d'été) | `2026-03-08T03:30:00.000Z` |

`parseAgentSnapshot` (`packages/ib-parsers/src/agent.ts`) l'applique au `time` de chaque
exécution et à `fetchedAt`. Les transactions, le snapshot et donc la reconstitution
(`boundaryOf` dans `journals/replay.ts`) comparent alors des heures d'une même horloge.

Le commentaire de `common.ts` (« both must be configured on the same one ») et ceux de
`apps/web/src/lib/format.ts` sont réécrits : toute heure du ledger et de tout snapshot est
l'heure de New York stampée UTC ; seule l'heure du badge « En direct » est lue en vrai UTC (§6).

`toReportTime` est exporté de `@ib/ib-parsers` : la migration du §5 l'utilise.

---

## 4. Propriété de plage en jours

`packages/ledger/src/import.ts`. Une réponse Flex couvre toujours jusqu'à la clôture de la
veille (spec fondateur §3.1) : son dernier jour est complet, et tout ce que l'agent rapporte ce
jour-là, quelle que soit l'heure, Flex le rapporte aussi.

- **`planFlex`** supprime les lignes des autres sources dont le jour est compris entre le jour
  de `min` et le jour de `max`, bornes incluses : `dayOf(tx.when) >= minDay && dayOf(tx.when)
  <= maxDay`. Le plancher `fromDate` ne change pas.
- **`planAgent`** n'écrit que les lignes dont le jour est strictement postérieur au dernier
  jour Flex : `dayOf(tx.when) > dayOf(flexMax)`. Il ne supprime toujours rien.

Sur la chronologie d'IQZA : Flex possède le 2026-09-15 entier ; l'exécution de l'agent à
22:13:46 heure de New York tombe ce jour-là. Si l'agent passe après Flex, il l'ignore ; s'il est
passé avant, la synchro Flex la supprime.

Les commentaires de `planFlex` (« The upper bound stays a precise instant… ») et de `planAgent`
sont réécrits en conséquence.

---

## 5. Migration Dexie 8

`apps/web/src/db/schema.ts`, `version(8)`, sans changement d'index, avec un `upgrade` qui :

- réécrit par `toReportTime` le `when` de chaque transaction `source === "agent"` ;
- réécrit par `toReportTime` le `asOf` d'un snapshot `source === "agent"`.

Rien d'autre : `lastAgentSyncAt`, `lastAgentSyncStatus.at`, `importedAt` et `updatedAt` sont des
instants de l'application, pas des heures IB, et restent en vrai UTC.

Sans migration, la ligne `2026-09-16T02:13:46Z` resterait : l'agent réécrirait la même
`externalId` avec la bonne heure mais l'ignorerait, son jour appartenant à Flex, et Flex ne
supprime pas le 16. Avec elle, la ligne devient `2026-09-15T22:13:46Z` et la prochaine synchro
Flex la supprime ; l'agent ne la réécrit plus.

La migration ne supprime rien : elle ne fait que ramener les lignes de l'agent sur le jour Flex.
Le doublon déjà écrit disparaît à la synchro Flex suivante, pas à l'ouverture de l'application :
automatique si la dernière synchro a plus de douze heures (`apps/web/src/flex/stale.ts`) et une
session ouverte, sinon au bouton « Synchroniser » de la page Sources.

---

## 6. Le badge « En direct »

`SnapshotStatus` affiche `formatClockTime(account.lastAgentSyncAt)`, l'instant réel du succès
écrit dans la même transaction que le snapshot, dans le fuseau du navigateur. Il ne lit plus
`snapshot.asOf`, désormais à l'heure de New York. Sans `lastAgentSyncAt`, l'heure s'affiche
« — ».

Tout le reste — Historique, date du snapshot sur la page Consistance, barre de titre — affiche
l'heure de New York, comme les lignes Flex aujourd'hui.

---

## 7. Tests

TDD, chaque test rouge avant son implémentation.

- **`common.test.ts`** : les trois exemples du §3, et les millisecondes conservées.
- **`agent.test.ts`** : `time` et `fetchedAt` convertis ; les attendus existants suivent.
- **`import.test.ts`** :
  - agent après Flex : assignation Flex à `2026-09-15T16:20:00Z`, exécution agent à
    `2026-09-15T22:13:46Z` → ignorée (`skipped`) ;
  - Flex après agent : la même exécution agent en base → supprimée par Flex ;
  - une exécution agent du `2026-09-16` → écrite, puis gardée par un Flex dont le dernier jour
    est le 15 ;
  - les tests existants de bornes à l'instant sont réécrits à la règle du jour.
- **`schema.test.ts`** : une base en version 7 avec une transaction agent, une transaction Flex
  et un snapshot agent en vrai UTC → en version 8, agent converti, Flex intact.
- **`sync.test.ts`** (agent, `fake-indexeddb`) : la chronologie IQZA de bout en bout, dans les
  deux ordres de synchro, ne laisse qu'une assignation et une reconstitution sans écart.
- **`SnapshotStatus`** : le badge lit `lastAgentSyncAt`.
- Les fixtures de l'agent (`sync.test.ts`, graine `--agent` de `run-frontend`, e2e) suivent la
  nouvelle convention là où un attendu en dépend.

---

## 8. Décisions écartées

| Écarté | Raison |
|---|---|
| Convertir dans l'agent Python | La convention du ledger fuirait hors du navigateur, et chaque utilisateur devrait réinstaller la roue |
| Tout passer en vrai UTC, Flex et relevés compris | Réécrirait toutes les heures en base, les oracles et les fixtures, et déplacerait l'affichage de l'Historique, sans gain métier |
| L'agent ignore les exécutions à prix 0 sans commission | Laisserait la reconstitution rouge entre l'assignation du soir et la synchro Flex du lendemain, et laisserait le décalage de fuseau fausser les autres comparaisons |
| Fuseau configurable par compte | Aucune donnée ne le demande : les fichiers des deux comptes sont à l'heure de New York, fuseau par défaut d'IB |

---

## 9. Documentation

- Spec fondateur §6.1 (`when`) et §6.2 : propriété en jours, heure de New York.
- `CLAUDE.md` : la règle « L'agent n'écrit qu'après `max(when)` Flex » et le tableau des
  sous-projets.
- `docs/points-reportes.md` : la ligne sur les assignations absentes de `reqExecutions` est
  corrigée.
