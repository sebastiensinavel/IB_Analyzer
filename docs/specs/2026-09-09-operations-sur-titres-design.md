# Sous-projet 7 — Opérations sur titres et identité de contrat

Statut : implémenté et mergé (2026-09-09).

Les opérations sur titres (*corporate actions*) ne sont pas rejouées par le moteur de
journaux. Un split, une fusion ou un simple changement de ticker laisse donc l'ancien
contrat ouvert pour toujours et fait naître un short fantôme sur le nouveau. Ce sous-projet
les rejoue, et pour cela donne au ledger la seule identité de contrat qui survive à un
changement de ticker : le `conid` d'Interactive Brokers.

Reprend le point reporté du sous-projet 5 : « Les `corporate_action` (split, fusion) ne sont
pas rejouées par `buildJournals` » (`docs/points-reportes.md`).

---

## 1. Périmètre

Dans le périmètre :

- rejeu des opérations sur titres dans `buildJournals` : split, changement de CUSIP/ISIN,
  fusion en titres, fusion mixte cash et titres ;
- lecture de la section **Contract Information** du relevé HTML et des attributs `conid` /
  `isin` déjà présents dans Flex et chez l'agent ;
- un store Dexie `contracts` par compte, qui porte l'identité des contrats et leurs alias de
  ticker ;
- résolution des alias au moment du rejeu, y compris le cas d'un ticker qui désigne deux
  contrats dans un même fichier ;
- un champ `realizedPnl` sur `Transaction`, écrit uniquement sur les lignes
  `corporate_action` ;
- restitution dans la page Sources de ce que la résolution n'a pas su trancher.

Hors périmètre, déclaré tel :

- **ajustement d'un contrat d'option par un split** (strike et multiplicateur modifiés) :
  aucun cas dans le corpus mesuré, la logique diffère, le moteur ne le voit pas davantage
  aujourd'hui ;
- **spin-off, dividende en titres, souscription de droits** : jamais observés ;
- **section `Transfers` de Flex** (transferts ACATS) : trou connu, déjà reporté par le spec
  fondateur §3.2, non rouvert ici.

Ce sous-projet ne touche ni au serveur, ni au déploiement, ni au moteur de couverture.

---

## 2. Ce que disent les données

Mesuré le 2026-09-09 sur `private/<compte>_{2022,2023,2024}_{…}.htm` et
`private/flex_<compte>_<date>.xml`. Tout ce qui suit est vérifié, rien n'est supposé.

### 2.1 Le symptôme

`isReplayable` (`packages/ledger/src/journals/replay.ts:15`) rejette tout ce qui n'est pas
`kind === "trade"`. Les vingt lignes `corporate_action` des trois relevés ne touchent jamais
le carnet de lots. Rejeu 2022 → 2024 comparé aux Open Positions du relevé 2024 :

| Vérité IB fin 2024 | Ce que le moteur croit | Cas |
|---|---|---|
| ZXAH soldé | ZXAJ **114** + ZXAH **−114** | B |
| ZXAI 680 | ZXAO **450** + ZXAI **−0,265** | C |
| ZXAAQ soldé | ZXAA **2 600** + ZXAAQ **−325** | A puis E |
| ZXAD soldé | ZXAD **540** | A |
| ZXAQ 120 | ZXAQ **1 200** | A |
| ZXAC 53 | ZXAC **1 599,67** | A + G |
| ZQA 144 | ZQA **480** | A |
| ZXAR 24 | ZXAR **600** | A |
| ZXAS 20 | ZXAS **200** | A |
| ZQB soldé | ZXAE **120** + ZQB **−64,08** | D |
| ZXAB, ZXAN soldés | ZXAB 220 + ZXABQ −220 ; ZXAN 350 + ZXANQ −350 | E |

Le P/L est faux du même coup : la vente de 314 ZXAH (P/L IB −1 498,10) ne porte que sur les
200 titres achetés au marché, les 114 issus de la conversion ouvrant un short.

### 2.2 Taxonomie

**A — Split, ticker inchangé.** ZXAA 1:8, ZXAD 1:10, ZXAQ 1:10, ZQA 1:5, ZXAC 1:30,
ZXAR 1:25, ZXAS 1:10. Deux lignes, `−ancien` / `+nouveau`, `Proceeds` à 0. L'ancien contrat
prend le suffixe `.OLD` dans Contract Information.

**B — Changement de CUSIP/ISIN avec nouveau ticker.** ZXAJ → ZXAH le 2022-09-21. Même forme,
ratio 1:1, mais le ticker change. Le compte a par ailleurs acheté 200 ZXAH au marché le
2022-10-18 : les 114 convertis doivent fondre dans le même contrat.

**C — Fusion en titres.** ZXAO → ZXAI, « 15117 FOR 10000 », le 2023-06-01 : `−450 ZXAO` et
`+680,265 ZXAI`, `Proceeds` à 0. **La base de coût est reportée telle quelle** :
226,14 + 389,35 + commissions = 618,00, et 680,265 × 0,9084695 = 618,00. La colonne `Value`
(−629,00 / +701,32) est une valeur de marché, jamais une base.

**D — Fusion mixte cash et titres.** ZXAE → ZQB, « 534 FOR 1000 AND USD 11.75236923 », le
2023-12-28. La jambe `−120 ZXAE` porte `Proceeds 1 290,40` et `Realized P/L 180,40` : c'est
une vraie clôture partielle.

```
base ZXAE      1 501,00   (120 × 12,500 + 1,00 de commission)
cash encaissé  1 290,40   → P/L réalisé 180,40 → base consommée 1 110,00
base ZQB         391,00   = 1 501,00 − 1 110,00   (64,08 × 6,1017)
```

La répartition vient du cours de ZQB au jour de la fusion (6,1017), qu'aucune de nos sources
ne donne. Le P/L réalisé imprimé sur la ligne est donc la seule entrée exploitable : §5.3.

**E — Renommage de ticker sans aucune ligne.** ZXAB → ZXABQ, ZXAN → ZXANQ, ZXAA → ZXAAQ.
Même `conid`, même ISIN : IB ne considère pas cela comme un événement. Le relevé annuel
imprime le ticker courant **au moment de sa génération**, si bien qu'un même contrat porte
deux noms dans deux fichiers. Vérifié : la chaîne `Ticker` n'apparaît pas une seule fois
dans les trois relevés. Aucune section ne le dit ; seul le `conid` le révèle.

**F — Ticker ambigu à l'intérieur d'un même fichier.** Dans le relevé 2023, `ZXAA` désigne
deux `conid` : 900000103 avant le split, 900000107 après. Idem `ZXAC` (900000102 puis
900000108). L'achat de 2 200 ZXAA en février et la position ouverte de 325 en décembre
portent le même texte. Seule la date, rapportée à celle de l'opération, les sépare.

**G — Miettes fractionnaires.** Le split ZXAC laisse 0,3333 titre, vendu comme un trade
ordinaire **au même instant 20:25:00 que l'opération** ; l'ordre « opération avant trade à
`when` égal » n'est donc pas une préférence, c'est une condition de correction. ZXAI laisse
0,265 (code `FP`), ZQB 64,08 (code `FPA`), vendus plus tard.

### 2.3 La section Contract Information

Chaque relevé porte une section `Contract Information` dont les colonnes sont
`Symbol | Description | Conid | Security ID | Listing Exch | Multiplier | Type | Code`
(le relevé 2024 insère `Underlying` après `Security ID` : les colonnes se lisent par leur
en-tête, jamais par leur rang). `Symbol` est **une liste d'alias séparés par des virgules**.

```
2022: ZXAB, ZXABQ     | 900000106 | US74764U2033
2022: ZXAJ.OLD, ZXAJ  | 900000101 | US92280L1017
2022: ZXAH            | 900000105 | US74113T1051
2023: ZXABQ           | 900000106 | US74764U2033
2023: ZXAA            | 900000107 | US81947T2015   (postérieur au split)
2023: ZXAA.OLD, ZXAA  | 900000103 | US81947T1025   (antérieur)
2024: ZXAAQ           | 900000107 | US81947T2015
```

Couverture vérifiée : tous les tickers actions des sections Transactions et Open Positions
des trois relevés y figurent (`EUR.USD` excepté, qui n'est pas un titre). C'est ce qui
résout les cas E et F, et rien d'autre ne le peut.

**Piège d'implémentation.** L'identifiant du bloc est `tblContractInfo<compte>Body`, **sans
le tiret bas** que `readSection` (`packages/ib-parsers/src/statement.ts:131`) insère
systématiquement entre le nom de section et le compte. IB est inconsistant sur ce point
(`tblFIFOPerfSumByUnderlying<compte>Body` suit la même exception). `readSection` doit
accepter les deux formes.

### 2.4 Ce que chaque source fournit déjà

| Source | `conid` | Constaté |
|---|---|---|
| Agent local | **oui, partout** : positions et exécutions | `AgentContract.conId`, `agent.ts:7,108`, déjà posé sur `Position.conid` en `agent.ts:214` |
| Flex — `OpenPosition` | **oui** : `conid`, `securityID`, `isin` | fichier réel ; déjà lu en `flex.ts:291` |
| Flex — `CashTransaction` | **oui** : `conid`, `isin` (vides sur une ligne sans titre) | fichier réel |
| Flex — `Trade` | **non** | 24 attributs, ni `conid` ni `isin` |
| Flex — `CorporateAction` | inconnu | la section est vide dans le fichier réel |
| Relevé HTML | indirectement, par Contract Information | §2.3 |

Les colonnes `conid` / ISIN se cochent **par section** dans le générateur de requête Flex.
Elles le sont déjà pour Open Positions et Cash Transactions dans la requête de l'utilisateur,
pas pour Trades : c'est une case à cocher dans une requête existante, pas une nouvelle
requête. Deux limites subsistent, et elles commandent toute l'architecture du §5 :

- une requête laissée telle quelle continue de fonctionner, sans `conid` sur les trades ;
- même cochée, Flex ne remonte que 365 jours : les trades déjà en base n'en auront jamais.

---

## 3. Les décisions structurantes

### 3.1 Le `conid` est un indice d'équivalence, jamais une clé de contrat

C'est la décision centrale, et la seule qui protège les sources existantes.

Clé sur le `conid` quand il existe et sur le ticker sinon, et le même contrat ZXAH arrivant
une fois du relevé HTML (avec `conid`) et une fois de Flex (sans) produit deux clés et scinde
les lots — une régression pire que le défaut corrigé. `journals.private.test.ts`, qui exige
zéro différence sur le Flex réel de beta, tomberait, et l'oracle
`flex_journals_corpus.xml` avec lui.

`contractId` reste donc inchangé, sur le ticker. Une passe de résolution d'alias s'intercale
avant le rejeu et **remplace le ticker par son canonique**. Propriété exigée, et vérifiée
par les tests du §8 : *une source qui ne fournit aucun indice n'alimente pas la table et se
comporte exactement comme aujourd'hui, à l'octet près.*

### 3.2 L'identité des contrats est stockée, les événements restent inférés

Contract Information n'est pas dans le ledger et n'a pas vocation à y entrer : ce n'est pas
un événement économique, c'est un attribut du contrat. Elle vit dans un store Dexie
`contracts` par compte (§6.1), alimenté par chaque import et chaque passe de l'agent.

Les opérations sur titres, elles, restent **inférées à chaque rejeu** depuis les lignes
`corporate_action` déjà présentes dans le ledger, conformément au §2.2 du spec du
sous-projet 5. Aucune table d'événements, aucune migration pour elles.

### 3.3 La base de coût est reportée, jamais recalculée

Vérifié sur B, C et D : IB reporte la base de l'ancien contrat sur le nouveau, sans jamais la
marquer au marché. La colonne `Value` d'une ligne de CA est une valeur de marché et ne doit
pas servir de base. Seul le cas D retire une part de la base, celle qu'il paie en cash.

### 3.4 Ce que la résolution ne sait pas trancher n'est jamais deviné

Un ticker que les règles du §5.2 ne savent pas rattacher reste lui-même — le comportement
d'aujourd'hui — et produit un diagnostic listé dans la page Sources. Un rejeu approximatif
silencieux serait pire que le trou actuel, qui au moins se voit dans la carte de cohérence.

---

## 4. `packages/ib-parsers`

### 4.1 Contract Information (relevé HTML)

Nouvelle sortie du parseur, à côté de `transactions` et `snapshot` :

```ts
/** One IB contract as a statement's Contract Information section describes it. */
export interface ContractIdentity {
  /** IB's stable contract id, the only thing a ticker change never touches. */
  conid: string;
  isin: string;
  /** "STK", "OPT"… from the section's `header-asset` rupture. */
  secType: string;
  currency: string;
  description: string;
  /** Every spelling of this contract in this file: the `Symbol` cell, split on commas. */
  tickers: string[];
}
```

`parseActivityStatement` rend `identities: ContractIdentity[]`. Les lignes d'options y
figurent aussi ; elles sont conservées telles quelles, sans usage aujourd'hui.

`readSection` accepte l'identifiant sans tiret bas (§2.3).

### 4.2 Le ticker de chaque jambe d'une opération sur titres

`symbolFromDescription` (`common.ts:90`) ne lit que le préfixe de la description. Les deux
jambes d'une opération reçoivent donc **le même symbole**, si bien que même rejouées elles
donneraient ZXAJ 114 − 114 = 0 et zéro ZXAH. C'est un défaut, pas un choix : le `symbol`
d'une ligne doit désigner le titre que cette ligne concerne.

La description se termine par le triplet `(TICKER, NOM, ISIN)` de la jambe :

```
ZXAJ(US92280L1017) CUSIP/ISIN Change to (US74113T1051) (ZXAH, EXAMPLE AUTOMATION INC, US74113T1051)
ZXAD.OLD(US41358P1066) Split 1 for 10 (ZXAD, EXAMPLE BIO INC, US41358P2056)
```

`parseCorporateActions` lit ce triplet et pose `symbol` = son ticker, `description` inchangée.
Un triplet absent ou méconnaissable retombe sur `symbolFromDescription` et émet un
avertissement `row-skipped` : la ligne reste dans le ledger, elle ne sera simplement pas
appariée.

### 4.3 `realizedPnl`

`Transaction` gagne un champ, nullable comme tous les champs monétaires, et **optionnel**
comme `ImportRecord.positions` l'est depuis la version 2 du schéma :

```ts
  /**
   * Realized P/L as the source reports it; only corporate actions write it today.
   * Absent on rows imported before version 4 of the schema — `undefined`, not `null`,
   * since Dexie stores plain objects and no upgrade rewrites them.
   */
  realizedPnl?: number | null;
```

Optionnel et non pas requis : une ligne déjà stockée n'a pas la clé du tout, et la déclarer
requise ferait mentir le type sur toutes les lignes antérieures. Le rejeu traite `undefined`
et `null` de la même façon (§5.3).

Écrit par `parseCorporateActions` depuis la colonne `Realized P/L`, et par le parseur Flex
depuis `fifoPnlRealized` sur un `CorporateAction`. `null` partout ailleurs, y compris sur les
trades : le moteur calcule le P/L des trades lui-même et ne doit pas se mettre à en importer
deux versions concurrentes.

### 4.4 `conid` et `isin` là où ils existent

Le parseur Flex lit `conid` et `isin` sur `Trade`, `CashTransaction` et `CorporateAction`
quand les attributs sont présents, et en dérive des `ContractIdentity`. Absents, aucun
diagnostic d'erreur : un **avertissement** au plus, listé dans la page Sources, jamais un
blocage. Le parseur de l'agent en dérive de même depuis `conId` et `symbol`.

Le `conid` ne rejoint **pas** `Transaction` : il n'y sert à rien puisque §3.1 interdit d'en
faire une clé, et il alimente le store `contracts` par un chemin qui n'a pas besoin de
traverser le ledger.

### 4.5 Flex, et ce qu'on ne peut pas vérifier

La section `CorporateActions` du Flex réel est vide. Le traitement Flex des opérations sur
titres est donc écrit d'après le schéma (`type`, `actionDescription`, `quantity`, `proceeds`,
`fifoPnlRealized`, `conid`, `isin`), couvert par des fixtures construites à la main, et
**déclaré non vérifié contre une donnée réelle** dans `docs/points-reportes.md`. Le corpus
HTML reste l'oracle du sous-projet ; le jour où un Flex portera une opération sur titres, il
faudra le rejouer avant de faire confiance à cette branche.

---

## 5. `packages/ledger` : identité et rejeu

### 5.1 `ContractIdentities`

Une valeur, construite depuis les enregistrements du store et les opérations sur titres du
ledger, exposée au rejeu :

```ts
export interface ContractIdentities {
  /** The ticker to use for `contractOf` on a transaction of this ticker at this instant. */
  canonical(ticker: string, when: string): string;
  /** What the rules could not settle, for the Sources page. */
  issues: IdentityIssue[];
}

/** A ticker the rules of §5.2 left as it was, and why. */
export interface IdentityIssue {
  ticker: string;
  code: "ambiguous-unresolved" | "action-unpaired" | "merger-basis-unknown";
  detail: string;
}
```

`IdentityIssue` vit dans `packages/ledger` et non dans `issues.ts` de `ib-parsers` : il ne
naît pas d'un fichier mal formé mais d'une résolution incomplète, et il se recalcule à chaque
rejeu comme le reste.

`buildJournals(transactions, snapshot?, identities?)` prend un troisième argument optionnel.
Absent, le rejeu est celui d'aujourd'hui, sans branche conditionnelle ailleurs : `canonical`
est l'identité quand la table est vide.

### 5.2 Les règles de résolution, dans l'ordre

La règle 7 est une précondition : elle décide quels alias entrent dans le jeu, les six
autres s'appliquent ensuite à ce qui reste.

1. **Classes d'équivalence.** Un `conid` est une classe. Ses alias sont l'union des tickers
   observés pour lui, quelle que soit la source ou le fichier.
2. **Canonique d'une classe.** Le ticker sans suffixe `.OLD` ; s'il y en a plusieurs, celui
   vu dans la période d'import la plus récente ; un `.OLD` n'est retenu que s'il est le seul
   alias. Un seul import stampe tous ses alias de la même fenêtre, si bien que l'égalité sur
   `lastSeen` est le cas courant, pas l'exception : elle se tranche par le rang de l'alias,
   le dernier vu étant le nom actuel. Ce rang n'a de sens que si les deux constructeurs de
   la liste rangent les orthographes du plus ancien au plus récent — d'où le tri par date de
   `parseIdentities` (`flex.ts`), Flex ordonnant ses lignes par symbole et non par date.
3. **Ticker sans ambiguïté.** Un ticker qui n'appartient qu'à une classe résout vers le
   canonique de cette classe, à toute date.
4. **Ticker ambigu** (cas F). Un ticker qui appartient à plusieurs classes est tranché par la
   date : les opérations sur titres qui relient ces classes fournissent les bornes, et une
   transaction résout vers la classe active à son instant. Une opération s'applique à partir
   de son `when`, bornes incluses.
5. **Aucun indice.** Le ticker reste lui-même.
6. **Conflit irréductible** — deux classes qu'aucune opération ne relie et qui partagent un
   ticker sur des périodes qui se chevauchent : règle 5, plus un `IdentityIssue`.
7. **Alias qui nomme la classe** (ajout du 2026-09-09). Les six règles ci-dessus s'appliquent
   aux actions et aux options, mais un alias n'entre dans une classe que s'il nomme *ce*
   contrat. Pour une action, tous ses alias le font. Pour une option, seule la forme OSI
   empaquetée (`ZXAG  270115C00002500`) le fait, et seul Flex l'écrit : TWS nomme une option
   par son sous-jacent, si bien que l'agent range toutes les options d'une action sous le
   ticker de cette action. Les lire comme des orthographes ferait revendiquer « AAPL » par
   vingt `conid` et enterrerait l'action qui le porte sous une ambiguïté. Une option qu'aucun
   nom empaqueté ne désigne n'identifie rien et sort de la table. La table elle-même ne
   retient donc que cette forme ; la reconstruire depuis les termes d'une transaction —
   sous-jacent, échéance, sens, strike — est le chemin inverse, et il est autorisé (sous-projet
   10, §4.2) : ce n'est pas ajouter un alias qu'aucune source n'a écrit, seulement retrouver, à
   l'interrogation, le nom sous lequel la table connaît déjà le contrat.
8. **Alias donné par une opération sur titres** (ajout du 2026-09-09). Comme la règle 7,
   c'est une précondition : elle ajoute des alias avant que les six premières s'appliquent.
   Le triplet final `(TICKER, NOM, ISIN)` d'une jambe nomme un contrat par son ISIN ; ce
   ticker devient un alias de la classe que cet ISIN désigne, stampé du **jour de
   l'événement** et de lui seul. Une jambe sans triplet, ou dont l'ISIN n'est déclaré par
   aucune classe, n'ajoute rien.
9. **Alias d'option donné par la conversion 1 pour 1 du sous-jacent** (sous-projet 10). Comme
   les règles 7 et 8, c'est une précondition. La conversion 1 pour 1 d'une action — sans
   espèces — greffe l'ancienne orthographe de son sous-jacent sur la classe d'option qui porte
   déjà le nouveau ticker sous les mêmes termes, sur preuve qu'une telle classe existe : c'est
   le fichier qui prouve le renommage, l'événement ne fait que dire de quel ancien nom il
   s'agit. Détail complet : spec du sous-projet 10, §4.3.

La règle 8 est ce qui rattrape la réutilisation d'un ticker par le contrat neuf d'un
changement de CUSIP. Le 2025-03-05, IB donne au contrat neuf de ZXAL le ticker que portait
l'ancien, renomme l'ancien `ZXAL.OLD`, puis rebaptise le neuf `ZXAM` des mois plus tard.
Quand le relevé 2025 est écrit, sa *Contract Information* ne connaît plus que les orthographes
du jour — `ZXAL.OLD` pour 900000104, `ZXAM` pour 900000110 : plus rien n'y dit que le contrat
survivant s'est appelé `ZXAL`. Le triplet de l'opération est le dernier témoin, et seul son
ISIN dit *quel* contrat cette orthographe désignait. Sans la greffe, « ZXAL » n'appartient
qu'à une classe — la morte —, aucune ambiguïté n'est détectée, la règle 3 répond avec le
canonique mort, et les titres que l'opération fait entrer se rangent sur un contrat que
personne ne détient. Avec elle, le ticker devient ambigu et la règle 4 le date par cette
opération même. L'alias greffé est aussi marqué, jamais seulement daté : `canonicalOf`
(règle 2) le classe après toute orthographe qu'une source a réellement écrite, sans quoi la
fenêtre d'un relevé close avant l'événement le ferait gagner par la seule date et ferait
basculer toute la classe sur le nom mort.

La règle 7 est ce qui rattrape un renommage qu'IB n'accompagne d'aucune opération sur titres :
quand ZXAG devient ZXAF le 2026-04-03, l'action change de `conid` et se convertit par
l'événement, mais l'option ne change que d'orthographe — `conid` 900000109 porte
`ZXAG  270115C00002500` puis `ZXAF  270115C00002500`. Il n'y a rien à rejouer, seulement une
classe à reconnaître. La même règle réunit une option ajustée à celle qu'elle prolonge
(`ZXAK  260417C00012500` puis `ZXAK1 260417C00012500`, spinoff du 2025-10-22) ; que le
sous-jacent livré ait changé reste, lui, un point reporté.

La règle 2 fait que le lot ouvert sur `ZXAA` avant le split porte le canonique de l'ancienne
classe, que l'opération convertit ensuite vers le canonique de la nouvelle — `ZXAAQ` fin
2024. Un reliquat non converti resterait visible sous son propre nom, jamais fondu par
erreur dans le nouveau.

### 5.3 Le rejeu d'une opération sur titres

**Appariement.** Deux lignes `corporate_action` forment un événement lorsqu'elles partagent
`when` et la description privée de son triplet final, et que leurs quantités sont de signes
opposés. Une ligne non appariée est laissée de côté avec un diagnostic ; elle ne modifie
jamais le carnet.

```ts
interface CorporateActionEvent {
  when: string;
  from: { ticker: string; isin: string; quantity: number };   // quantity < 0
  to: { ticker: string; isin: string; quantity: number };     // quantity > 0
  /** Cash leg of a mixed merger, on the `from` row; null for a pure conversion. */
  cash: { amount: number; realizedPnl: number | null } | null;
}
```

`cash` est non nul exactement quand le `amount` de la ligne `from` n'est pas nul : une
conversion pure porte 0 sur ses deux jambes (vérifié sur A, B et C), une fusion mixte porte
le cash encaissé sur la jambe sortante et 0 sur l'entrante.

**Ordre.** Les événements s'appliquent **avant** les trades du même `when` (cas G, ZXAC).
`sortTransactions` conserve ses règles ; le rejeu insère l'événement en tête de son groupe.

**Effet, conversion pure (A, B, C).** Soit `ratio = to.quantity / |from.quantity|`. Chaque lot
ouvert du contrat `from` au moment de l'événement devient un lot du contrat `to` :

| Champ du lot | Devient |
|---|---|
| `contract` | le contrat `to` |
| `quantity`, `remaining` | × `ratio` |
| `openAmount`, `openCommission` | **inchangés** — la base est reportée (§3.3) |
| `openPrice` | ÷ `ratio` ; `null` s'il l'était |
| `openWhen`, `openIds`, `assigned`, `orphan`, `cover` | inchangés — l'ancienneté du lot survit |

`openPrice` se divise par le ratio plutôt que de se recalculer depuis `openAmount`, pour
rester ce qu'il est partout ailleurs dans le moteur : un prix de transaction, commissions
exclues. Contrôle sur ZXAD — 600 titres à 662,07 hors commissions, soit 1,10345 le titre,
donnent 11,0345 après le 1:10, quand IB affiche 11,0845 parce que sa base inclut les
2,60 de commissions. Les deux disent la même chose, chacun dans sa convention.

Les lots convertis rejoignent ceux qui existent déjà sur `to` (cas B : les 114 issus de ZXAJ
et les 200 achetés au marché coexistent, FIFO sur `openWhen`). Aucune ligne de journal n'est
émise : une conversion n'est pas une sortie.

**Résidu du ratio** (ajout du 2026-09-09). Le ratio n'est presque jamais représentable en
binaire — 53,3333/1600 ne l'est pas — si bien que la seule mise à l'échelle laisse quelques
1e-14 sur la position : 53,33330000000001 au lieu de 53,3333 pour ZXAC, que la vente de la
fraction du même instant transforme en 53,00000000000001, et que la réconciliation rapporte
comme un écart contre un snapshot à 53. Quand le carnet détenait **exactement** ce que
l'événement fait sortir (`position(from) === -from.quantity`), il doit détenir exactement ce
qu'il fait entrer : le résidu `to.quantity − Σ remaining` se pose sur le **plus gros** lot
déplacé, le seul qu'il ne peut pas perturber. Sur le dernier il le pourrait : une clôture
partielle dont les deux côtés sont presque égaux laisse un lot ouvert sur quelques 1e-15, et
un résidu négatif l'y retournerait vendeur — position juste, mais lot court fantôme au
carnet et ligne en cours fantôme aux journaux.
Quand il en détenait moins — historique tronqué avant l'événement — rien n'est corrigé : la
mise à l'échelle est alors la seule réponse honnête, et lui donner le total de l'événement
inventerait des titres.

**Effet, fusion mixte (D).** Aucune quantité n'est « fermée » au sens ordinaire : les 120
titres ZXAE sont échangés en bloc contre du cash *et* des titres. Ce qui se partage est la
base, pas la position. En trois temps :

1. **Fraction de base payée en cash.** `f = (cash.amount − cash.realizedPnl) / base totale
   des lots ouverts`. Sur ZXAE : `(1 290,40 − 180,40) / 1 501,00 = 1 110,00 / 1 501,00`.
2. **Clôture.** Chaque lot est fermé pour la totalité de sa quantité, contre `cash.amount`
   réparti au prorata de sa base, et une base consommée de `f` × sa base. Événement de sortie
   `corporate_action`, vraies lignes de journal, P/L total 180,40.
3. **Conversion.** Un lot neuf est ouvert sur `to`, quantité `to.quantity`, base
   `(1 − f)` × base totale, soit 391,00 sur 64,08 titres ZQB. `openWhen` et `openIds` sont
   ceux du plus ancien lot converti : l'ancienneté survit à la fusion comme elle survit à un
   split.

`cash.realizedPnl` absent — `undefined` sur un import antérieur au champ, `null` sur un Flex
qui ne le donne pas — **ne convertit rien** : l'événement est laissé de côté avec un
diagnostic explicite, exactement comme aujourd'hui, plutôt que d'inventer un P/L.

**Nouvel événement de sortie.** `CloseEvent` gagne `"corporate_action"`, affiché « Opération
sur titres » ; les libellés vivent dans `i18n/{en,fr}.json` comme les autres.

### 5.4 Réconciliation

`reconcile` compare des `contractId`, donc des tickers. Le snapshot vient de la source la
plus récente et porte le ticker courant ; le canonique d'une classe est lui aussi le plus
récent (règle 2). Les deux coïncident par construction. Un désaccord subsistant reste ce
qu'il est aujourd'hui : une différence affichée dans la carte de cohérence.

---

## 6. `apps/web`

### 6.1 Le store `contracts`

```ts
/** One IB contract of one account, and every ticker it has been seen under. */
export interface ContractRecord {
  accountId: string;
  conid: string;
  isin: string;
  secType: string;
  currency: string;
  description: string;
  /** Ticker -> the import periods that saw it, to rank canonicals and date ambiguities. */
  aliases: { ticker: string; firstSeen: string; lastSeen: string }[];
  updatedAt: string;
}
```

Version 4 du schéma Dexie : `contracts: "[accountId+conid], accountId"`. Les versions 1 à 3
sont inchangées ; la migration est additive, aucune ligne existante n'est réécrite. Le champ
`realizedPnl` de `Transaction` (§4.3) est nullable et absent des lignes déjà stockées : il
reste `null` jusqu'au ré-import du fichier concerné, ce que la page Sources explique.

Écrit dans la même transaction IndexedDB que l'import (`importFile.ts`), et par la passe de
l'agent (`agent/sync.ts`). La fusion est une union : un alias déjà connu voit son `lastSeen`
avancer, jamais reculer ; un `conid` inconnu crée une ligne.

### 6.2 Hook

`useJournals` lit le store `contracts` en plus du ledger et du snapshot, construit les
`ContractIdentities` et les passe à `buildJournals`. Le recalcul reste intégral à chaque
changement, sans mémoire ni table dérivée, conformément à la règle des journaux.

### 6.3 Page Sources

Une carte « Identité des contrats » par compte :

- le nombre de contrats connus et d'alias résolus ;
- les `IdentityIssue` en clair, un par ligne ;
- l'invitation à cocher `Conid` et `Security ID` sur la section Trades de la requête Flex,
  avec la mention que cela n'agit que sur les tirages à venir ;
- l'invitation à ré-importer les relevés HTML, seule source de Contract Information.

Aucune de ces situations n'est une erreur : elles se lisent, elles ne bloquent rien.

---

## 7. Ce qui reste faux après ce sous-projet

Déclaré ici pour que personne n'ait à le redécouvrir :

- une opération sur titres antérieure au plus ancien relevé importé reste invisible ;
- un compte qui n'importe que du Flex ne bénéficie ni de Contract Information ni, pour ses
  trades antérieurs à la case cochée, du `conid` : les cas E et F y restent ouverts ;
- l'ajustement d'une option par un split n'est pas traité (§1) ;
- la branche Flex du rejeu n'est vérifiée par aucune donnée réelle (§4.5).

---

## 8. Non-régression : les trois oracles

Ce sont eux qui prouvent la propriété du §3.1, et ils existent déjà. Aucun ne doit bouger :

| Oracle | Ce qu'il garantit |
|---|---|
| `packages/ib-parsers/src/journals.private.test.ts` | Flex réel de beta : zéro différence, zéro orphelin. Ce Flex n'a pas de `conid` sur ses trades et pas d'opération sur titres : la table d'identités y est vide, la sortie doit être identique |
| `flex_journals_corpus.xml` rejoué contre son snapshot | même garantie sur le corpus versionné |
| Fixtures de l'agent (`agent.test.ts`) | le `conid` de l'agent enrichit la table sans changer une seule ligne de journal |

À quoi s'ajoute un oracle neuf, qui est la raison d'être du sous-projet : un corpus HTML
anonymisé portant les sept formes du §2.2, rejoué jusqu'aux Open Positions du dernier
relevé, **quantité par quantité**. Les chiffres attendus sont ceux du tableau du §2.1, colonne
de gauche.

L'anonymisation devra préserver `conid` et ISIN sous forme cohérente — deux fichiers doivent
continuer de partager le même `conid` pour un même contrat, sans quoi le corpus ne teste
rien. C'est une extension de `anonymize-flex.mjs` à écrire, ou un anonymiseur HTML distinct :
le plan tranchera.

---

## 9. Tests

**`packages/ib-parsers`, Vitest.** Contract Information : identifiant sans tiret bas, `Symbol`
multi-alias, colonne `Underlying` insérée en 2024, section absente. Triplet de fin de
description : les formes A à D du §2.2 — les seules qui produisent une ligne — et une
description sans triplet. `realizedPnl` lu et laissé absent. `conid` / `isin` Flex présents
et absents.

**`packages/ledger`, Vitest.** Résolution : les sept règles du §5.2, une par test, dont le
ticker ambigu tranché par la date et le conflit irréductible qui ne devine rien. Rejeu : une
conversion pure conserve la base et l'ancienneté du lot ; un split laisse une miette vendue
au même instant et l'ordre tient ; une conversion fond dans un lot préexistant du même
contrat (cas B) ; une fusion mixte reproduit 1 110,00 / 391,00 / 180,40 ; la même fusion sans
`realizedPnl` ne convertit rien et se plaint. **Un `buildJournals` sans troisième argument
rend exactement ce qu'il rendait** — le test qui garde le §3.1.

**`apps/web`, Vitest sur `fake-indexeddb`.** Migration de la version 3 à la version 4 sans
perte. Un import qui écrit `contracts`, un second qui fusionne les alias sans faire reculer
`lastSeen`. Une passe d'agent qui alimente le store. `useJournals` qui passe la table au
moteur. La carte Sources qui liste les diagnostics.

**Playwright.** Import des trois relevés du corpus, puis la page Journaux montre les
positions ouvertes attendues et la carte de cohérence sans différence.

---

## 10. Ordre du plan

1. `ContractIdentity` et Contract Information dans le parseur HTML, `readSection` corrigé.
2. Ticker par jambe et `realizedPnl` dans `parseCorporateActions`.
3. `conid`, `isin` et `realizedPnl` dans le parseur Flex et celui de l'agent.
4. Corpus HTML anonymisé et son anonymiseur.
5. `ContractIdentities` et ses sept règles, dans `packages/ledger`.
6. Appariement des opérations sur titres en `CorporateActionEvent`.
7. Rejeu des conversions pures, ordre avant les trades du même instant.
8. Rejeu de la fusion mixte, `CloseEvent` `corporate_action` et ses libellés.
9. Store `contracts`, version 4 du schéma, écriture à l'import et à la passe d'agent.
10. `useJournals` et la carte Sources.
11. Oracle du corpus, et vérification que les trois oracles existants n'ont pas bougé.
12. Validation visuelle, `pnpm check`, revue de branche.

Les étapes 1 à 4 sont indépendantes des étapes 5 à 8 et peuvent avancer en parallèle. Rien
n'est visible pour l'utilisateur avant l'étape 10.

---

## 11. Documents à amender

- **`CLAUDE.md`** : la règle « les opérations de sortie sont inférées » gagne son pendant,
  les opérations sur titres sont appariées et rejouées, jamais stockées ; le `conid` est un
  indice d'équivalence et jamais une clé de contrat ; `packages/ledger` porte désormais un
  store `contracts`.
- **`docs/points-reportes.md`** : retirer « les `corporate_action` ne sont pas rejouées » ;
  ajouter les quatre trous du §7 et la branche Flex non vérifiée du §4.5.
- **`docs/specs/2026-09-03-architecture-design.md`** : la liste des colonnes Flex à cocher
  gagne `Conid` et `Security ID` sur la section Trades, en option et non en exigence.
- **Tableau des sous-projets** (`CLAUDE.md`, spec fondateur §12) : ajouter la ligne 7.

---

## 12. Décisions prises pendant le brainstorming

- **Niveaux 1 et 2 ensemble.** Le niveau 1 seul (rejeu des opérations depuis la description)
  laisse cassés ZXAB, ZXAN et ZXAAQ, que rien dans le fichier ne signale : trois symboles sur
  dix. Le niveau 2 les traite et ne coûte, côté agent et côté Flex Open Positions, que la
  lecture d'un attribut déjà présent.
- **Option (a), un store `contracts`,** plutôt que des champs `conid` / `isin` sur
  `Transaction` : l'identité est un attribut du contrat, pas de la transaction, et la liste
  d'alias n'a pas de sens sur une ligne. Corollaire : aucune migration de `Transaction` pour
  l'identité.
- **`realizedPnl` sur `Transaction` malgré tout,** pour le seul cas D. La répartition de base
  d'IB vient d'un cours que nous n'avons pas ; le P/L imprimé sur la ligne est la seule
  entrée exploitable. Alternative écartée : reporter 100 % de la base et encaisser le cash à
  part, qui rend des quantités exactes et un P/L faux sans le dire.
- **Le `conid` n'est pas une clé.** Voir §3.1 ; c'est la décision dont dépendent les trois
  oracles.
- **L'ajustement des options par un split est hors périmètre,** déclaré plutôt que tenté :
  aucun cas mesuré, une logique différente, et le moteur ne le voit pas davantage
  aujourd'hui.
