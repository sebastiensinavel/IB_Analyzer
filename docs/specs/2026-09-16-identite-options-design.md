# Sous-projet 10 — Identité des options sans Flex (relevés, agent)

Statut : implémenté (2026-09-16).

Une option qu'IB renomme en cours de vie est aujourd'hui deux contrats pour le moteur dès que
la réponse Flex manque. Ce sous-projet la ramène à un seul, quelle que soit la source, sans
rien changer au résultat que Flex donne déjà.

---

## 1. Périmètre

**Critère de réussite, choisi au brainstorming :** relevés seuls ou agent seul, les journaux
donnent exactement ce que donne Flex aujourd'hui. Sur le compte réel de `private/`, les 4 écarts
et l'orphelin que `alpha.private.test.ts` fige depuis le sous-projet 9 tombent à zéro, et les
trois oracles ne bougent pas d'un octet.

Dans le périmètre :

- résoudre une option nommée par son sous-jacent — ce que donnent le relevé HTML et l'agent —
  en reconstruisant sa forme OSI empaquetée à partir de ses propres termes ;
- faire suivre à une option la conversion 1 pour 1 de son sous-jacent, quand une classe prouve
  que l'option a bien été renommée (règle 9) ;
- faire publier à l'agent la forme OSI que TWS lui donne déjà dans `localSymbol`.

Hors périmètre, et laissé en dette au §8 : un ratio différent de 1 (split, fusion en titres),
une fusion avec cash, une racine que l'OCC suffixe côté cible (`KEEL1`) sans qu'aucun fichier
ne le dise, et l'appariement couverture/livraison entre une option et son sous-jacent, qui
compare toujours des tickers bruts.

---

## 2. Ce que disent les données

Mesuré le 2026-09-15 sur les relevés annuels et la réponse Flex de `private/`. Tout ce qui suit
est vérifié.

### 2.1 Deux options, quatre écarts

Relevés seuls, la réconciliation rapporte 4 écarts et 1 orphelin. Ce sont deux options, chacune
coupée en deux lots de signes opposés qu'aucun snapshot ne détient :

| Option | Ouverture | Clôture | Ce qu'en dit *Contract Information* |
|---|---|---|---|
| Call `2027-01-15` 2,5 | `ZXAG` +14, 2026-03-04 | `ZXAF` −14, 2026-05-21 | un seul conid, sous la seule orthographe `ZXAF  270115C00002500` |
| Call `2026-04-17` 12,5 | `ZXAK` +3, 2025-10-09 | `ZXAK1` −3, expiration du 2026-04-17 | un seul conid, sous **les deux** orthographes `ZXAK  260417C00012500` et `ZXAK1 260417C00012500` |

Le relevé 2026 porte par ailleurs la fusion 1 pour 1 `ZXAG.OLD → ZXAF` du 2026-04-03, deux
jambes de 975 titres, `Proceeds` à 0.

### 2.2 Pourquoi la règle 7 ne suffit pas

La table d'identité connaît déjà ces orthographes empaquetées : `parseContractInfo`
(`packages/ib-parsers/src/statement.ts:430`) les lit, et la règle 7 les retient. Mais
`canonicalize` (`packages/ledger/src/journals/replay.ts:81`) ne les consulte que pour une
transaction dont le `symbol` **est** empaqueté, ce que seul Flex écrit. Le relevé et l'agent
nomment l'option par son sous-jacent (`ZXAK`, `ZXAK1`, `ZXAF`), avec échéance, sens et strike
dans des colonnes à part. La clé n'est donc jamais cherchée.

### 2.3 Un renommage sur deux est écrit quelque part

C'est la dissymétrie qui commande tout le §4 :

- l'option ajustée par le spin-off a ses deux orthographes dans le même fichier, parce que le
  relevé 2025 a été écrit alors que les deux noms avaient servi dans sa période ;
- l'option dont le sous-jacent est converti n'a que le nom du jour : le relevé 2026, généré
  après la fusion, ne connaît plus que `ZXAF  270115C00002500`. Rien dans aucun fichier ne dit
  que ce contrat s'est appelé `ZXAG`. C'est la même mécanique que la règle 8 rattrape pour les
  actions, un cran plus loin : là, le triplet de l'opération témoignait encore ; ici, aucune
  ligne ne nomme l'option.

### 2.4 Les termes survivent au renommage

Sur les 497 conids d'option des deux réponses Flex réelles, deux portent plus d'une orthographe
— les deux ci-dessus — et **les deux gardent leurs termes** : seule la racine change. C'est ce
qui autorise la garde du §4.2 et la reconstruction du §4.1.

### 2.5 Ce que TWS donne déjà

`AgentContract.localSymbol` porte la forme OSI pour une option US : les fixtures de l'agent
montrent `AAPL  260116C00150000`. Mais `identityOf` (`packages/ib-parsers/src/agent.ts:160`)
publie `fields.symbol`, le sous-jacent, que la règle 7 écarte — à juste titre. L'agent
n'alimente donc aujourd'hui la table que pour les actions.

---

## 3. Les décisions structurantes

### 3.1 La forme OSI reste la seule qui nomme une option

La règle 7 ne bouge pas : un alias n'entre dans une classe que s'il nomme *ce* contrat, et pour
une option seule la forme OSI empaquetée le fait. Ce qui change est le chemin inverse : une
transaction qui porte le sous-jacent et les termes **désigne** une option, et ces termes
suffisent à reconstruire le nom sous lequel la table la connaît. Reconstruire un nom n'est pas
inventer un alias : la table reste alimentée par les seules sources.

### 3.2 Rien ne se résout sans preuve

Comme au §3.4 du spec du sous-projet 7, ce que les règles ne savent pas trancher reste tel
quel. La règle 9 ne renomme une option que si une classe porte déjà, sous le nouveau ticker,
une orthographe aux termes identiques : c'est le fichier qui prouve le renommage, l'événement
ne fait que dire de quel ancien nom il s'agit. Une greffe sur une orthographe qu'une autre
classe revendique déjà n'a jamais lieu — le refus est silencieux, sans `IdentityIssue` : cette
orthographe reste revendiquée par un seul `conid`, ce qui n'est pas une ambiguïté, plutôt que
de fusionner deux positions réelles.

### 3.3 Le ledger stocké n'est pas touché

La résolution reste une vue calculée au rejeu. `Transaction.symbol` garde ce que la source a
écrit, l'Historique aussi, et aucune migration Dexie n'est nécessaire. Le store `contracts`
gagne des alias d'options venus de l'agent, par le chemin de fusion qui existe déjà.

---

## 4. `packages/ledger`

### 4.1 `packedOptionSymbol` (`journals/contract.ts`)

```ts
/**
 * The packed OSI spelling of an option described by its underlying and its
 * own terms, or `null` when the description cannot produce one.
 */
export function packedOptionSymbol(
  ticker: string,
  expiry: string | null,
  right: "C" | "P" | "",
  strike: number | null,
): string | null;
```

Rend `null`, et alors rien n'est réécrit :

- racine vide, de plus de six caractères, ou portant autre chose qu'une lettre ou un chiffre
  (`BRK.B` n'a pas de forme OSI dans cette convention) ;
- `right` vide ;
- `expiry` absente ou hors de la forme `YYYY-MM-DD` ;
- `strike` absent, négatif ou nul, ou qui ne tient pas en millièmes sur huit chiffres.

Sinon : racine complétée à six caractères par des espaces à droite, `AAMMJJ`, `C` ou `P`, puis
le strike en millièmes sur huit chiffres — `packedOptionSymbol("ZXAK", "2026-04-17", "C", 12.5)`
vaut `"ZXAK  260417C00012500"`.

Deux fonctions d'accompagnement, privées au paquet : `optionTerms(symbol)`, tout ce qui suit la
racine, et `expiryOfPacked(symbol)`, l'échéance en `YYYY-MM-DD` lue dans une forme empaquetée.

### 4.2 `canonicalize` (`journals/replay.ts`)

La clé de résolution d'une transaction d'option devient :

- son `symbol` s'il est déjà empaqueté — le cas Flex, inchangé ;
- sinon `packedOptionSymbol(tickerOf(symbol), expiry, right, strike)`.

La réécriture n'a lieu qu'à trois conditions : la clé existe, la table rend un canonique
différent d'elle, et `optionTerms(canonique) === optionTerms(clé)`. La garde sur les termes vaut
pour les deux chemins ; le §2.4 dit qu'elle ne change rien aux données mesurées, elle empêche
seulement une classe mal formée de déplacer un contrat vers d'autres termes.

Ce qui est écrit dans la transaction résolue :

- ligne Flex : le canonique empaqueté, comme aujourd'hui ;
- ligne de relevé ou d'agent : `tickerOf(canonique)`, donc la seule racine. La ligne garde la
  forme de sa source, et `contractOf` en tire le même `contractId` que la ligne Flex jumelle.

Les actions et les lignes `corporate_action` ne changent pas.

### 4.3 Règle 9 : l'option suit la conversion 1:1 de son sous-jacent (`journals/identities.ts`)

C'est une précondition, comme les règles 7 et 8 : elle ajoute des alias avant que les six
premières ne s'appliquent. Mais, à la différence des deux autres, elle a besoin du résultat des
six premières pour savoir quels noms le sous-jacent a portés. `buildIdentities` travaille donc
en deux temps, et cet ordre est sûr : les classes d'options ne partagent aucune orthographe avec
les classes d'actions, la forme empaquetée n'étant jamais un ticker d'action.

```
1. contracts = namedContracts(graftActionAliases(inputs, events))   // règles 7 et 8
2. first     = resolve(contracts)                                    // règles 1 à 6
3. followed  = followUnderlyingRenames(contracts, events, first)     // règle 9
4. rendu     = followed === contracts ? first : resolve(followed)
```

`resolve` est le corps actuel de `buildIdentities`, extrait tel quel.

`followUnderlyingRenames` ne retient un événement que s'il est **une conversion pure de ratio
exactement 1** : `event.cash === null` et `event.to.quantity === −event.from.quantity`. Pour un
tel événement, au jour `day = event.when.slice(0, 10)` :

- **les noms d'arrivée** sont le ticker de la jambe entrante et son canonique à `event.when` ;
- **les noms de départ** sont `withoutOldSuffix(event.from.ticker)` et les alias non `.OLD` des
  classes qui revendiquent `event.from.ticker`. Le ticker écrit sur une transaction d'avant
  l'événement est l'un de ceux-là ;
- si un nom d'arrivée figure parmi les noms de départ, l'événement ne renomme rien : on passe.

Pour chaque classe d'option et chacun de ses alias empaquetés dont la racine est un nom
d'arrivée et dont `expiryOfPacked(alias) >= day` — une option déjà expirée ne peut pas avoir
été renommée —, la règle greffe, pour chaque nom de départ, l'orthographe
`packedOptionSymbol(nom de départ, termes de l'alias)`, stampée `firstSeen = lastSeen = day`.

Trois refus, qui sont ce qui rend la règle sûre :

- une racine de départ de plus de six caractères ne produit aucune forme : rien n'est greffé ;
- une orthographe qu'une classe revendique déjà n'est jamais greffée. Le fichier qui la connaît
  a raison contre l'inférence ;
- **une autre classe qui porte déjà les mêmes termes sous une racine suffixée par l'OCC**
  refuse la greffe (ajouté en revue de branche, avant le merge). Qu'une classe porte les termes
  de l'option sous la racine d'arrivée n'est pas la preuve qu'elle est la continuation de
  l'option renommée : l'acquéreur peut avoir sa propre option, sans rapport, aux mêmes termes.
  Le signe qui tranche est la forme suffixée que l'OCC donne à une option dont le deliverable
  cesse d'être standard — la racine d'arrivée suivie d'un ou plusieurs chiffres, `TSTC1` pour
  une arrivée `TSTC` — : si une autre classe porte déjà les mêmes termes sous une telle racine,
  c'est elle la continuation, et la greffe vers la classe sous la racine nue est refusée,
  silencieusement, comme les deux autres refus. Le cas où l'option renommée garde exactement la
  racine d'arrivée, sans aucun signe distinctif, reste indiscernable de l'option propre d'un
  acquéreur homonyme (`docs/points-reportes.md`, sous-projet 10).

L'alias greffé est aussi marqué, jamais seulement daté : `canonicalOf` (règle 2) le classe
après toutes les orthographes qu'une source a réellement écrites, comme il classe déjà un
`.OLD` — un nom qu'aucune source n'a écrit ne peut pas être élu canonique, et c'est cette
structure qui le garantit, non les dates. Ce marquage protège les deux greffes, celle de la
règle 8 comme celle de la règle 9. La faiblesse qu'il corrige valait aussi pour la règle 8, déjà
en place avant cette branche : une fenêtre de relevé close avant l'événement faisait gagner la
greffe au tri par `lastSeen` seul, et toute la classe basculait sur le nom mort. Vu en revue de
branche, corrigé avant le merge.

### 4.4 Ce que la règle 9 donne sur les données réelles

L'option `ZXAF  270115C00002500` reçoit l'alias `ZXAG  270115C00002500`, stampé du 2026-04-03.
`ZXAG` n'étant revendiqué par aucune autre classe d'option, la règle 3 le résout à toute date
vers le canonique de la classe, `ZXAF  270115C00002500`. Les deux trades de 2026 se rangent
alors sur le même contrat, et l'écart disparaît. L'option ajustée, elle, est refermée par la
seule reconstruction du §4.2 : ses deux orthographes sont déjà dans le même fichier.

---

## 5. `packages/ib-parsers`

### 5.1 L'agent publie la forme OSI de ses options (`agent.ts`)

`identityOf` pose, pour une option dont `isPackedOptionSymbol(localSymbol)` est vrai,
`tickers: [localSymbol]`. Pour toute autre option — une option qu'aucun marché ne nomme en OSI —
elle garde `fields.symbol`, que la règle 7 écarte comme aujourd'hui. Actions, paires de change
et le reste ne changent pas ; `describeAgentContract` non plus.

Conséquence, écrite ici pour qu'elle ne surprenne personne : l'agent seul ne reconnaît un
renommage qu'à partir du moment où il a vu les deux noms, donc sur deux passes encadrant
l'événement. Une passe qui ne voit que le nom du jour ne rattache pas les exécutions passées
sous l'ancien nom. C'est la limite de cette source, pas un défaut à corriger : l'agent n'écrit
qu'après le dernier jour Flex et ne remonte jamais le temps.

### 5.2 Les parseurs de fichiers ne changent pas

`parseContractInfo` lit déjà les orthographes empaquetées des options, `parseFlexXml` aussi.
Aucune nouvelle sortie, aucun nouveau diagnostic.

---

## 6. Ce qui ne change pas

- **`apps/web`** : `db/hooks.ts`, le store `contracts`, `db/sectors.ts` — qui ne lit que les
  identités `STK` et n'ajoutera donc jamais une forme OSI à la table sectorielle —, la page
  Sources et toutes les autres pages sont inchangées.
- **Le snapshot n'est pas canonicalisé**, conformément au §5.4 du spec du sous-projet 7 : il
  vient de la source la plus récente et porte le nom du jour, que la règle 2 élit aussi. Un
  snapshot resté sur un nom mort — un relevé ancien seul en base — resterait un écart affiché,
  comme aujourd'hui.
- **Le ledger, `Transaction.symbol`, l'Historique, les fichiers conservés** : intacts. Aucune
  version de schéma Dexie.

---

## 7. Tests

### 7.1 Deux relevés minuscules, entièrement synthétiques

Deux fixtures écrites à la main sur le modèle d'`activity_statement_sample.htm`, quelques
kilo-octets, sans une seule donnée réelle — donc aucune dette de publication :

**`tests/fixtures/statement_opt_2025.htm`**, le cas que *Contract Information* referme seule :

- `ContractInfo` : un conid d'option portant ses deux orthographes empaquetées, racines `TESTA`
  et `TESTA1` ;
- `Transactions` : l'achat de l'option sous la première racine, sa clôture à prix 0 sous la
  seconde ;
- `OpenPositions` : l'action seule, rien sur l'option.

**`tests/fixtures/statement_opt_2026.htm`**, le cas qui exige la règle 9 :

- `ContractInfo` : le conid de l'option sous la seule orthographe du nouveau ticker, et les
  deux classes d'action, l'ancienne suffixée `.OLD` ;
- `CorporateActions` : les deux jambes de la conversion, quantités opposées, `Proceeds` à 0,
  chacune avec son triplet `(TICKER, NOM, ISIN)` ;
- `Transactions` : l'option achetée sous l'ancien ticker avant l'événement, revendue sous le
  nouveau après ;
- `OpenPositions` : l'action convertie, rien sur l'option.

Un test neuf les rejoue jusqu'à la réconciliation et exige zéro écart, zéro orphelin, zéro
`IdentityIssue`. Trois variantes du second fichier, construites en changeant **une seule
cellule** — une quantité de jambe qui casse le ratio 1, un `Proceeds` non nul sur la jambe
sortante, une échéance d'option antérieure à l'événement — doivent chacune laisser le ticker
tel quel : c'est ce qui fait mordre les gardes du §4.3.

### 7.2 Unitaires

- `contract.test.ts` : `packedOptionSymbol` rend la forme attendue, et `null` sur chacun des
  cinq refus du §4.1.
- `identities.test.ts` : la greffe a lieu sur une conversion 1:1 ; elle n'a pas lieu sur une
  fusion avec cash, sur un ratio différent de 1, sur une option expirée avant l'événement, sur
  une racine de départ trop longue, ni sur une orthographe déjà revendiquée — ce dernier cas
  refusant la greffe silencieusement, sans `IdentityIssue` : l'orthographe reste revendiquée par
  un seul `conid`, aucune ambiguïté n'est créée (§4.3).
- `replay.test.ts` : une option nommée par son sous-jacent est réécrite quand la table la
  connaît ; elle ne l'est pas quand les termes du canonique diffèrent ; sans table, rien ne
  bouge.
- `agent.test.ts` : une option publie son `localSymbol` OSI ; un `localSymbol` non OSI garde le
  comportement d'aujourd'hui ; « les identités d'une passe d'agent ne changent aucune ligne de
  journal » reste vert.

### 7.3 Données réelles

- `apps/web/src/db/alpha.private.test.ts` : le test des relevés seuls passe de 4 écarts et
  1 orphelin à zéro, sans que ses assertions de cash changent. Son commentaire, qui annonce le
  sous-projet 10, disparaît avec elles. Le test relevés + Flex reste à zéro.
- `packages/ib-parsers/src/identity.private.test.ts` : inchangé, et il doit le rester.

### 7.4 Non-régression

`pnpm check`, plus les trois oracles : journaux Flex (`flex_journals_corpus.xml`), corpus HTML
2022-2024 (`corpus.oracle.test.ts`, `cash.oracle.test.ts`) et couverture. Aucun ne doit bouger
d'un octet. C'est un point de contrôle du plan, à chaque tâche qui touche le moteur, pas une
vérification finale.

---

## 8. Ce qui reste faux après ce sous-projet

À inscrire dans `docs/points-reportes.md` :

- **Un ratio différent de 1 ne fait pas suivre les options.** L'OCC ajuste alors le contrat —
  strike, multiplicateur ou quantité livrée —, et rien dans nos sources ne dit lequel. Aucune
  donnée réelle mesurée ne porte ce cas.
- **Une fusion avec cash ne fait pas suivre les options** : la règle 9 l'écarte délibérément,
  le nouveau contrat n'étant pas la simple continuation du précédent.
- **Une racine suffixée côté cible (`KEEL1`) reste hors de portée** tant qu'aucun fichier ne
  porte l'orthographe de départ : il n'y a alors ni classe à reconnaître, ni témoin.
- **L'agent a besoin de deux passes encadrant le renommage** (§5.1).
- **L'appariement couverture/livraison compare toujours des tickers bruts** (dette du
  sous-projet 7) : une option renommée sort du vivier de son sous-jacent. Relevés seuls, le
  comportement devient celui de Flex, ce qui est le but de ce sous-projet, mais le défaut de
  fond reste entier.

Deux entrées se ferment : « Un split du sous-jacent ne renomme toujours pas les options qui le
suivent » n'est plus vraie que pour un ratio différent de 1, et « Relevés seuls, une option
renommée en cours de vie ouvre un écart de portefeuille » disparaît.

---

## 9. Documents à amender

- **`CLAUDE.md`** : la règle « une option n'entre dans une classe que sous sa forme OSI
  empaquetée » gagne la reconstruction par les termes et la règle 9 ; la phrase sur les 4 écarts
  de `alpha` relevés seuls tombe ; le tableau des sous-projets passe le 10 à « fait ».
- **`docs/specs/2026-09-09-operations-sur-titres-design.md`** : le §5.2 accueille la règle 9 et
  précise la règle 7 (la table ne retient que la forme OSI ; la reconstruire depuis les termes
  est le chemin inverse, autorisé) ; le §7 perd la ligne que ce sous-projet referme.
- **`docs/specs/2026-09-10-fichier-seul-design.md`** : le §2.5 est refermé, renvoi à ce spec.
- **`docs/points-reportes.md`** : §8.

---

## 10. Ordre du plan

1. `packedOptionSymbol` et ses gardes (`contract.ts`), en TDD.
2. `canonicalize` cherche la forme reconstruite, avec la garde sur les termes (`replay.ts`).
   Oracles vérifiés : rien ne bouge.
3. Extraction de `resolve` et de `justBefore`, sans changement de comportement.
4. Règle 9 et ses refus (`identities.ts`).
5. Les deux fixtures synthétiques, leurs trois variantes et le test qui les rejoue.
6. L'agent publie `localSymbol` (`agent.ts`).
7. `alpha.private.test.ts` passe à zéro écart ; oracles et `pnpm check` complets.
8. Documents, revue de branche, merge.

---

## 11. Décisions prises pendant le brainstorming

- **Critère de réussite : relevés seuls = Flex.** L'appariement couverture/livraison par la
  table d'identité et le cas du split ont été proposés et écartés du périmètre.
- **Greffe d'alias plutôt que déplacement de lots au rejeu.** Déplacer les lots d'options à
  l'événement n'aurait eu besoin d'aucune table, mais se serait appliqué sans preuve, aurait
  créé un écart là où IB garde l'ancienne racine, et aurait donné deux mécanismes différents
  selon la source.
- **Un corpus minuscule et synthétique plutôt qu'une anonymisation de deux relevés réels.** Le
  corpus des opérations sur titres est né d'une anonymisation parce qu'il devait prouver vingt
  lignes enchevêtrées ; deux scénarios se décrivent à la main, et n'ajoutent aucune donnée
  réelle au dépôt. Le test privé de `alpha` reste la preuve que les vrais fichiers ont bien
  cette forme.
