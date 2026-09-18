# Sous-projet 1 — Socle du monorepo et Historique au palier 2, sans serveur

> Spec validé en brainstorming le 3 septembre 2026. Décline le spec fondateur
> `2026-09-03-architecture-design.md` (§5, §6.1 à §6.3, §6.6, §9, §11, §12), qui reste la
> référence pour tout ce qui n'est pas précisé ici.

---

## 1. Périmètre

Livrer une application utilisable de bout en bout, sans serveur ni agent : créer un compte,
importer un XML Flex et un relevé HTML depuis le disque, lire la page Historique avec ses
soldes cumulés USD et EUR.

**Dans le périmètre :**

- Squelette pnpm : `apps/web`, `packages/ui`, `packages/ledger`, `packages/ib-parsers`.
- `ledger` : type `Transaction`, ordre de référence, effet cash, soldes cumulés, filtres,
  planificateur de propriété de plage.
- `ib-parsers` : Flex XML (Trades, Cash Transactions, Corporate Actions) et relevé HTML
  (sections de la première version plus Option Cash Settlement), avec compte rendu des manques.
- IndexedDB via Dexie : comptes, transactions, journal des imports.
- Coquille web reprise de la première version, page Historique fonctionnelle, page Sources de
  données en version fichier, page de création de compte, coquilles vides pour le reste.
- Skill `run-frontend` copié et adapté.

**Hors périmètre, avec le sous-projet qui les prend :**

| Élément | Sous-projet |
|---|---|
| Open Positions Flex, pages Dashboard et Positions, table sectorielle | 2 |
| Workspace uv, `pyproject.toml`, `tools/coverage-oracle` | 2 |
| Serveur, proxy Flex, synchro à l'ouverture, Playwright, déploiement | 3 |
| Source `agent`, page Aujourd'hui | 4 |
| Renommage de compte, export et import JSON, page Paramètres | 5 |
| Journaux | 6 |
| Section Transfers (Flex et HTML) | quand un utilisateur en aura besoin ; aucun fichier réel n'en contient |

Pas de GitHub : aucune CI distante. `pnpm check` tient ce rôle en local.

---

## 2. Monorepo et outillage

```
IB_Analyzer2/
  package.json            scripts racine : dev, test, lint, typecheck, check
  pnpm-workspace.yaml     apps/*, packages/*
  tsconfig.base.json      strict, ES2024, moduleResolution bundler
  .oxlintrc.json
  apps/web/               Vite 8, React 19, react-router 8, i18next, Tailwind 4
  packages/ui/            composants shadcn base-ui, copiés de frontend/src/components/ui
  packages/ledger/        TS pur, zéro dépendance
  packages/ib-parsers/    TS pur, dépend de ledger pour les types
  docs/specs/, docs/plans/
  .claude/skills/run-frontend/
```

- **Pas d'étape de build pour les paquets.** Chaque `package.json` exporte `src/index.ts` ;
  Vite et Vitest consomment le TS directement. `typecheck` est un `tsc --noEmit` par paquet.
  Seul `apps/web` a un build.
- **Versions reprises de la première version** : TypeScript 6, Vite 8, Vitest 4, React 19,
  react-router 8, `@base-ui/react`, Tailwind 4, oxlint, Testing Library, jsdom. Les fichiers
  copiés compilent sans adaptation. ECharts et TanStack Query ne sont **pas** installés :
  la page Historique n'a pas de graphique et aucun appel serveur n'existe.
- **`pnpm check`** enchaîne lint, typecheck et tests sur tout l'espace de travail. C'est la
  commande à passer avant chaque merge sur `main`. Pas de hook git imposé.
- **Tests colocalisés** `*.test.ts` à côté du code. Fixtures dans `tests/fixtures/` du
  paquet concerné.
- **`packages/ui`** contient uniquement les composants générés par shadcn et son
  `components.json`. Le thème (`index.css`, jetons de couleur, polices Geist) reste dans
  `apps/web`, qui déclare `@source` vers `packages/ui` pour Tailwind. Coquille et thème
  restent réutilisables sans emporter le métier.
- Dépendances de lecture réactive : `dexie` et `dexie-react-hooks` dans `apps/web`,
  `fake-indexeddb` en dev.

Code et commentaires en anglais, documentation et messages de commit en français, comme
dans la première version.

---

## 3. `packages/ledger`

TS pur, aucune dépendance, aucune notion de stockage.

### 3.1 Type `Transaction`

```ts
type TransactionKind =
  "trade" | "dividend" | "interest" | "fee" | "tax" | "corporate_action" | "transfer";
type TransactionSource = "flex" | "statement_html" | "agent";

interface Transaction {
  accountId: string;        // slug du compte, §5.3
  externalId: string;       // flex:trade:{tradeID} | flex:cash:{transactionID}
                            // | flex:ca:{transactionID} | html:{sha256}[#n]
  source: TransactionSource;
  kind: TransactionKind;
  symbol: string;
  secType: string;          // "STK", "OPT", "CASH", "" si sans objet
  right: "C" | "P" | "";
  strike: number | null;
  expiry: string | null;    // YYYY-MM-DD
  quantity: number | null;  // signée : vente négative
  price: number | null;
  amount: number | null;    // effet cash brut, dans `currency`
  commission: number | null;
  currency: string;
  when: string;             // ISO 8601 UTC
  description: string;
}
```

- **Pas de `multiplier` ni de `netCash`** : rien ne les lit avant le sous-projet 5 et
  `amount` porte déjà l'effet cash complet. Ils s'ajouteront le jour où un journal en a besoin.
- **`when`** est stampé UTC à partir de l'heure IB naïve, sans conversion, même hypothèse que
  la première version : Flex Query et relevés doivent être configurés sur le même fuseau
  dans le Client Portal. Une ligne datée sans heure prend minuit.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- Nombres en `number` flottant, comme partout dans la première version.

### 3.2 Ordre de référence

`compareTransactions(a, b)` : `when` croissant puis `externalId` croissant. Les relevés HTML
horodatent à minuit ; sans second critère les soldes cumulés seraient instables.

### 3.3 Fonctions pures

| Fonction | Rôle |
|---|---|
| `cashImpact(tx)` | Effet signé sur le solde de `currency`. `null` si `amount` est `null`. Sur une paire de devises (symbole `^[A-Z]{3}\.[A-Z]{3}$`), la commission est exclue : IB la prélève en devise de base. Sinon `amount + (commission ?? 0)`. Règle de l'ancien `Transaction.cash` |
| `runningBalances(txs, currencies)` | Soldes cumulés après chaque ligne, dans l'ordre de référence, pour les devises demandées (`["USD", "EUR"]` dans la page). Calculé sur **tout** le ledger du compte, jamais sur une page filtrée. Sur une paire, `amount` va à la devise de cotation (`currency`), `quantity` et `commission` à la devise de base (les trois premières lettres du symbole). Une ligne qui ne touche qu'une devise reporte l'autre |
| `filterTransactions(txs, { symbol?, kind?, from?, to? })` | Filtres de la page Historique : symbole en sous-chaîne insensible à la casse, type exact, dates en jours entiers inclusifs |
| `planImport(existing, incoming)` | Propriété de plage, §3.4 |

Le cumul part de la transaction la plus ancienne du ledger. Sur un historique incomplet, le
niveau est décalé d'une constante et seule la variation est exacte ; les en-têtes de
colonnes le signalent en infobulle, comme avant.

### 3.4 `planImport` : propriété de plage

Entrée : les lignes existantes du compte, et un lot `{ source, transactions, period }` où
`period` est la période déclarée par le fichier (`fromDate`/`toDate` Flex, en-tête du
relevé). Sortie :

```ts
interface ImportPlan {
  delete: string[];                       // externalId à supprimer
  upsert: Transaction[];
  dropped: { kind: TransactionKind; count: number }[];  // lignes d'autres sources retirées
  skipped: number;                        // lignes du lot non écrites
}
```

Règles, dans cet ordre :

1. **Flex.** Les lignes Flex sont upsertées par `externalId` et **conservées pour toujours** :
   une ligne sortie de la fenêtre glissante de 365 jours n'est jamais effacée par une synchro
   suivante. Les lignes des **autres sources** dont `when` tombe dans `[jour(min(when)), max(when)]`
   du lot, bornes incluses — borne basse ramenée au début de sa journée puisque la requête Flex
   couvre cette journée entière, borne haute laissée à l'instant précis pour ne pas effacer les
   écritures que l'agent local (sous-projet 4) ajoute plus tard ce même jour — sont supprimées
   et comptées dans `dropped` par `kind`. Un lot vide ne supprime rien.
2. **Relevé HTML, borne Flex.** Si le compte a des lignes Flex, seules les lignes du relevé
   datées **strictement avant le jour** de `min(when)` Flex sont écrites ; les autres comptent
   dans `skipped`. Sans ligne Flex, tout passe.
3. **Relevé HTML, période déclarée.** Les lignes `statement_html` existantes dont `when` tombe
   dans la période déclarée du relevé sont supprimées, puis le lot est écrit. Réimporter un
   relevé est idempotent ; deux relevés qui se recouvrent ne doublonnent pas. Le spec
   fondateur ne tranchait pas ce cas.
4. **Jumelles.** `externalId` HTML vaut
   `html:{sha256(accountId|section|symbol|when|quantity|price|amount)}`, suffixé `#2`, `#3`…
   pour les lignes strictement identiques d'un même fichier, dans l'ordre du fichier. Deux
   transactions jumelles survivent et un réimport les retrouve.
5. La source `agent` figure dans le type mais n'est pas traitée avant le sous-projet 4 ; le
   planificateur rejette un lot `agent` avec une erreur explicite.

Le suivi « avertissement une fois par nature » sur `dropped` est un état de synchro : il vit
dans `apps/web` (§5.1), pas dans `ledger`.

---

## 4. `packages/ib-parsers`

Deux fonctions pures sur `DOMParser`, testées sous jsdom. Aucune écriture, aucune
dépendance hors `ledger`.

### 4.1 Contrat commun

```ts
interface ParseIssue {
  severity: "error" | "warning";
  code: "account-mismatch" | "section-missing" | "column-missing"
      | "unknown-cash-type" | "row-skipped" | "normalization";
  detail: string;   // lisible tel quel dans la page Sources de données
}
interface ParseResult<S> {
  transactions: Transaction[];
  statement: S;
  issues: ParseIssue[];
}
```

- **Garde-fou de compte.** Chaque fonction reçoit l'identifiant IB attendu. S'il diffère de
  celui du fichier (attribut `accountId` Flex, `id` des tables HTML), le résultat porte une
  erreur `account-mismatch` et `transactions` est vide. C'est ce qui empêche concrètement de
  mélanger deux comptes.
- **Une section ou colonne manquante est un avertissement**, jamais un blocage. Une colonne
  est déclarée manquante si l'attribut est absent sur **toutes** les lignes d'un lot non vide ;
  les colonnes d'options (`strike`, `expiry`, `putCall`) ne sont évaluées que sur les lignes
  `OPT`. Règle de la première version.
- **Une erreur de normalisation** (nombre ou date illisible, identifiant absent, ligne dont le
  nombre de cellules ne correspond pas aux en-têtes d'une section requise) porte une erreur
  `normalization` : l'import entier est annulé, le ledger n'est pas touché.
- Un type de cash inconnu est classé `fee` avec un avertissement `unknown-cash-type` nommant
  le type, jamais en silence.
- Valeur absente `null`, quantités signées, `subtotal` et `total` exclus, `header-asset` et
  `header-currency` lus comme contexte.

### 4.2 `parseFlexXml(xml, expectedIbAccountId)`

`statement` : `{ ibAccountId, fromDate, toDate, whenGenerated }` lus sur `<FlexStatement>`.

| Section | `kind` | `externalId` | Notes |
|---|---|---|---|
| `Trades/Trade` | `trade` | `flex:trade:{tradeID}`, sinon `transactionID` | `dateTime` `YYYYMMDD;HHMMSS` ou `YYYYMMDD` ; `proceeds` → `amount`, `tradePrice` → `price`, `ibCommission` → `commission`, `assetCategory` → `secType`, `putCall` → `right` |
| `CashTransactions/CashTransaction` | par `type` | `flex:cash:{transactionID}` | `type` est un **libellé** (« Deposits/Withdrawals », « Withholding Tax », « Broker Interest Received », « Dividends », « Payment In Lieu Of Dividends », « Other Fees »…), mappé par table ; `dateTime` souvent à la journée seule |
| `CorporateActions/CorporateAction` | `corporate_action` | `flex:ca:{transactionID}` | `proceeds` → `amount`, `quantity` |
| `OpenPositions` | | | absente : avertissement `section-missing`, lecture au sous-projet 2 |
| `Transfers` | | | non lue ; présente : avertissement « présente mais non lue » |

Sections requises pour l'Historique : `Trades` et `CashTransactions`. Colonnes surveillées :
`tradePrice`, `proceeds`, `ibCommission` sur Trades ; `strike`, `expiry`, `putCall` sur les
options.

**Trou connu** : le règlement en cash d'une option sur indice exercée (§4.3) n'a pas été
observé dans un XML Flex réel. Sa forme côté Flex est à vérifier le jour où un tel événement
tombe dans une fenêtre Flex ; d'ici là il n'est pris que par le relevé HTML.

### 4.3 `parseActivityStatement(html, expectedIbAccountId)`

`statement` : `{ ibAccountId, periodStart, periodEnd }`, période lue dans le `<title>`
(« U10012345 Activity Statement January 1, 2025 - December 31, 2025 »), identifiant lu dans
les `id="tbl<Section>_<compte>Body"`.

| Section HTML | `kind` | Notes |
|---|---|---|
| `Transactions` | `trade` | symbole d'option `AANZ 26SEP25 24 P` éclaté par regex ; `T. Price`, `Proceeds`, `Comm/Fee` ; catégorie d'actif → `secType` (`Stocks` → `STK`, `Equity and Index Options` → `OPT`, `Forex` → `CASH`, `Warrants` → `WAR`, autre → le libellé tel quel avec avertissement) |
| `CombDiv` | `dividend` | symbole extrait du libellé `TESTX(US0000000000) Cash Dividend…` |
| `WithholdingTax` | `tax` | |
| `CombInt` | `interest` | |
| `CombFees` | `fee` | |
| `CombDepWith` | `transfer` | dépôts et retraits |
| `CorporateActions` | `corporate_action` | |
| `OptionCashSettlement` | `trade` | **nouveau**, §4.4 |
| `Transfers` | | non lue ; présente : avertissement |

Sections requises : `Transactions`. Les autres, absentes, ne produisent pas d'avertissement :
un relevé sans dividende est normal. Une conversion de devises apparaît dans `Transactions`
sous la catégorie Forex avec un symbole `EUR.USD` ; la règle des trois champs de `ledger` la
reconnaît à la forme du symbole, jamais à `secType`.

### 4.4 Option Cash Settlement

Une option sur indice réglée en cash (XSP, SPX) exercée ou assignée ne livre aucun titre. IB
écrit l'événement à deux endroits du relevé : dans `Transactions`, une ligne qui ferme la
position à prix 0 et proceeds 0 (code `C;Ex` ou `C;A`), et dans `Option Cash Settlements`, le
montant effectivement versé ou prélevé. La première version ne lisait que la première : le
solde cumulé manquait chaque règlement.

Chaque ligne d'`Option Cash Settlements` devient une transaction :

| Champ | Valeur |
|---|---|
| `kind`, `secType` | `trade`, `OPT` |
| `symbol`, `expiry`, `strike`, `right` | tirés du libellé `Exercise ( XSP 29JUL25 639 P )` par la même regex que les trades |
| `quantity`, `price`, `commission` | `null` |
| `amount` | colonne `Amount`, signée (positive à l'exercice d'un long, négative à l'assignation) |
| `description` | le libellé tel quel |
| `when` | colonne `Date` |

Pour l'Historique c'est une ligne filtrable par symbole. Pour les journaux du sous-projet 5,
elle se rattache au contrat par ses quatre champs.

### 4.5 Fixtures

- **HTML** : `activity_statement_sample.htm`, la fixture de relevé de la première version,
  reprise telle quelle puis complétée d'une section `OptionCashSettlement` d'une ligne et
  d'une paire de lignes jumelles.
- **Flex** : produite par un **script d'anonymisation versionné**,
  `packages/ib-parsers/scripts/anonymize-flex.ts`, qui prend un XML de `private/` et
  réécrit identifiant de compte, identifiants de transactions, symboles, libellés et montants
  en conservant la structure, les types et les dates. On le rejouera au sous-projet 2 quand
  Open Positions sera cochée. La fixture est committée ; le fichier source jamais.
- Fixtures unitaires minimales écrites à la main pour les cas absents des fichiers réels :
  colonne manquante, type de cash inconnu, identifiant absent, compte différent.

---

## 5. `apps/web` : IndexedDB et imports

### 5.1 Schéma Dexie

Base `ib-analyzer`, version 1.

| Table | Clé | Index | Contenu |
|---|---|---|---|
| `accounts` | `id` (slug) | | `label`, `ibAccountId`, `createdAt`, `warnedDroppedKinds: TransactionKind[]`. Jeton Flex, query id, port de l'agent s'ajoutent aux sous-projets 3 et 4 sans migration : champs non indexés |
| `transactions` | `[accountId+externalId]` | `accountId`, `[accountId+when]` | lignes `Transaction` |
| `imports` | `++id` | `accountId` | journal : `source`, `at`, `fileName`, `period`, `imported`, `skipped`, `dropped`, `issues` |

Le dernier compte visité reste en `localStorage` (`ib2:lastAccountId`), comme avant.

### 5.2 `importFile(accountId, file)`

1. Lire le fichier ; détecter le format au contenu : `<FlexQueryResponse` ou balise `<html`.
   Sinon, erreur « format non reconnu ».
2. Parser avec l'identifiant IB du compte. Toute `issue` de sévérité `error` arrête là : rien
   n'est écrit, le compte rendu l'affiche.
3. Charger le ledger existant du compte, appeler `planImport`.
4. Appliquer le plan dans **une seule transaction Dexie** `rw` sur `transactions`, `imports`,
   `accounts` : `bulkDelete`, `bulkPut`, ajout de la ligne d'import, mise à jour de
   `warnedDroppedKinds`. Un échec à mi-chemin annule tout.
5. Rendre le compte rendu `ImportReport` : source, période, `imported`, `skipped`, `dropped`
   filtré aux natures pas encore signalées sur ce compte, `issues`. La page Historique se met
   à jour d'elle-même par `useLiveQuery`.

### 5.3 Comptes

- Création : libellé et identifiant IB (`^[A-Z]{1,2}\d{6,9}$`). Le slug est dérivé du
  libellé (minuscules, ASCII, tirets) et doit être unique ; un doublon est refusé avec un
  message. Le slug est l'`accountId` des routes et de toutes les clés IndexedDB.
- Suppression : depuis Sources de données, avec confirmation ; efface les transactions et
  les imports du compte dans la même transaction. Si c'était le dernier compte visité, la
  mémoire est effacée.
- Renommage : sous-projet 6.

### 5.4 Hooks de lecture

`useAccounts()`, `useAccount(id)`, `useLedger(accountId)` sur `dexie-react-hooks`.
`useLedger` rend le ledger du compte trié dans l'ordre de référence, mémoïsé sur le
résultat live ; `undefined` tant que la requête n'a pas répondu.

---

## 6. `apps/web` : pages et navigation

### 6.1 Repris de la première version

Tel quel, tests inclus : `AppLayout`, `app-sidebar`, `LanguageSwitcher`, `ThemeToggle`,
`useTheme`, `use-mobile`, `index.css`, `format.ts`, `utils.ts`, `PlaceholderPage`, `en.json`
et `fr.json` complétés des nouvelles clés.

Adaptés : `AccountSwitcher` et `RootRedirect` lisent les comptes en IndexedDB au lieu de la
liste codée en dur ; `navigation.ts` remplace Portefeuilles par Sources de données et ajoute
Paramètres ; `accountStorage.ts` perd le type `AccountId` fermé au profit d'un `string`.

Le rendu visuel est celui de la première version, vérifié côte à côte (§7).

### 6.2 Routes

| Route | Contenu |
|---|---|
| `/` | redirige vers le dernier compte visité, sinon le premier compte, sinon `/accounts` |
| `/accounts` | page sans compte : liste des comptes, formulaire de création. Aussi jointe par « Ajouter un compte » dans le sélecteur |
| `/accounts/:id` | redirige vers `dashboard` |
| `/accounts/:id/history` | Historique, fonctionnelle |
| `/accounts/:id/sources` | Sources de données, version fichier |
| `/accounts/:id/dashboard`, `positions`, `today`, `journal/wheel`, `journal/leaps`, `journal/condors` | coquilles vides |
| `/settings` | coquille vide |
| `/accounts/:id/premiums` | redirection historique vers `journal/wheel`, conservée |

Un `:id` inconnu affiche un message et un lien vers `/accounts`, jamais une page blanche.

### 6.3 Historique

Page copiée ; le hook TanStack est remplacé par `useLedger` puis, en mémoire et mémoïsés :
`runningBalances(ledger, ["USD", "EUR"])`, `filterTransactions`, pagination à 30 lignes.
Colonnes, filtres, anti-rebond de 300 ms sur la recherche, retour en page 1 au changement de
filtre, infobulles des soldes : identiques. Le type `Transaction` vient de `ledger` ; la
colonne Cash affiche `cashImpact`. État de chargement tant que `useLedger` rend `undefined` ;
« Aucune transaction ne correspond » sur un ledger vide ou un filtre sans résultat.

### 6.4 Sources de données

Page nouvelle, composée avec les cartes et tables du Dashboard :

1. **Compte** : libellé, identifiant IB.
2. **Import** : bouton « Importer un fichier » acceptant `.xml` et `.htm`/`.html`, mention des
   deux formats ; pendant l'import, bouton désactivé ; ensuite le **compte rendu** : source
   détectée, période, lignes importées, ignorées, types supprimés, avertissements en clair,
   ou l'erreur qui a tout annulé.
3. **Imports passés** : table date, source, fichier, période, lignes, avertissements.
4. **Supprimer le compte**, avec confirmation.

Les blocs jeton Flex, synchro et agent s'ajoutent ici aux sous-projets 3 et 4.

### 6.5 Création de compte

Formulaire libellé et identifiant IB, validation en ligne, erreur de doublon de slug, puis
redirection vers `/accounts/:id/sources`.

---

## 7. Tests et acceptation

### 7.1 Automatique, `pnpm check`

| Paquet | Outil | Tests qui doivent casser si le comportement change |
|---|---|---|
| `ledger` | Vitest | ex-æquo sur `when` départagés par `externalId` ; conversion `EUR.USD` sur trois champs ; commission exclue du `cashImpact` d'une paire ; jumelles conservées ; relevé qui chevauche remplace sa période ; relevé ignoré à partir du premier jour Flex ; Flex ne supprime jamais ses propres lignes anciennes ; lot vide ne supprime rien ; `dropped` compté par `kind` ; lot `agent` refusé |
| `ib-parsers` | Vitest, jsdom, fixtures | sections, sous-totaux, quantités négatives, multi-devises, symbole d'option éclaté, ligne Option Cash Settlement, `dateTime` à la journée, colonne absente détectée sur toutes les lignes seulement, options évaluées sur les options seulement, garde-fou de compte, type de cash inconnu, `null` jamais `0`, erreur de normalisation qui vide `transactions` |
| `apps/web` | Vitest, Testing Library, `fake-indexeddb` | pages sur ledger semé en base et non hooks moqués ; import puis réimport idempotent ; import Flex puis relevé qui chevauche ; erreur de compte qui ne touche rien ; atomicité ; suppression de compte ; navigation, formatage, i18n |

Pas de Playwright avant le sous-projet 3.

### 7.2 Manuel, sur données réelles

Documenté dans le plan et rejoué avant le merge :

1. Lancer la première version et la nouvelle côte à côte (skill `run-frontend`), page
   Historique de `beta` : mêmes lignes, même rendu.
2. Importer le XML Flex de `beta` depuis `private/`. Le compte a été ouvert dans la
   fenêtre Flex (premier dépôt le 17 décembre 2025), Flex seul couvre tout son historique.
   Le solde USD cumulé de la dernière ligne datée du 1er septembre 2026 doit valoir
   le `TotalCashBalance` de TWS au centime, oracle de CLAUDE.md. Un écart est un bug.
3. Importer le relevé HTML 2025 de `alpha` sur un compte `alpha` : lignes importées sans
   erreur, ligne de règlement XSP de 191 USD présente, aucun oracle de niveau sur ce compte.

---

## 8. Décisions prises pendant le brainstorming

| Décision | Raison |
|---|---|
| Sources de données livrée dès maintenant en version fichier | Seul chemin utilisable de bout en bout ; les comptes rendus sont exigés par le spec fondateur |
| TS seulement, uv au sous-projet 2 | Chaque brique arrive avec le premier code qui la justifie |
| `accountId` = slug du libellé | URLs lisibles comme avant, identifiant IB jamais dans l'URL |
| `ledger` pur, Dexie dans `apps/web`, `useLiveQuery` | Un import met l'écran à jour sans invalidation ; TanStack réservé aux appels serveur à venir |
| Positions depuis Open Positions Flex, ledger en contrôle croisé | Décision du spec fondateur §13, reconfirmée |
| Un relevé remplace ses propres lignes sur sa période déclarée | Réimport idempotent, relevés qui se chevauchent sans doublon |
| Option Cash Settlement importé en `trade` `OPT` sans quantité | Le solde cumulé manquait chaque règlement ; rattachable au contrat par les journaux |
| Transfers non implémenté | Rare, aucun fichier réel n'en contient ; à faire quand un utilisateur en aura besoin |
