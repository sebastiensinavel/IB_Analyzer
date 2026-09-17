# Sous-projet 19 — L'agent local relaie Flex

Statut : implémenté (2026-09-16).

Aujourd'hui la synchro Flex passe par le proxy Django (spec fondateur §7.4) : le jeton traverse
le serveur, sans y être journalisé ni conservé, et la synchro exige une session. L'agent local
(`apps/tws-agent`) tourne déjà sur la machine de l'utilisateur, répond à l'origine du site avec
CORS et Private Network Access, et peut appeler IB lui-même. Ce sous-projet lui fait relayer les
deux étapes du protocole Flex, et laisse l'utilisateur choisir, par compte, si le serveur peut
prendre le relais.

---

## 1. Périmètre

**Critère de réussite :** avec l'agent démarré et un compte en mode « agent local seulement »,
une synchro Flex aboutit sans session et sans qu'aucune requête n'atteigne `apps/api` ; la carte
Synchronisation dit « via l'agent local ». Agent arrêté, le même compte ne synchronise pas et la
carte explique pourquoi. En mode « agent local et serveur », agent arrêté et session ouverte, la
synchro passe par le serveur comme aujourd'hui.

Dans le périmètre :

1. deux endpoints de relais Flex dans l'agent (§3) ;
2. un réglage par compte, `flexRelay`, et le choix du relais à chaque synchro (§4) ;
3. la carte Flex Query et la carte Synchronisation de la page Sources de données (§5) ;
4. la page Aide, qui dit que l'agent parle aussi à Interactive Brokers (§5.3) ;
5. les amendements des specs et de `CLAUDE.md` (§7).

Hors périmètre : le proxy Django ne change pas ; `flex/sync.ts` (boucle, délais, codes) ne change
pas ; aucune compatibilité avec un agent installé avant ce sous-projet (un seul utilisateur, qui
met son agent à jour).

---

## 2. Décisions structurantes

### 2.1 L'agent reprend les deux endpoints du proxy, à l'identique

Même corps JSON, mêmes réponses que `apps/api/ib/api.py` : le XML brut d'IB en 200 (réponses
`Fail` comprises), `flex-timeout` en 504, `flex-unreachable` en 502. Le navigateur ne connaît
qu'un contrat de relais et deux adresses ; `sync.ts` ne voit aucune différence.

Écartés :

- **l'agent fait toute la synchro en un appel** (envoi, attente, relevé) : la boucle d'attente
  existerait en Python et en TS, et une requête HTTP durerait plus d'une minute ;
- **un relais générique vers une URL passée en paramètre** : un relais ouvert sur la machine de
  l'utilisateur. L'URL d'IB reste codée en dur.

### 2.2 Deux modes, « agent seul » par défaut

`AccountRecord.flexRelay?: "agent" | "agent-and-server"`. **Absent vaut `"agent"`**, pour les
comptes existants comme pour les nouveaux : ne rien faire transiter par le serveur est le
comportement par défaut, l'ouvrir est un geste explicite. Conséquence assumée : un compte
existant ne synchronise plus par le serveur tant que l'utilisateur ne choisit pas « agent local
et serveur ».

Il n'existe pas de mode « serveur seul » : quand l'agent est là, il n'y a aucune raison de faire
transiter le jeton par le serveur.

### 2.3 L'agent d'abord, choisi au début de chaque synchro

En mode `agent-and-server`, l'agent relaie s'il répond au ping ; sinon, et seulement avec une
session ouverte, le serveur relaie. Pas de repli sur le serveur quand l'agent est présent mais
que son appel échoue : un échec est un échec, affiché comme tel.

Le relais est choisi une fois, au début de la synchro, et garde la main jusqu'à la fin.

### 2.4 Pas de limitation de débit dans l'agent

Le 429 de Django protège un serveur partagé entre utilisateurs. L'agent n'a qu'un utilisateur ;
le calendrier de `sync.ts` respecte déjà 1 requête par seconde et 10 par minute, et le code IB
1018 (« trop de requêtes ») est déjà géré par la boucle, qui attend 10 s.

### 2.5 Le relais ne dépend pas de TWS

Relayer Flex n'ouvre aucune connexion TWS : ni port TWS requis, ni TWS démarré. Un compte avec
des identifiants Flex et sans port sonde quand même l'agent.

---

## 3. `apps/tws-agent`

### 3.1 Endpoints

Nouveau module `ib_tws_agent/flex.py`, jumeau de `apps/api/ib/flex.py` : `FLEX_BASE`,
`FLEX_VERSION = "3"`, délai 30 s (connexion 10 s), `call_flex(endpoint, params)` qui rend
`(bytes, content_type)` ou lève `FlexTimeout` / `FlexUnreachable`. Le corps de la réponse d'IB
n'est jamais lu, parsé ni journalisé. Client `httpx.AsyncClient` : l'agent est asynchrone.

Dans `create_app` :

| Méthode et chemin | Corps | Appel IB |
|---|---|---|
| `POST /flex/send-request` | `{"token": str, "queryId": str}` | `SendRequest?t=…&q=…&v=3` |
| `POST /flex/get-statement` | `{"token": str, "referenceCode": str}` | `GetStatement?t=…&q=…&v=3` |

Réponses :

- 200 : les octets d'IB, avec le `content-type` d'IB (défaut `application/xml`) ;
- 504 `{"code": "flex-timeout", "detail": …}` ;
- 502 `{"code": "flex-unreachable", "detail": …}` ;
- 422 : corps invalide (champ manquant, vide ou non chaîne), validation Pydantic de FastAPI.

Chaînes vides refusées (`min_length=1`). Les schémas Ninja `SendRequestIn` et
`GetStatementIn` les acceptent et laissent IB répondre `Fail` ; l'écart est délibéré et sans
effet, le navigateur n'envoie jamais de chaîne vide (`syncAccount` sort sans identifiants).

**Le jeton ne figure jamais dans une URL de l'agent** : le journal d'accès d'uvicorn écrit la
query string, pas le corps. Aucun `print`, aucun `logging` dans le chemin du relais. L'URL vers
IB porte le jeton, comme côté Django : c'est le protocole d'IB. Or `httpx` journalise cette URL
complète au niveau INFO et `httpcore` la répète en DEBUG : `flex.py` place les loggers `httpx` et
`httpcore` au niveau `WARNING` à l'import, comme `LOGGING` le fait dans
`apps/api/config/settings.py`, quel que soit le niveau choisi pour uvicorn.

`httpx` passe des dépendances de développement aux dépendances de production dans
`apps/tws-agent/pyproject.toml`. La description du paquet (« ne parle qu'au site ») devient
« ne parle qu'au site et à Interactive Brokers ».

### 3.2 Origine et preflight

`cors.py` :

- `TWS_TOUCHING_PATHS` devient `ACTING_PATHS = {"/snapshot", "/flex/send-request",
  "/flex/get-statement"}` : ces chemins font agir l'agent (TWS ou IB) et les deux derniers
  transportent un jeton ; une origine absente ou non admise reçoit 403 `origin-refused` avant
  le gestionnaire.
- Preflight : `Access-Control-Allow-Methods: GET, POST`,
  `Access-Control-Allow-Headers: content-type`, en plus des en-têtes actuels. Un `POST` en
  `application/json` déclenche toujours un preflight.
- `TrustedHostMiddleware` ne change pas et couvre les nouveaux chemins.

### 3.3 Tests (pytest, `pnpm test:agent`)

`call_flex` est remplacé par une dépendance FastAPI injectable (même motif que
`get_ib_factory`), jamais d'appel réseau réel.

- 200 : octets et `content-type` rendus tels quels, réponse `Fail` d'IB comprise ;
- paramètres transmis à IB : `t`, `q`, `v=3`, bon endpoint pour chaque chemin ;
- 504 sur `FlexTimeout`, 502 sur `FlexUnreachable`, corps exacts ;
- 422 sur corps incomplet ou chaîne vide ;
- 403 `origin-refused` sans `Origin` et avec une origine inconnue, sans appel à IB ;
- preflight admis : `POST` et `content-type` autorisés ; preflight inconnu : aucun `Allow-*` ;
- aucun jeton dans les journaux : `caplog` au niveau `DEBUG` sur le logger racine, requête passée
  par un vrai `httpx.AsyncClient` sur `MockTransport` pour que `httpx` et `httpcore` émettent, jumeau
  de `apps/api/tests/test_flex_no_logging.py` ;
- `flex.py` : `httpx.MockTransport` pour le délai dépassé et l'erreur réseau.

---

## 4. `apps/web` : réglage et choix du relais

### 4.1 Schéma

`AccountRecord` gagne :

```ts
/** Who may relay this account's Flex calls. Absent: "agent". */
flexRelay?: "agent" | "agent-and-server";
```

et `lastFlexSyncStatus` gagne `relay?: "agent" | "server"`, écrit à chaque issue `ok` ou
`failed`. Aucun index, donc **aucune version Dexie**.

`db/accounts.ts` : `setFlexRelay(db, accountId, relay)`, qui écrit la valeur telle quelle (les
deux valeurs sont stockées explicitement une fois choisies). `clearFlexCredentials` ne touche pas
`flexRelay`.

### 4.2 `flex/relay.ts` : le choix, fonction pure

```ts
export type FlexRelayMode = "agent" | "agent-and-server";
export type FlexRelayChoice =
  | { relay: "agent" | "server" }
  | { relay: null; reason: "agent-absent" | "needs-agent-or-account" | "server-unreachable" | "session-loading" };

export function pickFlexRelay(
  mode: FlexRelayMode,
  agentPresent: boolean,
  session: SessionState["status"],
): FlexRelayChoice;
```

- agent présent → `agent`, quel que soit le mode ;
- mode `agent`, agent absent → `agent-absent` ;
- mode `agent-and-server`, agent absent : session `authenticated` → `server` ; `anonymous` →
  `needs-agent-or-account` ; `unreachable` → `server-unreachable` ; `loading` →
  `session-loading`.

`flexRelayMode(account)` rend `account.flexRelay ?? "agent"` : la seule lecture du défaut.

### 4.3 `flex/proxy.ts`

`sendRequest` et `getStatement` prennent le relais en premier argument :
`sendRequest(relay, { token, queryId })`.

- **`server`** : inchangé — `${window.location.origin}/api/ib/flex/…`, `credentials:
  "same-origin"`, CSRF ; 401/403 → `unauthenticated`, 429 → `rate-limited` avec
  `retryAfterMs`, 504 → `flex-timeout`, autre non-OK → `flex-unreachable`, exception →
  `network`.
- **`agent`** : `${AGENT_URL}/flex/…` (`agent/client.ts`), `credentials: "omit"`, aucun CSRF,
  `content-type: application/json` ; exception réseau → `agent-unreachable`, 403 →
  `agent-origin-refused`, 504 → `flex-timeout`, autre non-OK → `flex-unreachable`. Pas de
  délai imposé côté navigateur au-delà de celui de l'agent (30 s vers IB).

`agent-origin-refused` est défensif : il ne sert qu'à un appelant hors navigateur. Le 403 de
l'agent ne porte aucun en-tête CORS, donc un navigateur rejette le `fetch` (`agent-unreachable`),
et `/health` refusé de la même façon marque déjà l'agent absent : une origine qui manque à la
configuration de l'agent se voit dans le navigateur comme un agent absent (état 2 du §5.2).

`ProxyErrorCode` gagne `agent-unreachable` et `agent-origin-refused`. `sync.ts` ne change pas
de forme : `FlexSyncDeps` gagne un champ `relay: FlexRelay`, pas un argument séparé de
`syncAccount`, qui garde sa signature `(deps, account)`. `useFlexAutoSync` lui passe des
fonctions déjà liées au relais, et `record` écrit `deps.relay` dans `lastFlexSyncStatus` à
chaque issue `ok` ou `failed` — seul ajout à `sync.ts`, sans effet sur la boucle.

### 4.4 `flex/useFlexAutoSync.ts`

`run()` :

1. verrou par compte, inchangé ;
2. lit le compte ; sans identifiants, rien ;
3. `refreshPresence()` (ping `/health`, 2 s) — un ping frais à chaque synchro ;
4. `pickFlexRelay(flexRelayMode(account), presence === "present", session.status)` ;
5. relais `null` : sortie sans rien écrire (ce n'est pas un échec, la carte explique) ;
6. sinon `syncAccount` avec `sendRequest`/`getStatement` liés au relais.

`session.status` est lu par une ref au moment du `run`, pour ne pas changer l'identité de `run`.

Déclenchement automatique : identifiants présents et synchro périmée (`isFlexSyncStale`), **sans
exiger de session**, mais jamais tant que la session est `loading` : `DbProvider` peut encore
basculer vers la base du profil connecté, et la tentative écrirait dans la base par défaut. La
fin du chargement réévalue l'effet ; le bouton manuel n'attend pas. L'effet se réévalue quand `session.status` change et quand la présence de
l'agent (`useAgentPresence`) passe à `present` : un agent démarré après l'ouverture de l'onglet
synchronise sans rechargement. Quand la présence est `unknown` au montage, l'effet la sonde avant
de décider (c'est `run()` qui le fait).

Un agent démarré après l'ouverture de l'onglet n'est vu que par l'un de ces deux chemins : la
sonde périodique de `useAgentPolling` (compte avec port TWS), ou la carte Synchronisation de la
page Sources, qui sonde au montage quand la présence est `unknown`, puis, tant qu'elle est
montée et la présence `absent`, toutes les 10 s (`AGENT_REPROBE_MS`) et aussitôt que l'onglet
reprend le focus ou redevient visible — jamais onglet masqué. Le bouton manuel ne l'est pas : il
reste inactif agent absent (§5.2, états 2 et 4). Le passage à `present` réévalue le déclenchement
automatique. Sans port TWS, aucune page autre que Sources ne sonde : hors de cette page, la
synchro automatique attend la visite suivante (dette, `docs/points-reportes.md`).

La garde de péremption n'est pas la seule protection contre les passes répétées : chaque compte
garde en mémoire, au niveau du module, l'empreinte de sa dernière tentative automatique —
`relay|lastFlexSyncAt` (`attempts`, `flex/useFlexAutoSync.ts`) — tant qu'au moins une instance du
hook reste montée sur ce compte (`mounted`, compté par instance ; l'empreinte est oubliée quand
la dernière se démonte, et n'est pas écrite si aucune ne reste montée). Une tentative
automatique n'a lieu qu'une fois par relais et par valeur de `lastFlexSyncAt`, tant que le compte
reste ouvert dans l'onglet ; le bouton manuel synchronise toujours, quelle que soit l'empreinte.
Conséquence : une synchro automatique en échec n'est pas retentée dans la même visite par le même
relais. `resetFlexAutoSyncState()` est le point d'entrée de test qui oublie tentatives, verrou et
instances montées.

En mode « agent local et serveur », si une passe par l'agent échoue puis que l'agent devient
absent, la clé de relais change (`agent|…` → `server|…`) : le serveur peut relayer la tentative
automatique suivante — c'est la lettre du §2.3 (l'agent est absent au nouveau choix), énoncée ici
explicitement.

### 4.5 Présence de l'agent sans port TWS

`useAgentPolling` ne sonde que si `twsPort` est défini, et c'est correct pour les passes TWS.
Le relais Flex n'en dépend pas : `run()` sonde lui-même. La carte Synchronisation sonde au
montage (`refreshPresence`) quand la présence est `unknown`, pour afficher son état, puis
resonde un agent absent tant qu'elle est montée (§4.4).

### 4.6 Tests (Vitest, `fake-indexeddb`, `fetch` intercepté)

- `relay.test.ts` : `pickFlexRelay` sur les 2 modes × présent/absent × 4 états de session ;
  `flexRelayMode` sur absent et sur les deux valeurs ;
- `proxy.test.ts` : pour chaque relais, URL, méthode, en-têtes (CSRF présent côté serveur,
  absent côté agent ; `credentials`), corps, et table des codes ;
- `sync.test.ts` : `relay` écrit dans `lastFlexSyncStatus` en `ok` et en `failed` ;
- `useFlexAutoSync.test.tsx` :
  - mode absent, agent présent, anonyme → synchro, appels vers `127.0.0.1:8100/flex/…`,
    aucun vers `/api` ;
  - mode absent, agent absent, session ouverte → aucun appel Flex, statut inchangé ;
  - `agent-and-server`, agent absent, session ouverte → appels vers `/api` ;
  - `agent-and-server`, agent présent, session ouverte → appels vers l'agent ;
  - agent absent au montage puis présent → la synchro part ;
  - synchro fraîche → rien, même avec l'agent ;
- `accounts.test.ts` : `setFlexRelay`, et `clearFlexCredentials` le garde.

---

## 5. Pages

### 5.1 Carte Flex Query : le choix du relais

Sous les champs jeton et identifiant, un groupe de deux boutons radio (`RadioGroup` shadcn,
variante base-ui, ajouté à `packages/ui` avec les imports `@/` réécrits en relatifs). La valeur
sélectionnée est `flexRelayMode(account)` ; un changement s'enregistre aussitôt par
`setFlexRelay`, indépendamment du bouton « Enregistrer » du jeton. Le groupe suit le compte de la
route, comme le reste du formulaire.

Chaque option porte son libellé et son explication, visible en permanence (texte secondaire) :

| Valeur | Libellé | Explication |
|---|---|---|
| `agent` | Agent local seulement | Le jeton et le relevé vont de ce navigateur à l'agent de cette machine, puis à Interactive Brokers. Rien ne passe par le serveur. Sans agent détecté, pas de synchronisation. |
| `agent-and-server` | Agent local et serveur | L'agent relaie quand il est détecté. Sinon, et si vous êtes connecté, le serveur relaie l'appel : le jeton et le relevé le traversent sans être journalisés ni conservés. Permet de synchroniser depuis un autre appareil. |

Anglais :

| Valeur | Libellé | Explication |
|---|---|---|
| `agent` | Local agent only | The token and the statement go from this browser to the agent on this machine, then to Interactive Brokers. Nothing goes through the server. Without a detected agent, no synchronization. |
| `agent-and-server` | Local agent and server | The agent relays when it is detected. Otherwise, and if you are signed in, the server relays the call: the token and the statement pass through it without being logged or kept. Lets you synchronize from another device. |

`sources.flexQuery.hint` devient : « Le jeton et l'identifiant de requête de la Flex Query de ce
compte, chez Interactive Brokers. Choisissez ci-dessous qui peut relayer l'appel. » (anglais :
« … Choose below who may relay the call. »).

### 5.2 Carte Synchronisation

`SyncCard` calcule `pickFlexRelay` à l'affichage, avec la présence partagée, sonde l'agent
au montage si la présence est `unknown`, et le resonde tant qu'il est absent (§4.4). États, dans l'ordre, le premier qui s'applique :

| # | Condition | Message | Bouton |
|---|---|---|---|
| 1 | présence `unknown` | Recherche de l'agent… | inactif |
| 2 | `agent-absent` | Agent non détecté : en mode agent local seulement, la synchronisation passe par lui. + lien « Installer l'agent » (`/help`) | inactif |
| 3 | `session-loading` | Chargement… | inactif |
| 4 | `needs-agent-or-account` | Démarrez l'agent local ou connectez-vous pour synchroniser ce compte. + bouton Se connecter | inactif |
| 5 | `server-unreachable` | message actuel `sync.serverUnreachable` | inactif |
| 6 | identifiants manquants | message actuel `sync.needsCredentials` | inactif |
| 7 | dernière tentative en échec | Dernière tentative en échec ({{code}}), via {{relay}}. | actif |
| 8 | sinon | Dernière synchronisation réussie : {{date}}, via {{relay}}. | actif |

`{{relay}}` : « l'agent local » / « le serveur » (anglais « the local agent » / « the server »).
Un statut sans `relay` (écrit avant ce sous-projet) s'affiche sans la mention « via ».

Les identifiants manquants passent après la disponibilité du relais, comme aujourd'hui après la
session : on explique d'abord ce qui manque à la machine, puis au compte. Aucun de ces états
n'est une erreur visuelle (texte secondaire, comme aujourd'hui).

Codes d'échec propres à l'agent affichés en 7 : `agent-unreachable` (l'agent a disparu entre le
ping et l'appel), `agent-origin-refused` (l'origine du site manque à la configuration de
l'agent).

### 5.3 Page Aide

Le bloc 1, « Ce que fait l'agent », ajoute : il relaie aussi les appels Flex Query de ce site
vers Interactive Brokers, sans rien conserver ; en mode « agent local seulement », le jeton Flex
ne passe jamais par le serveur. Le bloc 7 (« Renseigner le port ») dit que le port n'est
nécessaire que pour les données en direct, pas pour relayer Flex.

### 5.4 Tests

- `SourcesPage.test.tsx` : le groupe affiche « agent seul » sélectionné sur un compte sans
  `flexRelay` ; un clic sur l'autre option écrit `agent-and-server` en base ; les deux
  explications sont visibles ; changer de compte suit la valeur du nouveau compte ;
- chaque état 1–8 de la carte Synchronisation, avec `fetch` vers `/health` intercepté et la
  session semée ;
- `HelpPage.test.tsx` : la mention du relais Flex est présente.

---

## 6. Validation manuelle

Contre l'agent réel et un vrai jeton, avant le merge :

1. compte en mode par défaut, agent démarré, déconnecté du site : « Synchroniser » aboutit, la
   carte dit « via l'agent local », l'onglet réseau ne montre aucun appel `/api/ib/flex/…` ;
2. agent arrêté : état 2, bouton inactif ;
3. mode « agent local et serveur », connecté, agent arrêté : la synchro passe par le serveur,
   « via le serveur » ;
4. agent redémarré, onglet ouvert, synchro périmée : la synchro part seule.

---

## 7. Documents amendés

### 7.1 Spec fondateur (`2026-09-03-architecture-design.md`)

- §4 schéma (`api : Django mince — proxy Flex sans état`) et §8 : l'agent relaie aussi Flex.
- §7.4 : note du 2026-09-16 — le proxy Django n'est plus le seul relais ; il ne sert qu'aux
  comptes en mode « agent local et serveur » quand l'agent est absent.
- §10 (tableau Sécurité et vie privée) : le jeton Flex transite par l'agent, et par le serveur seulement en
  mode « agent local et serveur ».
- §13 : ligne ajoutée — « L'agent fait toute la synchro Flex en un appel » écarté (§2.1 ici).

### 7.2 Spec de l'agent (`2026-09-06-agent-local-design.md`)

§3.3 (quatre endpoints), §3.6 (preflight `GET, POST`, `content-type`, chemins qui agissent) :
note d'amendement renvoyant à ce spec.

### 7.3 `CLAUDE.md`

- « Le serveur ne voit jamais transactions, positions ni jetons Flex, sauf le jeton en transit
  par le proxy » → « … sauf le jeton en transit par le proxy, en mode « agent local et serveur »
  quand l'agent est absent. »
- « La connexion n'est jamais exigée … ; elle ne l'est que pour appeler le proxy Flex » →
  inchangé sur le fond, précisé : une synchro relayée par l'agent n'exige aucune connexion.
- Nouvelle règle : « **L'agent relaie Flex, le serveur seulement si le compte l'autorise** :
  `flexRelay` absent vaut `agent` ; `pickFlexRelay` (`flex/relay.ts`) choisit à chaque synchro,
  agent d'abord ; aucun repli sur le serveur quand l'agent présent échoue. »
- Tableau des sous-projets : ligne 19.

### 7.4 `docs/points-reportes.md`

- Le calendrier de `sync.ts` est désormais aussi celui d'un relais sans limitation de débit :
  rien à recopier côté agent, la dette « calendrier recopié dans deux langages » ne s'étend pas.

---

## 8. Décisions prises pendant le brainstorming

- Relais par l'agent **complément** du proxy Django, pas remplacement : le palier 1 sans
  installation et les autres appareils en ont encore besoin.
- En mode « agent local et serveur », **l'agent d'abord** ; pas de repli sur échec.
- **« Agent local seulement » par défaut**, y compris pour les comptes existants.
- **Aucune compatibilité** avec un agent antérieur : pas de détection de version ni de repli
  sur 404.
- **Pas de limitation de débit** dans l'agent.
- Le relais **ne dépend pas du port TWS**.
- Le relais utilisé est **tracé** dans `lastFlexSyncStatus` et affiché.
