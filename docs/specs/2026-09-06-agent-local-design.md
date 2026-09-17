# Sous-projet 4 — Agent local, positions intraday, exécutions du jour

> Spec validé en brainstorming le 6 septembre 2026. Décline le spec fondateur
> `2026-09-03-architecture-design.md` (§2, §3.4, §6.2, §6.8, §8, §9, §11, §12), qui reste la
> référence pour tout ce qui n'est pas précisé ici. Les sous-projets 1 à 3 fixent les
> conventions de `ledger`, `ib-parsers`, de la base Dexie et de la synchro Flex que ce spec
> étend. Il amende le spec fondateur sur quatre points, listés au §12.

---

## 1. Périmètre

Livrer le palier 3 : un utilisateur qui fait tourner TWS sur sa machine installe un agent
local, renseigne un port par compte, et voit ses positions, son cash et ses exécutions du
jour dans les pages qui existent déjà, rafraîchis toutes les cinq minutes ou sur un bouton.

**Dans le périmètre :**

- `apps/tws-agent` : paquet Python `ib-tws-agent`, troisième membre du workspace uv,
  repris de `ib-bridge/main.py` de l'ancien dépôt. Cette reprise épuise l'ancien dépôt.
- `packages/ib-parsers` : troisième parseur, `parseAgentSnapshot`.
- `packages/ledger` : `planAgent`, la règle « n'écrit qu'après la borne Flex ».
- `apps/web` : module `agent/`, port TWS par compte, rafraîchissement périodique, bouton
  Actualiser sur Positions, Dashboard et Historique, carte « Agent local » dans Sources de
  données, page Aide, suppression de la page Aujourd'hui.
- Distribution : la roue Python construite dans l'image `web` et servie par le site.
- Mise à jour de `CLAUDE.md`, du spec fondateur et de `docs/points-reportes.md`.

**Hors périmètre :**

- Consulter les données live depuis un autre appareil que celui où tourne TWS (spec
  fondateur §13, relais par le serveur).
- Un TWS qui gère plusieurs comptes : l'agent rend la liste, le navigateur vérifie que le
  compte ouvert en fait partie, rien de plus.
- Exercices, assignations, dividendes du jour : TWS ne les rend pas comme des fills, ils
  arrivent par la synchro Flex du lendemain.
- La mise en ligne réelle sur le VPS, toujours en attente de l'utilisateur.
- Tout ce qui précède la publication du dépôt sur une forge (§12).

---

## 2. Les décisions structurantes

### 2.1 Il n'y a pas de page Aujourd'hui

Le spec fondateur prévoyait une page « Aujourd'hui » pour les exécutions du jour et les
positions intraday. Personne ne l'a jamais dessinée. Décision : **elle disparaît**, et les
trois pages existantes absorbent ses données.

- **Historique** montre les exécutions du jour comme n'importe quelle transaction : elles
  entrent dans le ledger en source `agent`, après la borne Flex.
- **Positions** et **Dashboard** lisent un snapshot de source `agent`, horodaté à la minute,
  qui remplace le snapshot Flex de la veille. Les positions intraday ne sont **pas**
  dérivées des transactions du jour : TWS donne le portefeuille courant, et dériver les
  positions de l'historique est ce que le spec fondateur §13 écarte comme fragile.

Le palier 3 devient : « idem, plus positions intraday et exécutions du jour ». La route
`/accounts/:id/today`, l'entrée de menu et la clé `nav.today` sont supprimées.

### 2.2 L'agent est une troisième source, symétrique de Flex

Rien de métier ne vit en Python. L'agent sérialise ce qu'`ib_async` lui donne, sans
conversion ; le parseur TypeScript fait toutes les conversions, au même endroit que celles
de Flex et du relevé HTML, et c'est lui qui est testé. `apps/web/src/agent/` reproduit la
structure de `flex/` : client, synchro, hook de déclenchement.

Un ordonnanceur unique fusionnant Flex et agent a été écarté : il rouvrirait
`useFlexAutoSync`, qui marche et qui est testé, pour un deuxième client seulement.

### 2.3 Le port TWS se configure dans le navigateur

Chaque compte IB a son TWS sur un port distinct. Le port est saisi dans la page Sources de
données, à côté du jeton Flex, stocké dans `AccountRecord.twsPort`, et envoyé à l'agent en
paramètre de requête. L'agent n'a **aucune connaissance des comptes**. Un port qui pointe
sur le mauvais TWS est détecté par le navigateur, qui compare le compte rendu par TWS à
l'`ibAccountId` du compte ouvert et refuse d'écrire.

> Amendement du 6 septembre 2026 (revue de branche finale) : la comparaison est une
> **égalité stricte** — `accounts` doit contenir exactement une entrée, celle du compte
> ouvert — et non une appartenance à la liste. `ib_async` fusionne les comptes d'un TWS qui
> en gère plusieurs (`portfolio("")`, `accountValues("")`, `fills()` rendent tout, sommé pour
> le cash) ; une appartenance laisserait passer précisément ce cas de fusion silencieuse. Voir
> §6.4.

### 2.4 L'origine autorisée vit dans un fichier de configuration, et la page Aide l'explique

L'agent ne répond qu'à l'origine de l'application. Cette origine n'entre pas dans le code :
la règle « aucun nom de domaine dans un fichier versionné » est **maintenue**, et prend tout
son sens le jour où le dépôt devient public. L'utilisateur la donne une fois par
`ib-tws-agent init --origin …`, qui écrit un fichier de configuration.

Pour que ce soit simple, une page **Aide** dans l'application affiche la procédure complète
avec les commandes prêtes à copier, construites depuis l'origine courante lue dans le
navigateur au moment de l'affichage.

### 2.5 Le site sert le paquet

Le dépôt sera publié sur une forge, mais un utilisateur invité n'a besoin ni de `git` ni du
code. L'image Docker `web` construit la roue Python de l'agent et la sert sous `/agent/`.
La version installée est celle du site utilisé. `uv tool install <url de la roue>` suffit.

---

## 3. `apps/tws-agent`

### 3.1 Paquet

Nom `ib-tws-agent`, `requires-python >= 3.14` comme le reste du workspace (`uv tool
install` télécharge l'interpréteur au besoin). Dépendances : `ib_async`, `fastapi`,
`uvicorn`, `platformdirs`. Un seul module d'environ 200 lignes, `ib_tws_agent/main.py`,
plus `ib_tws_agent/cli.py` pour les deux commandes. Point d'entrée `ib-tws-agent`.

### 3.2 Commandes et configuration

| Commande | Effet |
|---|---|
| `ib-tws-agent init --origin https://votre-site` | Écrit `config.toml` dans le dossier de configuration de l'utilisateur, affiche son chemin. Écrase un fichier existant. |
| `ib-tws-agent` | Lit `config.toml`, sert sur `127.0.0.1:<listen>`. |

Le dossier est `platformdirs.user_config_dir("ib-tws-agent")` : `~/.config/ib-tws-agent/`
sous Linux, `~/Library/Application Support/ib-tws-agent/` sous macOS,
`%APPDATA%\ib-tws-agent\` sous Windows. Contenu :

```toml
origins = ["https://votre-site"]
listen = 8100
```

Fichier absent ou illisible : l'agent s'arrête avec un message qui renvoie à la page Aide
du site. **Aucune origine n'est admise d'office**, pas même `localhost` : un développeur
ajoute `http://localhost:5173` à la liste à la main.

### 3.3 Deux endpoints

> Amendement du 2026-09-16 (sous-projet 19) : l'agent porte désormais quatre endpoints, pas
> deux. `POST /flex/send-request` et `POST /flex/get-statement` relaient le protocole Flex
> vers Interactive Brokers, à l'identique du proxy Django
> (`2026-09-16-relais-flex-agent-design.md` §3.1). `httpx` passe des dépendances de
> développement aux dépendances de production de `apps/tws-agent`.

Le rafraîchissement rapatrie positions et exécutions ensemble et TWS se reconnecte à chaque
appel (spec fondateur §3.4) : un endpoint unique fait **une** connexion par passage.

| Endpoint | TWS | Réponse |
|---|---|---|
| `GET /health` | jamais | `{ "version": "0.1.0" }`, la version lue par `importlib.metadata` |
| `GET /snapshot?port=7502` | une connexion, refermée | `{ accounts, fetchedAt, cashAvailable, positions, executions }` |

`/snapshot` se connecte à `127.0.0.1:<port>` en `clientId 0`, délai de cinq secondes, lit
`managedAccounts()`, `accountValues()`, `portfolio()` et `fills()`, se déconnecte dans un
`finally`, et répond. `portfolio()` plutôt que `positions()` : lui seul porte prix de
marché, valeur et P&L latent.

### 3.4 Données brutes, noms bruts

Chaque champ porte le nom de l'attribut `ib_async` d'où il vient, en camelCase, sans
conversion :

```json
{
  "accounts": ["U1234567"],
  "fetchedAt": "2026-09-06T13:02:11.482Z",
  "cashAvailable": 16284.37,
  "positions": [
    {
      "conId": 265598, "symbol": "AAPL", "localSymbol": "AAPL", "secType": "STK",
      "right": "", "strike": 0.0, "lastTradeDateOrContractMonth": "", "multiplier": "",
      "currency": "USD",
      "position": 100.0, "averageCost": 150.25,
      "marketPrice": 172.1, "marketValue": 17210.0, "unrealizedPNL": 2185.0
    }
  ],
  "executions": [
    {
      "execId": "0000e1a7.68bc1234.01.01", "time": "2026-09-06T14:31:02+00:00",
      "acctNumber": "U1234567", "side": "SLD", "shares": 1.0, "price": 2.35,
      "cumQty": 1.0, "avgPrice": 2.35, "orderRef": "",
      "contract": {
        "conId": 700000001, "symbol": "AAPL", "localSymbol": "AAPL  261218C00180000",
        "secType": "OPT", "right": "C", "strike": 180.0,
        "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD"
      },
      "commission": 1.05, "commissionCurrency": "USD"
    }
  ]
}
```

- `lastTradeDateOrContractMonth` reste `20261218`, `multiplier` reste une chaîne,
  `averageCost` d'une option reste **par contrat**, `commission` reste **positive** comme
  `CommissionReport.commission` la donne. Le parseur convertit tout cela (§4).
- `commission` et `commissionCurrency` sont `null` quand `fill.commissionReport.execId` est
  vide : IB envoie le rapport quelques instants après le fill.
- `time` est l'`isoformat()` du `datetime` UTC d'`ib_async`.
- **Seule exception** à la règle des données brutes : `cashAvailable` est l'extraction de
  `TotalCashBalance` USD copiée de l'ancienne passerelle (premier tag qui donne quelque
  chose parmi `TotalCashBalance`, `CashBalance`, `AvailableFunds`, lignes sans `modelCode`,
  sommées par compte), parce que transporter la liste entière des valeurs de compte
  n'apporterait rien. Elle rend **`null`**, jamais `0.0`, quand aucun tag ne donne rien.
  `TotalCashBalance` est le même chiffre que l'`endingCash` USD du Cash Report Flex et que
  l'oracle de réconciliation de l'historique.

### 3.5 Erreurs

| Cas | Réponse |
|---|---|
| `port` absent ou hors `1..65535` | 422, corps de validation FastAPI |
| Connexion TWS échouée ou délai dépassé | 503 `{ "code": "tws-unreachable", "detail": "<type>: <message>" }` |
| `Host` absent de `127.0.0.1`/`localhost` | 400, avant tout traitement (voir §3.6) |
| `/health` avec une origine absente ou non admise | Réponse normale **sans** en-tête `Access-Control-Allow-Origin` : c'est le navigateur qui refuse |
| `/snapshot` avec une origine absente ou non admise | 403 `{ "code": "origin-refused" }`, avant toute connexion TWS (voir §3.6) |

Rien d'autre. L'agent ne journalise que les erreurs, jamais les corps.

### 3.6 CORS, réseau privé, et hôte

> Amendement du 2026-09-16 (sous-projet 19) : `TWS_TOUCHING_PATHS` devient `ACTING_PATHS` et
> couvre `/snapshot` et les deux routes de relais Flex — les trois font agir l'agent, TWS ou
> IB. Le preflight autorise en plus `POST` (`Access-Control-Allow-Methods: GET, POST`) et
> l'en-tête `content-type` (`Access-Control-Allow-Headers: content-type`), nécessaires au
> corps JSON des deux routes Flex. Les loggers `httpx` et `httpcore` sont tenus au niveau
> `WARNING` à l'import de `flex.py`, pour que l'URL Flex — qui porte le jeton — ne fuie
> jamais dans les journaux de l'agent.

Middleware maison, pas `CORSMiddleware` : la liste des origines vient du fichier de
configuration et la réponse au preflight doit porter un en-tête que FastAPI ne connaît pas.

- `Access-Control-Allow-Origin: <origine>` uniquement si l'`Origin` reçue est dans la liste,
  `Vary: Origin`.
- Preflight `OPTIONS` : `Access-Control-Allow-Methods: GET`,
  `Access-Control-Allow-Private-Network: true`, `Access-Control-Max-Age: 600`.
- Aucun `Allow-Credentials`, aucun en-tête personnalisé.
- `/snapshot` refuse (403 `origin-refused`) une origine absente ou non admise **avant
  d'appeler TWS** : `/health` ne coûte rien et peut rester ouvert à toute origine, mais
  `/snapshot` agit (il ouvre une connexion `clientId 0`), et un `<img>` ou une page
  même-origine par piratage DNS n'envoient aucune `Origin` du tout — « présente et
  inconnue » ne suffit pas à s'en protéger, il faut « présente et admise ».

> Amendement du 6 septembre 2026 (revue de branche finale) : ce contrôle d'origine ne
> défend que les requêtes réellement cross-origin. Une page servie par un domaine dont le
> DNS résout vers `127.0.0.1` (« DNS rebinding ») est vue **même origine** par le
> navigateur, qui n'envoie alors aucun en-tête `Origin` — l'attaque contourne donc aussi le
> refus `/snapshot` ci-dessus si rien d'autre ne l'arrête. `TrustedHostMiddleware` de
> Starlette, monté pour s'exécuter en premier avec `allowed_hosts=["127.0.0.1", "localhost"]`,
> rejette (400) toute requête dont l'en-tête `Host` n'est pas l'un des deux — l'attaquant ne
> contrôle pas cet en-tête, contrairement au DNS. Les deux contrôles sont complémentaires,
> pas redondants : l'un ferme les requêtes cross-origin, l'autre ferme les requêtes
> même-origine frauduleuses.

Chrome demande de plus une permission à l'utilisateur la première fois qu'une page HTTPS
appelle `127.0.0.1`. La page Aide le dit (§8).

### 3.7 Tests, pytest sur `FakeIB`

`FakeIB` est repris du `conftest.py` de l'ancienne passerelle : un double typé au canard,
jamais une sous-classe d'`ib_async.IB`, injecté par `Depends(get_ib_factory)`.

| Ce qui est vérifié |
|---|
| Une position action et une option sont sérialisées avec tous les champs du §3.4, sans conversion |
| Un fill avec rapport de commission rend `commission` positive ; sans rapport, `null` |
| `cashAvailable` : premier tag qui donne, lignes `modelCode` ignorées, `null` sans tag |
| `/health` ne construit jamais d'`IB` |
| `/snapshot` se déconnecte même quand `portfolio()` lève |
| TWS éteint : 503 `tws-unreachable`, connexion refermée |
| `port` manquant ou `70000` : 422 |
| Origine admise : `Allow-Origin` égal à l'origine ; origine inconnue : aucun `Allow-Origin` ; preflight : `Allow-Private-Network` |
| `/snapshot` sans origine ou avec une origine inconnue : 403 `origin-refused`, `IB` jamais construit ; `/health` reste ouvert dans les deux cas |
| `Host` différent de `127.0.0.1`/`localhost` : 400 sur `/health` et `/snapshot`, `IB` jamais construit pour ce dernier |
| Configuration absente : sortie non nulle et message |
| `init` écrit le fichier attendu au chemin de `platformdirs`, origine mise en minuscules à l'écriture et à la lecture |

`pnpm test:agent` (`uv run --project apps/tws-agent pytest apps/tws-agent`) les exécute.
Ils n'entrent pas dans `pnpm check`, qui ne lance jamais de Python.

---

## 4. `packages/ib-parsers` : `parseAgentSnapshot`

`parseAgentSnapshot(payload: unknown, accountId: string)` rend
`{ accounts, fetchedAt, cashAvailable, positions, transactions, issues }`. Une charge
utile qui n'a pas la forme du §3.4 est rejetée par `NormalizationError`, avec le chemin du
champ fautif.

### 4.1 Position

> Amendement du 6 septembre 2026 (revue de branche finale) : la version initiale de cette
> section justifiait `describeAgentContract` par « la fonction commune à Flex, pour qu'une
> même jambe s'affiche pareil quelle que soit la source ». C'est faux : `PositionsPage`
> affiche la description que rend `@ib/coverage` (une fonction homonyme, signature et sortie
> différentes), et `HistoryPage` affiche `symbol`, jamais ce champ. Rien dans l'interface ne
> montre la chaîne que produit `describeAgentContract`, sauf le `detail` d'une anomalie
> `multiplier-missing`. Sa vraie raison d'être : `Position.description` est un champ
> obligatoire, qui doit porter quelque chose de sensé même si rien ne l'affiche aujourd'hui.

| Champ `Position` | Source | Conversion |
|---|---|---|
| `symbol` | `symbol` | tel quel : `ib_async` donne déjà le sous-jacent pour une option, l'OCC est dans `localSymbol` |
| `secType`, `right`, `currency` | idem | tels quels |
| `strike` | `strike` | `0` devient `null` |
| `expiry` | `lastTradeDateOrContractMonth` | `YYYYMMDD` devient `YYYY-MM-DD`, `""` devient `null` |
| `multiplier` | `multiplier` | chaîne vers nombre, `""` devient `null` |
| `quantity` | `position` | tel quel, signé |
| `avgPrice` | `averageCost` | **divisé par le multiplicateur** pour `OPT` et `FOP` : TWS le donne par contrat, `Position` l'exige par unité. Multiplicateur `null` sur une option : `avgPrice` `null` et anomalie `multiplier-missing` |
| `marketPrice`, `marketValue`, `unrealizedPnl` | `marketPrice`, `marketValue`, `unrealizedPNL` | tels quels |
| `conid` | `conId` | en chaîne |
| `description` | | `describeAgentContract`, propre à l'agent (voir l'amendement ci-dessus) |

### 4.2 Exécution → transaction

| Champ `Transaction` | Valeur |
|---|---|
| `accountId` | l'argument |
| `externalId` | `agent:{execId}` |
| `source`, `kind` | `agent`, `trade` |
| `symbol`, `secType`, `right`, `strike`, `expiry` | comme §4.1, depuis `contract` |
| `quantity` | `shares` positif pour `BOT`, négatif pour `SLD` |
| `price` | `price` |
| `amount` | `-quantity × price × (multiplier ?? 1)` : produit brut hors commission, même convention que les Trades Flex |
| `commission` | `-commission` quand présente, **`null`** sinon, jamais `0` |
| `currency` | `contract.currency` |
| `when` | `time`, normalisé en `…Z` |
| `description` | `describeAgentContract` |

Conversion de devises : pour un contrat `CASH`, `symbol` vaut `EUR` et `localSymbol`
`EUR.USD`. Le parseur pose `symbol = localSymbol` dans ce cas, pour que la règle
`^[A-Z]{3}\.[A-Z]{3}$` du ledger (spec fondateur §3.5) reconnaisse la paire.

Un `execId` absent ou vide rejette la charge utile : c'est la clé de déduplication.

### 4.3 Tests

Fixtures JSON construites à la main dans `packages/ib-parsers/fixtures/agent/`, jamais des
données réelles : une position action, une option avec `averageCost` par contrat, une
option sans multiplicateur, un fill `BOT` action, un fill `SLD` option, un fill sans
commission, un fill `CASH`, une charge utile sans `execId`, une charge utile qui n'est pas
un objet.

---

## 5. `packages/ledger`

### 5.1 `planAgent`

`planImport` accepte la source `agent`, ce qui lève l'`UnsupportedSourceError` de la dette.
`planAgent(existing, incoming)` :

- cherche `max(when)` des lignes `flex` existantes ;
- upserte les lignes du lot dont `when` est **strictement** postérieur, compte les autres
  en `skipped` ;
- sans aucune ligne Flex, upserte tout ;
- `delete` et `dropped` sont toujours vides : **l'agent ne supprime jamais rien**. Un TWS
  redémarré en cours de journée ne rend plus les fills du matin, et les effacer perdrait
  de l'information vraie. La synchro Flex suivante remplace la journée entière (spec
  fondateur §6.2, déjà implémenté dans `planFlex`, dont la borne haute reste un instant
  précis pour cette raison).

L'upsert par `externalId` rend le rafraîchissement idempotent : deux passages identiques
donnent la même base, et un passage qui apporte enfin la commission d'un fill met la ligne
à jour.

### 5.2 Tests

| Ce qui est vérifié |
|---|
| Une ligne dont `when` égale le `max` Flex est `skipped` ; une ligne une milliseconde après est écrite |
| Sans ligne Flex, tout est écrit |
| Deux plans successifs du même lot donnent le même résultat |
| `delete` et `dropped` restent vides même quand une ligne `agent` existante n'est pas dans le lot |
| `planFlex` supprime les lignes `agent` tombées dans sa plage (déjà testé, à conserver) |

---

## 6. `apps/web` : schéma et synchro

### 6.1 Schéma Dexie

Aucune nouvelle version : les champs ajoutés ne sont pas indexés.

```ts
interface AccountRecord {
  // …
  /** Port de l'API TWS de ce compte sur la machine de l'utilisateur. Absent : agent jamais appelé. */
  twsPort?: number;
  lastAgentSyncAt?: string;
  lastAgentSyncStatus?: { at: string; ok: boolean; code?: AgentSyncCode };
}

interface SnapshotRecord {
  source: "flex" | "agent";
  /** Flex : YYYY-MM-DD de la clôture. Agent : instant ISO complet du passage. */
  asOf: string;
  // …
}

interface ImportRecord {
  /** L'agent n'écrit jamais d'ImportRecord : le type le dit. */
  source: Exclude<TransactionSource, "agent">;
  // …
}
```

`AgentSyncCode` : `agent-unreachable`, `tws-unreachable`, `agent-error`,
`account-mismatch`, `parse-error`.

### 6.2 Règle de remplacement du snapshot

`shouldReplaceSnapshot(current, incoming)` :

- `incoming.source === "agent"` : **toujours** ; il est vivant par définition ;
- sinon : `incoming.asOf >= dayOf(current.asOf)`, où `dayOf` prend les dix premiers
  caractères.

Ainsi la synchro Flex du matin, à la clôture de la veille, remplace le snapshot agent de la
veille ; le premier passage de l'agent la remplace à son tour. `importFile.ts` et la synchro
Flex appellent cette fonction à la place de leur comparaison `asOf >=` actuelle.

### 6.3 `agent/client.ts`

- `AGENT_URL = "http://127.0.0.1:8100"`, une constante : ce n'est pas un nom de domaine.
- `probeAgent()` : `GET /health`, délai deux secondes, rend `{ version }` ou `null`.
- `fetchSnapshot(port)` : `GET /snapshot?port=`, délai quinze secondes, rend la charge
  utile brute, ou un échec `{ code: "agent-unreachable" | "tws-unreachable" | "agent-error" }`.

### 6.4 `agent/sync.ts`

`syncAgent(db, account)` :

1. `fetchSnapshot(account.twsPort)`, puis `parseAgentSnapshot` ; une `NormalizationError`
   donne `parse-error`.
2. `accounts` différent de `[account.ibAccountId]` exactement (une égalité, pas une
   appartenance : un TWS qui gère plusieurs comptes rend leurs données fusionnées, jamais
   distinguables après coup) : `account-mismatch`, rien n'est écrit.
3. Une seule transaction Dexie : `planAgent` sur les lignes existantes du compte et upsert,
   remplacement du snapshot (`source: "agent"`, `asOf: fetchedAt`, `importedAt: now`),
   `lastAgentSyncAt` et `lastAgentSyncStatus` sur le compte.
4. Tout échec écrit seulement `lastAgentSyncStatus`.

Pas d'`ImportRecord` : un passage toutes les cinq minutes noierait la table et la page
Sources de données.

Le verrou d'import (`db/importLock.ts`) devient **scopé par compte** : Flex et agent d'un
même compte se sérialisent, deux comptes ne s'attendent plus. C'est ce que la dette
demandait pour ce moment.

### 6.5 `agent/useAgentSync.ts`

Même forme que `useFlexAutoSync` : verrou par compte au niveau du module, `state` et `run`
exposés, `useSyncExternalStore`. S'y ajoute une **présence** de l'agent, au niveau du
module aussi : `{ status: "unknown" | "absent" | "present", version? }`, partagée par tous
les appelants de l'onglet.

Cadence, constantes exportées pour les tests :

| Constante | Valeur |
|---|---|
| `AGENT_POLL_MS` | 5 minutes |
| `AGENT_PROBE_TIMEOUT_MS` | 2 secondes |
| `AGENT_FETCH_TIMEOUT_MS` | 15 secondes |

Comportement, monté par `AppLayout` pour le compte ouvert :

- À l'ouverture du compte : sonde. Présent et `twsPort` renseigné : passage immédiat.
- Puis un passage toutes les cinq minutes **tant que l'onglet est visible**
  (`document.visibilityState`). Onglet redevenu visible après plus de cinq minutes : passage
  immédiat.
- Agent absent : nouvelle sonde à chaque échéance, pour qu'un agent lancé après l'ouverture
  soit détecté sans rechargement.
- `twsPort` absent : ni sonde ni passage, la page Sources de données le dit.
- Le bouton Actualiser appelle `run`, qui remet le compteur à zéro.
- Changement de compte : le compteur repart, l'ancien compte n'est plus interrogé.

Un échec n'est jamais bloquant : la dernière copie connue reste affichée (spec fondateur
§6.8), la cause se lit dans Sources de données et dans un badge.

---

## 7. Pages

### 7.1 `SnapshotStatus`

Composant partagé par Positions, Dashboard et Historique : le badge d'horodatage existant,
et à sa droite un bouton Actualiser, icône seule (`RefreshCw`), `variant="outline"`,
`size="icon-sm"`, en rotation pendant le passage, **visible uniquement** quand l'agent est
présent et le port renseigné. Historique ne montre pas le badge d'horodatage.

| État | Badge |
|---|---|
| Snapshot Flex | « au 2026-09-05 », `warning`, comme aujourd'hui |
| Snapshot agent | « en direct, 15:02 », `success` |
| `lastAgentSyncStatus.ok === false` | second badge `secondary` : « TWS injoignable », « compte différent », « agent absent », « réponse illisible », « erreur de l'agent » |

Le contenu des pages ne change pas : elles lisent le même snapshot et le même ledger. Les
lignes de l'agent dans Historique n'ont **pas** de marque distinctive, comme les lignes de
relevé HTML.

### 7.2 Sources de données : carte « Agent local »

Entre Flex Query et l'import de fichiers. Champ « Port TWS » numérique avec Enregistrer,
puis trois lignes d'état :

- agent détecté avec sa version, ou absent avec un lien vers l'Aide ;
- dernier passage : heure, ou cause d'échec ;
- bouton Actualiser, grisé sans agent ou sans port.

Un port hors `1..65535` est refusé à la saisie. Effacer le champ efface `twsPort`.

### 7.3 Suppression

`router.tsx` perd la route `today`, `navigation.ts` l'entrée, `fr.json` et `en.json` la clé
`nav.today`. `PlaceholderPage` reste pour les trois journaux.

---

## 8. Page Aide

Route `/help`, hors compte, sous `AppLayout` comme `/settings`, dernière entrée de la
section Configuration, icône `CircleHelp`. Cartes et police des autres pages. Sept blocs,
dans les deux langues, chaque commande dans un bloc de code :

1. **Ce que fait l'agent** : lit TWS sur cette machine, ne stocke rien, ne parle qu'à ce
   site ; les données TWS ne quittent jamais la machine.
2. **Installer `uv`** : une commande par système, depuis la documentation d'Astral.
3. **Installer l'agent** : `uv tool install <origine>/agent/<filename>`, où `<origine>` est
   `window.location.origin` et `<filename>` vient de `GET <origine>/agent/index.json`.
   Index absent (développement) : le bloc dit que ce serveur ne sert pas le paquet.
4. **Configurer** : `ib-tws-agent init --origin <origine>`, puis `ib-tws-agent`.
5. **Réglages API de TWS** : Enable ActiveX and Socket Clients, port par compte,
   `127.0.0.1` dans Trusted IPs, Read-Only API acceptée, un TWS par compte.
6. **La permission de Chrome** : accepter la première demande d'accès au réseau local.
7. **Renseigner le port** dans Sources de données, avec le lien vers la page du compte
   courant s'il y en a un.

Aucun nom de domaine, aucune version, aucun nom de fichier dans le code de la page.

---

## 9. Distribution

### 9.1 Image `web`

Une étape supplémentaire dans `apps/web/Dockerfile` :

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS agent
WORKDIR /repo
COPY apps/tws-agent ./apps/tws-agent
RUN uv build --wheel --out-dir /out apps/tws-agent \
 && python apps/tws-agent/scripts/write_index.py /out
```

`write_index.py` écrit `/out/index.json` : `{ "version": "0.1.0", "filename":
"ib_tws_agent-0.1.0-py3-none-any.whl" }`. L'étape nginx copie `/out` dans
`/usr/share/nginx/html/agent/`. `nginx.conf` sert `/agent/` avec `Cache-Control:
no-cache` : le nom de la roue change à chaque version, l'index doit rester frais. Rien à
changer dans Compose ni Traefik : `/agent/` est déjà routé vers `web`.

### 9.2 Version

Une seule source, `apps/tws-agent/pyproject.toml`. `/health` la lit par
`importlib.metadata`, `index.json` la lit à la construction, la page Aide la lit dans
`index.json`.

### 9.3 Développement

`pnpm build:agent` produit la même roue et le même index dans `apps/web/public/agent/`,
dossier ignoré par git, pour vérifier la page Aide de bout en bout avec `pnpm dev`.

### 9.4 Sans TWS sur cette machine

Le pilote `.claude/skills/run-frontend/driver.mjs` gagne `--agent` : il intercepte
`http://127.0.0.1:8100/**` avec `page.route` et répond une fixture JSON (`/health` et
`/snapshot`). Les captures montrent l'état « en direct » sans rien lancer.

---

## 10. Tests

### 10.1 Vitest

`fake-indexeddb` semé, jamais de hook moqué ; `fetch` remplacé pour `client.ts` seulement.

| Couche | Ce qui est vérifié |
|---|---|
| `ib-parsers` | Les neuf fixtures du §4.3 |
| `ledger` | Le tableau du §5.2 |
| `client.ts` | Délai de sonde, `null` sur rejet, les trois codes d'échec selon le statut HTTP |
| `sync.ts` | `account-mismatch` n'écrit rien ; un snapshot agent remplace un Flex ; un Flex du jour remplace un agent de la veille ; un Flex de la veille ne remplace pas un agent du jour ; `lastAgentSyncStatus` dans les deux issues ; aucun `ImportRecord` |
| `importLock.ts` | Deux comptes ne s'attendent plus ; Flex et agent d'un même compte s'attendent |
| `useAgentSync` | Horloge simulée : sonde à l'ouverture, passage immédiat avec port, aucun sans port, cadence, onglet caché sans passage, retour visible après six minutes déclenche, `run` remet le compteur, changement de compte |
| Pages | Bouton absent sans agent ; badges selon la source et l'état ; carte Agent : port refusé hors plage, effacement ; Aide : commande construite depuis l'origine et l'index, état sans index ; `/today` ne mène nulle part, `/help` existe et est titré |

### 10.2 Playwright

Un scénario qui intercepte l'agent : un compte semé avec un snapshot Flex passe en « en
direct » sur Positions, retrouve l'exécution du jour dans Historique, et montre la cause
d'échec quand l'interception répond 503.

### 10.3 Validation manuelle contre un vrai TWS

Impossible depuis cette machine. À votre charge, une fois l'agent installé à côté d'un TWS
dont l'API est activée :

```bash
curl -i http://127.0.0.1:8100/health
curl -i -H "Origin: <l'origine de votre config.toml>" "http://127.0.0.1:8100/snapshot?port=7502"
curl -i -H "Origin: https://autre-site" http://127.0.0.1:8100/health   # sans Allow-Origin
```

> Amendement du 6 septembre 2026 (revue de branche finale) : `/snapshot` refuse une origine
> absente ou non admise (403 `origin-refused`) avant toute connexion TWS, contrairement à
> `/health` qui reste ouvert à toute origine. Voir §3.5 et §3.6.

Puis, dans l'application : port renseigné, badge « en direct », une exécution du lendemain
remplacée par sa ligne Flex après la synchro du matin.

---

## 11. Paliers de livraison

1. `apps/tws-agent` complet et testé, `pnpm test:agent`.
2. `parseAgentSnapshot` et `planAgent`.
3. Schéma, `client.ts`, `sync.ts`, verrou par compte, règle de remplacement.
4. `useAgentSync`, `SnapshotStatus`, carte Agent, suppression d'Aujourd'hui.
5. Page Aide, roue dans l'image, `pnpm build:agent`, `--agent` du pilote.
6. Playwright, documents, dette.

Chaque palier laisse `pnpm check` vert.

---

## 12. Documents amendés et dette

### 12.1 Spec fondateur

Quatre notes datées, en tête des sections concernées, renvoyant ici, sans réécrire le
texte d'origine :

| Section | Amendement |
|---|---|
| §2 | Le palier 3 n'a plus de page Aujourd'hui ; ses données vont dans Historique, Positions et Dashboard |
| §8 | Deux endpoints (`/health`, `/snapshot?port=`) au lieu de trois ; le port TWS est un paramètre de requête, pas une configuration ; fichier de configuration limité aux origines et au port d'écoute ; paquet servi par le site |
| §9 | La ligne Aujourd'hui disparaît ; une ligne Aide, `/help`, s'ajoute |
| §12 | Statut du sous-projet 4 |

### 12.2 `CLAUDE.md`

- La table « reste à copier » et la section « Dépôt de référence » entière disparaissent :
  `ib-bridge/main.py` repris, l'ancien dépôt n'a plus de dette envers nous. La quarantaine
  reste, en une phrase, parce que l'ancien dépôt existe toujours sur le disque.
- La ligne « Aujourd'hui, Journaux, Portefeuilles » de l'état de l'ancienne application ne
  mentionne plus Aujourd'hui.
- Sous-projet 4 : statut et nouveau titre, « Agent local, positions intraday, exécutions du
  jour ».
- Règles qui mordent : « le nom de domaine » précise que l'agent le reçoit par son fichier
  de configuration et que la page Aide le lit dans le navigateur ; « l'agent n'écrit qu'après
  la borne Flex et ne supprime jamais » ; « un snapshot agent remplace toujours ».

### 12.3 `docs/points-reportes.md`

Nouvelle rubrique **en tête**, « Avant la publication du dépôt sur une forge », qui
regroupe, sans les traiter :

- l'identifiant de compte IB réel dans `CLAUDE.md`, les specs et l'historique git ;
- les fixtures anonymisées qui divulguent l'ordre et les magnitudes réelles ;
- l'intégration continue, écartée faute de forge, à rouvrir ;
- la règle du nom de domaine, qui devient une protection réelle.

Dettes fermées par ce sous-projet : `ImportRecord.source` (type resserré), `planImport`
refuse `agent`, `SnapshotRecord.source`, verrou d'import global. Reste ouverte, inchangée :
`SourcesPage.handleFile`, que l'agent n'emprunte pas.

Reportés par ce sous-projet :

- consulter les données live depuis un autre appareil ;
- un TWS gérant plusieurs comptes ;
- l'agent en service système (lancement automatique au démarrage de la machine).

---

## 13. Décisions prises pendant le brainstorming

| Décision | Raison |
|---|---|
| **Pas de page Aujourd'hui** | Jamais dessinée ; les trois pages existantes lisent le même ledger et le même snapshot, elles deviennent intraday sans rien recalculer |
| Les positions intraday viennent du **portefeuille TWS**, pas des transactions du jour | Spec fondateur §13 : dériver les positions de l'historique est fragile |
| **Port TWS dans le navigateur**, par compte | Plus simple à configurer pour l'utilisateur ; l'agent ne connaît aucun compte ; le contrôle du compte rendu par TWS protège d'un port mal renseigné |
| **Fichier de configuration** pour les origines, écrit par `init` | Aucun nom de domaine dans le code, règle maintenue et renforcée par la publication à venir ; la page Aide rend la saisie triviale |
| **Page Aide** dans l'application | Les instructions portent l'origine courante et le nom exact de la roue sans qu'aucun des deux ne soit dans le code |
| **Roue servie par le site** | Ni `git` ni le code chez l'utilisateur ; version alignée sur le site ; rien ne sort du VPS. `git+https` exigerait `git` sous Windows et installerait `main` ; PyPI rendrait l'agent public sous le nom du projet |
| **Un seul endpoint `/snapshot`** | Une connexion TWS par passage au lieu de deux, TWS se reconnectant à chaque appel |
| **Rafraîchissement périodique, cinq minutes, onglet visible**, plus bouton | Demande de l'utilisateur ; l'onglet caché n'ouvre pas de connexions pour rien |
| **Symétrique de Flex**, métier en TypeScript seulement | §8 « données brutes » ; deux langages connaissant le modèle de transaction est la dette du calendrier de synchro, déjà payée une fois |
| **Aucun `ImportRecord`** pour l'agent | Un passage toutes les cinq minutes noierait la table et la page Sources de données |
| **L'agent ne supprime jamais** | Un TWS redémarré ne rend plus les fills du matin ; Flex nettoie le lendemain |
| **Un snapshot agent remplace toujours** ; un fichier remplace si sa date atteint le jour du courant | Seule règle qui fait alterner correctement Flex du matin et agent de la journée |
| **Pas de marque « agent »** sur les lignes d'Historique | Les lignes HTML n'en ont pas non plus ; Flex les remplace sans bruit |
| Middleware CORS maison | `Access-Control-Allow-Private-Network` est inconnu de `CORSMiddleware` |
