# Sous-projet 15 — La page Secteur et Score

Statut : implémenté (2026-09-14).

La table sectorielle (spec fondateur §6.7) s'importe aujourd'hui depuis une carte en bas de la
page Sources de données, et **l'import remplace la table entière** : un ticker absent du CSV
disparaît, et rien ne permet de corriger une ligne sans refaire le fichier. Un ticker que
l'utilisateur vient de trader n'y figure pas tant qu'il n'a pas pensé à l'ajouter, et tombe
dans « Sans secteur ».

Ce sous-projet donne à la table sa propre page, **Secteur et Score**, où elle s'importe par
fusion et s'édite à la main, et fait entrer d'office dans la table tout ticker nouveau apporté
par un import Interactive Brokers.

Rien ne quitte le navigateur : la table reste en IndexedDB, `apps/api` ne change pas.

---

## 1. Périmètre

Dans le périmètre :

- une page `/accounts/:accountId/sectors`, entrée de menu juste après Sources de données ;
- le déplacement de l'import CSV de la page Sources vers cette page ;
- l'import CSV **fusionné par ticker**, qui ajoute et met à jour sans jamais supprimer ;
- l'édition manuelle de la table : ajout, suppression, modification des valeurs ;
- l'ajout automatique des tickers nouveaux lors d'un import de relevé HTML, d'une synchro Flex,
  d'une passe d'agent et d'une relecture des relevés ;
- le schéma Dexie en version 7 : `importedAt` devient `updatedAt`.

Hors périmètre, déclaré tel :

- **une colonne Note** : envisagée puis retirée, `score` en tient lieu ;
- **le rattrapage des données déjà importées** : les tickers des comptes existants entrent dans
  la table au prochain import, jamais par une migration ni par un bouton ;
- **mémoriser une suppression** : un ticker supprimé à la main que les données IB portent encore
  est recréé au prochain import (§4.4) ;
- **l'usage de la table** : `sectorOf` et les agrégations par secteur ne changent pas ;
- **l'export CSV** de la table éditée : la sauvegarde chiffrée du sous-projet 6 couvrira déjà
  la table.

---

## 2. Données

### 2.1 `SectorRecord`

La table `sectors` reste **une table par utilisateur, jamais scopée par compte**, clé `ticker`.

| Champ | Type | |
|---|---|---|
| `ticker` | `string` | clé, inchangée |
| `name` | `string` | inchangé |
| `category` | `string` | inchangé |
| `score` | `number \| null` | inchangé |
| `status` | `string` | inchangé |
| `updatedAt` | ISO 8601 | **remplace `importedAt`** |

`updatedAt` est réécrit à **chaque écriture de la ligne**, quelle qu'en soit l'origine : import
CSV, édition manuelle, ajout automatique.

### 2.2 Version 7

```ts
this.version(7).stores({ sectors: "ticker" }).upgrade((tx) =>
  tx.table("sectors").toCollection().modify((row) => {
    row.updatedAt = row.importedAt;
    delete row.importedAt;
  }),
);
```

Aucune autre table n'est touchée. Les clés existantes ne sont pas renormalisées (§2.3) : elles
viennent du CSV de l'utilisateur, déjà en majuscules.

### 2.3 Normalisation du ticker

`normalizeTicker(text)` : `trim()` puis majuscules. Appliquée par l'import CSV, par l'ajout
manuel et par l'ajout automatique, pour que « aapl » et « AAPL » soient une seule ligne.

---

## 3. Import CSV

### 3.1 Lecture — `parseSectorCsv(text)`

- Séparateur `;`, BOM toléré, première ligne d'en-têtes, colonnes lues **par nom** : `Ticker`,
  `Name`, `Category`, `Score`, `Status`. `S-*` et `Last Date` ignorées.
- En-tête `Ticker` absent : `SectorCsvError`.
- `Ticker` vide après normalisation : ligne ignorée.
- Rend des **lignes partielles** : `{ ticker } & Partial<{ name, category, score, status }>`.
  Un champ n'est présent que si sa colonne l'est dans l'en-tête. Une cellule vide d'une colonne
  présente donne `""`, ou `null` pour `Score`.
- `Score` non vide illisible (`Number` non fini) : `SectorCsvError`, comme aujourd'hui.

### 3.2 Fusion — `importSectorCsv(db, file)`

Dans **une transaction** sur `db.sectors` :

| Cas | Effet |
|---|---|
| ticker absent de la base | ligne ajoutée ; les champs absents du fichier prennent leur valeur vide (`""`, `null`) |
| ticker présent en base | les champs présents dans la ligne partielle écrasent ceux de la base, **cellule vide comprise** ; les champs absents sont gardés |
| ticker en base, absent du fichier | intact |
| même ticker deux fois dans le fichier | la dernière ligne l'emporte |

`updatedAt` vaut l'instant de l'import sur toutes les lignes du fichier, modifiées ou non.
Une `SectorCsvError` n'écrit rien.

Compte rendu : `{ status: "ok"; added: number; updated: number }` ou
`{ status: "error"; detail: string }`. `updated` compte les tickers du fichier déjà présents en
base ; un ticker en double dans le fichier ne compte qu'une fois.

---

## 4. Ajout automatique lors des imports IB

### 4.1 Où

Dans la **transaction Dexie existante** de chaque écriture IB, `db.sectors` ajoutée à sa liste
de tables :

| Écrivain | Données lues |
|---|---|
| `importFile` (relevé HTML, fichier Flex, et donc la synchro Flex) | `parsed.transactions`, `parsed.snapshot?.positions`, `parsed.identities` |
| `syncAgent` | `parsed.transactions`, `parsed.positions`, `parsed.identities` |
| `replayStatements` | l'union des mêmes champs de chaque relevé relu |

Toutes les lignes que la source a lues, pas seulement celles que `planImport` écrit ni seulement
un snapshot retenu : un ticker vu est un ticker réel quelle que soit la plage où tombe la ligne,
exactement comme pour `contracts`. Un import en erreur n'écrit rien, table sectorielle comprise.

La transaction lit les clés de `db.sectors` puis fait un `bulkAdd` des manquantes : deux comptes
qui importent en même temps le même ticker sont sérialisés par Dexie, le verrou d'import par
compte n'y suffirait pas.

### 4.2 Quels tickers — `missingSectorRecords(known, sources, at)`

Fonction pure dans `apps/web/src/db/sectors.ts` :

```ts
export interface SectorSources {
  transactions: readonly Transaction[];
  positions: readonly Position[];
  identities: readonly ContractIdentity[];
}
export function missingSectorRecords(known: ReadonlySet<string>, sources: SectorSources, at: string): SectorRecord[];
```

- Transactions et positions de `secType` **`STK` ou `OPT`** seulement, ticker lu par
  `normalizeTicker(tickerOf(symbol))` : le sous-jacent d'une option, symbole OCC empaqueté de
  Flex compris. `CASH` (paires `EUR.USD`), lignes sans titre (frais, intérêts, dividendes),
  `FOP`, `WAR` et autres : ignorés.
- Ticker vide : ignoré.
- Ticker finissant par **`.OLD`** : ignoré. C'est le nom qu'IB donne au contrat mort d'un
  changement de CUSIP ; les journaux le ramènent au ticker courant (`identities.canonical`),
  donc `sectorOf` ne le demanderait jamais.
- Ticker déjà dans `known` : ignoré. **Une ligne existante n'est jamais modifiée par un import
  IB**, nom compris.
- Chaque ticker restant donne une ligne, dans l'ordre de première apparition (transactions, puis
  positions).

### 4.3 Nom prérempli

Pour chaque ticker ajouté, `name` est la première description retenue, dans cet ordre :

1. une identité `secType === "STK"` dont `tickers` contient le ticker ;
2. une transaction `kind === "trade"` et `secType === "STK"` de ce ticker ;
3. une position `STK` de ce ticker.

Une description vide, ou qui ne fait que répéter le ticker, n'est pas retenue : c'est ce
qu'écrivent les relevés HTML et TWS pour une action (« TESTX », « SYMA ») ; seul Flex y met le
nom de la société. Une opération sur titres n'est jamais lue : sa description est une phrase sur
l'événement (« … CUSIP/ISIN Change to … »), pas un nom.

Sinon `""` : un ticker vu seulement à travers des options n'a pas de nom. `category` et `status`
valent `""`, `score` `null`, `updatedAt` l'instant de l'import.

Sur les fixtures versionnées : un Flex ajoute `SYM1` à `SYM23`, `SYM1` à `SYM6` nommés par leurs
trades ; le relevé HTML ajoute `TESTC`, `TESTE`, `TESTH`, `TESTP`, `TESTX`, `TWINX` et `ZQX`, sans
nom, jamais `EUR.USD` ni `TESTV.OLD` ; l'agent ajoute `SYMA`, sans nom.

### 4.4 Conséquence acceptée

Un ticker supprimé à la main que les données IB portent encore est recréé au prochain import —
avec l'agent, cinq minutes plus tard. La table ne mémorise pas les suppressions (§1).

---

## 5. Écritures manuelles

Dans `apps/web/src/db/sectors.ts`, seul chemin d'écriture de la page, qui ne touche jamais
`db.sectors` directement :

- `addSector(db, row: { ticker, name, category, score, status }): Promise<"added" | "exists" | "invalid">` —
  ticker normalisé, `name`, `category` et `status` sans espaces de bord ; ticker vide :
  `"invalid"` ; déjà présent : `"exists"`, rien n'est écrit. Lecture et écriture dans une même
  transaction.
- `updateSector(db, ticker, patch: Partial<{ name, category, score, status }>): Promise<boolean>` —
  `false` si la ligne n'existe plus (supprimée entre-temps) ; sinon écrit le patch, textes sans
  espaces de bord, et `updatedAt`.
- `deleteSector(db, ticker): Promise<void>`.

`parseScoreInput(text): number | null | "invalid"` : `trim()`, vide → `null`, virgule décimale
acceptée (`7,5` → `7.5`), `Number` non fini → `"invalid"`. Réservé à la saisie manuelle ; l'import
CSV garde `Number` tel quel.

---

## 6. La page

### 6.1 Route et menu

- Route `sectors` sous `/accounts/:accountId`, composant `SectorsPage`.
- `NAV_SECTIONS`, groupe Configuration : `{ labelKey: "nav.sectors", icon: Tags, to: accountPath("sectors") }`
  inséré **juste après** `nav.sources`, avant `nav.consistency`.
- Libellés : « Secteur et Score » / « Sectors & scores ».

Sous le compte et non hors compte comme `/settings` : la coquille reste active — verdicts de la
barre de titre, `SnapshotStatus`, synchro Flex automatique et polling de l'agent, qui s'arrêtent
tous hors compte. La page dit en toutes lettres que la table est commune à tous les comptes.

### 6.2 Carte « Import CSV »

Aide (colonnes lues, fusion par ticker, rien n'est supprimé), bouton « Importer un CSV », compte
rendu (`data-testid="sector-report"`) : « Tickers ajoutés : 3, mis à jour : 12. » ou « Import
annulé : {{detail}} » en `text-destructive`. Bouton désactivé pendant l'import.

La carte `sector-card` et son état disparaissent de `SourcesPage`.

### 6.3 Carte « Table sectorielle »

- Ligne de résumé : « N tickers, dernière modification {{date}} », date = `max(updatedAt)` ;
  table vide : « Pas encore de table sectorielle. ».
- Filtre texte au-dessus du tableau, insensible à la casse, sur `ticker`, `name` et `category`.
  État local, jamais persisté. Aucune ligne ne correspond : « Aucun ticker ne correspond au
  filtre. ».
- Tableau trié par ticker, colonnes Ticker, Nom, Secteur, Score, Statut (champs `name`,
  `category`, `score`, `status`), puis la colonne des actions.
- Table vide : le tableau garde sa ligne d'ajout.

**Ligne d'ajout**, en tête du tableau : un champ par colonne, bouton « Ajouter », Entrée dans un
champ vaut « Ajouter ». Bouton désactivé tant que le ticker est vide. Le score est lu par
`parseScoreInput` avant l'appel : `"invalid"` affiche « Score illisible : un nombre, ou vide. » et
`addSector` n'est pas appelé. `"exists"` : message « AAPL est déjà dans la table. », rien n'est
effacé des champs. Succès : champs vidés, focus rendu au ticker.

**Lignes existantes** :

- Ticker en lecture seule. Renommer = supprimer puis ajouter.
- Nom, Secteur, Score, Statut : un `Input` chacun, libellé accessible « Secteur AAPL ».
  Enregistrement **au blur ou sur Entrée**, seulement si la valeur a changé ; **Échap** restaure
  la valeur enregistrée.
- Score illisible : champ en erreur (`aria-invalid`), rien n'est enregistré ; la valeur saisie
  reste affichée jusqu'à correction ou Échap.
- Secteur et Statut proposent les valeurs déjà présentes dans la table (`datalist`).
- Bouton de suppression, libellé accessible « Supprimer AAPL », `window.confirm` avant
  `deleteSector`, comme les autres suppressions de l'application.
- Chaque champ suit la valeur enregistrée tant que l'utilisateur ne le modifie pas : une ligne
  réécrite pendant l'édition (un import CSV, par exemple) met à jour ses champs intacts, jamais
  celui où l'on tape. Un ajout automatique n'ajoute que des lignes et ne perturbe aucune saisie.

Quelques centaines de lignes : pas de virtualisation.

---

## 7. Tests

- **`db/sectors.test.ts`** :
  - `parseSectorCsv` rend des lignes partielles : colonne absente → champ absent, cellule vide →
    `""`/`null`, ticker normalisé, erreurs inchangées ;
  - `importSectorCsv` : ajout, mise à jour, colonne absente gardée, cellule vide qui efface,
    ticker hors fichier intact, doublon dans le fichier, compte rendu `added`/`updated`, erreur
    qui n'écrit rien ;
  - `missingSectorRecords` : `STK` et `OPT`, symbole OCC empaqueté et racine à six caractères,
    `CASH` et ligne sans titre exclus, `.OLD` exclu, ticker connu ignoré, ordre de priorité du nom,
    description qui répète le ticker et opération sur titres jamais retenues, nom vide pour un
    ticker vu seulement en option ;
  - `addSector` (`added`, `exists`, `invalid`), `updateSector` (patch et `updatedAt`, `false` sur
    ligne disparue), `deleteSector`, `parseScoreInput`.
- **`db/importFile.test.ts`**, **`agent/sync.test.ts`**, **`db/replayStatements.test.ts`** : les
  tickers attendus des fixtures (§4.3) entrent dans la table, une ligne existante sur un ticker
  des données reste identique ; un import refusé n'ajoute rien.
- **`db/schema.test.ts`** : une base en version 6 avec des lignes `importedAt` s'ouvre en version 7
  avec `updatedAt` à la même valeur et sans `importedAt`.
- **`pages/SectorsPage.test.tsx`** (sur `fake-indexeddb`, table semée en base) : import CSV et
  compte rendu, résumé, tri et filtre, ajout, doublon refusé, score illisible à l'ajout, édition
  enregistrée au blur et sur Entrée, Échap, score invalide non enregistré, `7,5` enregistré `7.5`,
  suppression confirmée et annulée, valeurs proposées, champ en cours de saisie préservé.
- **`pages/SourcesPage.test.tsx`** : les tests sectoriels partent vers `SectorsPage.test.tsx`, la
  page n'a plus de carte sectorielle.
- **Navigation** (`lib/navigation.test.ts`, `routes/router.test.tsx`) : l'entrée « Secteur et
  Score » suit immédiatement « Sources de données » et mène à la page.
- **`run-frontend`** : capture de la page sur la graine `--seed`.

---

## 8. Documentation et outillage

- `apps/web/src/i18n/{fr,en}.json` : clés `nav.sectors` et `sectors.*`, suppression de
  `sources.sectors.*`.
- `apps/web/src/mocks/positions.ts`, `mocks/journals.ts` : `importedAt` → `updatedAt`.
- `.claude/skills/run-frontend/driver.mjs` et `SKILL.md` : `--sectors=` importe le CSV depuis la
  page Secteur et Score.
- `docs/specs/2026-09-03-architecture-design.md` §6.7 : import depuis la page Secteur et Score,
  fusion par ticker, édition manuelle, ajout automatique par les imports IB.
- `CLAUDE.md` : ligne 15 du tableau des sous-projets, et une règle — la table sectorielle se
  fusionne par ticker et ne perd jamais une ligne par import ; un import IB y ajoute les tickers
  `STK`/`OPT` nouveaux et ne modifie jamais une ligne existante.
- `docs/points-reportes.md` : l'entrée « la date dernier import de la carte sectorielle lit un
  élément arbitraire de la Map » est soldée par `max(updatedAt)` et retirée.

---

## 9. Décisions écartées

| Décision | Raison |
|---|---|
| Colonne Note | Même rôle que `score`, retirée à la demande de l'utilisateur |
| L'import CSV remplace toute la table | C'est ce qui disparaît : une ligne éditée à la main ou ajoutée par un import IB serait perdue au prochain CSV |
| Cellule vide du CSV qui garde la valeur | Le fichier fait foi pour les colonnes qu'il porte ; seule une colonne absente protège la base |
| Nom IB qui met à jour une ligne existante | Un import IB n'écrit que des lignes nouvelles : il ne doit jamais défaire une saisie de l'utilisateur |
| Nom lu sur toute transaction `STK` | Relevés et TWS y écrivent le ticker, une opération sur titres une phrase : la colonne Nom se remplirait de bruit |
| Rattrapage à la migration Dexie ou par bouton | Choix de l'utilisateur : la table se remplit au fil des imports |
| Mémoriser les tickers supprimés | Complexité sans demande ; la recréation au prochain import est acceptée (§4.4) |
| Route hors compte `/sectors` | Couperait les verdicts, la synchro Flex automatique et le polling de l'agent pendant l'édition |
| Édition par dialogue | L'édition en place est plus directe pour corriger beaucoup de lignes |
| Renommer un ticker en place | Le ticker est la clé ; supprimer puis ajouter suffit |
