# Sous-projet 35 — Var. jour action : la variation du jour du sous-jacent

Statut : spec écrite (2026-09-28).

La colonne « Var. jour » des tableaux de positions donne la variation du jour **du contrat
détenu** : pour une action, celle de l'action ; pour une option, celle de l'option. Elle vient
de `reqPnLSingle` (sous-projet 23) et n'existe donc que pour un contrat détenu, et jamais pour
un contrat mouvementé le jour même. Pour repérer d'un coup d'œil, stratégie par stratégie, les
titres qui bougent le plus — ceux qui demandent de l'attention —, il manque la variation du jour
**du sous-jacent** : un put vendu sur un titre non détenu n'en a aucune. La même information
aide à lire la Suggestion de position : un titre en forte baisse offre des puts plus chers.

Ce sous-projet ajoute une colonne « Var. jour action », alimentée par une cotation que l'agent
local demande à TWS. La cotation est une donnée temporaire : elle vit en mémoire, jamais en
IndexedDB, et se rafraîchit avec la passe de l'agent.

---

## 1. Périmètre

**Critère de réussite :** agent présent, sur la page Positions Wheel, un put vendu sur un titre
non détenu affiche la variation du jour de ce titre dans « Var. jour action » ; un clic sur
l'en-tête de la colonne trie les lignes par cette variation, signée ; la même valeur paraît sur
la ligne de ce ticker dans la Suggestion de position.

Dans le périmètre : l'endpoint `/quotes` de l'agent (§2), le parseur (§3), le magasin en mémoire
et son déclenchement (§4), la colonne dans les tableaux de positions (§5) et dans la Suggestion
de position (§6), les textes (§7), les tests (§8).

Hors périmètre : la volatilité implicite (arbitré le 2026-09-28) ; tout stockage de la cotation ;
toute cotation sans agent (Flex et relevés n'en portent aucune) ; `dayChange`, `dailyPnl` et la
colonne « Var. jour », inchangés ; le tri de la Suggestion de position.

## 2. L'agent : `GET /quotes`

`GET /quotes?port=<port>&symbols=AAPL,SPY,…` dans `apps/tws-agent/ib_tws_agent/main.py`.

- Connexion comme `/snapshot` et `/bars` (`clientId 0`, `readonly=True`, `CONNECT_TIMEOUT_S`) ;
  TWS injoignable rend le 503 `tws-unreachable` habituel.
- `ib.reqMarketDataType(3)` avant toute demande : IB sert le temps réel quand il est souscrit,
  le différé de 15 minutes sinon. Le compte de l'utilisateur n'a **pas** d'abonnement temps réel
  et s'en satisfait : le différé est le cas nominal, pas un repli.
- Pour chaque symbole, `reqMktData(Stock(symbole, 'SMART', 'USD'), '', False, False)` en flux ;
  attente jusqu'à ce que chaque ticker ait `last` et `close`, ou jusqu'à `QUOTES_TIMEOUT_S`
  (valeur fixée par la sonde, §9, du même ordre que `PNL_TIMEOUT_S`) ; puis `cancelMktData` de
  tous, dans un `finally`. C'est le patron de `collect_pnl`, et comme lui la collecte ne lève
  jamais : un symbole que TWS ne sert pas (inconnu, sans données) sort avec des valeurs `null`.
- Réponse brute, sans calcul, fidèle au principe de l'agent :
  `{"fetchedAt": "<UTC ISO>", "quotes": [{"symbol": "AAPL", "last": 231.4, "close": 228.9}]}`,
  un élément par symbole demandé, `last` et `close` nettoyés comme `clean_pnl` (`nan`, `DBL_MAX`
  et `-1` d'IB deviennent `null`, jamais `0`).
- `symbols` : liste séparée par des virgules, chaque symbole de 1 à 24 caractères, dédoublonnée
  et mise en majuscules. Au-delà de `QUOTES_MAX_SYMBOLS` (90, sous la limite d'environ 100 lignes
  de données de marché simultanées d'IB), l'agent répond 422 : c'est le navigateur qui découpe.
- Pas de cache, comme `/bars`.

## 3. Le parseur

`parseAgentQuotes(payload)` dans `packages/ib-parsers/src/agent.ts`, exporté par le paquet. Il
valide la forme et rend `Map<string, number | null>` — ticker en majuscules → variation du jour :

`underlyingDayChange = (last − close) / close`, `null` quand `last` ou `close` manque ou quand
`close` vaut 0. Un payload mal formé lève, comme `parseAgentSnapshot`.

C'est une notion distincte de `dayChange`, qui reste le seul P&L du jour de `reqPnLSingle` : la
règle « jamais le *Change %* de TWS » vaut pour la variation d'une **position**, parce que le
dernier échange d'une option suit mal son prix de marque. Pour une action, le dernier échange est
le prix : la cotation est légitime. CLAUDE.md le dira en ces termes.

## 4. Le magasin en mémoire et son déclenchement

**Magasin** : `apps/web/src/agent/quotes.ts`, un état au niveau du module — une `Map` ticker →
variation, commune à tous les comptes et à toute la page —, lu par `useSyncExternalStore`
(`useUnderlyingDayChange()` rend une fonction `(ticker) => number | null`), sur le modèle de
`presence` dans `useAgentSync.ts`. Rien en IndexedDB, rien en `localStorage` : un rechargement de
la page le vide, et la colonne montre « — » jusqu'à la première passe.

**Déclenchement** : `useUnderlyingQuotes(accountId)`, monté par `AccountDataProvider`, se relance
chaque fois que `lastAgentSyncAt` du compte change — `syncAgent` ne l'avance qu'après une passe
réussie (`agent/sync.ts`) —, donc au
rythme de `AGENT_POLL_MS` (5 minutes, onglet visible), au bouton Actualiser et au changement de
compte, sans que `syncAgent` ni `useAgentPolling` changent. Une passe de cotations en vol n'en
lance pas une seconde.

**Tickers demandés** : l'union, dédoublonnée,
- des sous-jacents des positions du rapport de risque (`tickerOf(position.symbol)`), et
- des tickers des suggestions affichées (`positionSuggestions`, au plus `MAX_SUGGESTIONS`),

chacun passé par `chartProxyOf` : XSP est demandé comme SPY (l'utilisateur n'a pas l'abonnement
d'indices CBOE). Découpés en lots de `QUOTES_MAX_SYMBOLS`, appelés l'un après l'autre.

**Échecs** : agent absent, TWS injoignable, réponse mal formée : rien n'est écrit, les valeurs
précédentes restent. Une passe de cotations n'a aucun effet sur le snapshot, et son échec n'est
signalé nulle part : c'est un bonus, comme le P&L du jour. `fetchQuotes` rejoint `fetchSnapshot`
et `fetchBars` dans `apps/web/src/agent/client.ts`, avec les mêmes codes d'échec.

**Lecture** : la valeur d'une ligne est celle de son ticker — `chartProxyOf(ticker) ?? ticker`
dans le magasin. Toutes les lignes d'un même ticker montrent donc la même valeur : l'action, le
put vendu, le call couvert, le condor et ses jambes.

## 5. Les tableaux de positions

**`POSITION_COLUMNS`** (`apps/web/src/lib/positionColumns.ts`) passe de douze à treize colonnes :
`underlyingDayChange`, numérique, **juste après `dayChange`**. Elle vaut donc pour la page
Positions, les pages de stratégie (Wheel, LEAPS, Condors, Autres) et la page Condors, lignes de
condor et jambes dépliées comprises. Le tableau du cash la laisse vide, comme les autres colonnes
hors Position et Valeur de marché.

**`WHEEL_SHARE_COLUMNS`** passe de onze à douze colonnes, `underlyingDayChange` juste après
`dayChange`. Sur ces lignes, les deux colonnes se ressemblent — une action est son propre
sous-jacent — mais ne se confondent pas : « Var. jour » est `null` le jour d'une assignation,
« Var. jour action » non. Les deux restent (arbitré le 2026-09-28).

**Tri et filtre** : `positionColumnSpecs` et les specs des pages de stratégie lui ajoutent une
spec `number`, triable et filtrable comme les autres colonnes numériques, tri **signé** ; un
`null` trie en dernier dans les deux sens (règle de `tableCriteria`). **Aucun tri n'est actif par
défaut** : le tri actuel de chaque tableau ne change pas, la vue enregistrée en `localStorage`
non plus.

**Cellule** : pourcentage signé au format de « Var. jour », même couleur de signe, « — » pour
`null`. Pour XSP, une infobulle dit que la valeur est celle de SPY (§7).

**Largeurs** : remesurées par script, jamais itérées sur captures, contre un contenu réaliste —
`-100.0%` pour la nouvelle colonne comme pour `dayChange`, l'en-tête replié sur son mot le plus
large plus le chevron —, en une seule passe pour les deux jeux de colonnes (règle de
`docs/points-reportes.md`, sous-projet 23). Le plancher de `POSITION_COLUMNS` passe d'environ
70rem à environ 75rem, celui de `WHEEL_SHARE_COLUMNS` d'environ 63rem à environ 68rem, valeurs
exactes données par la mesure : plus de défilement horizontal à 1280 px menu ouvert, accepté
(arbitré le 2026-09-28). Le défaut connu de la colonne `coverage` de la Wheel reste hors
périmètre.

## 6. La Suggestion de position

`PositionSuggestionsCard` reçoit « Var. jour action » en **première colonne**, avant Rang. Les
lignes gardent leur ordre, celui de `positionSuggestions` : la colonne n'est ni triable ni
filtrable, et ne pèse pas dans le score. Même cellule qu'au §5.

## 7. Textes

`fr.json` et `en.json` : l'en-tête `underlyingDayChange` dans les colonnes de positions, de la
Wheel et de la Suggestion — « Var. jour action », « Underlying day chg. » — et une clé neuve
pour l'infobulle du substitut, `quotes.proxy` : « Variation de {{proxy}} : Interactive Brokers ne
cote pas {{ticker}}. » / « {{proxy}} change: Interactive Brokers does not quote {{ticker}}. ».
`charts.proxy` ne convient pas : il parle des niveaux du graphe.

## 8. Tests

- **Agent** (`apps/tws-agent/tests/test_quotes.py`, `FakeIB`) : ticker complet, partiel, muet ;
  délai atteint ; `reqMarketDataType(3)` appelé ; annulation de tous les abonnements même en cas
  d'exception ; 422 au-delà de `QUOTES_MAX_SYMBOLS` ; 503 sans TWS ; `nan`/`DBL_MAX`/`-1` en `null`.
- **Parseur** : variation calculée, `null` pour chaque terme manquant et pour `close` nul, payload
  mal formé.
- **Web** (`fake-indexeddb`, ledger semé, agent intercepté) : après une passe réussie, la colonne
  est remplie sur Positions, une page de stratégie, une ligne de condor et la Suggestion ;
  « — » sans agent et avant la première passe ; XSP lit la valeur de SPY ; le tri de la colonne
  est signé, `null` en dernier ; aucun tri par défaut ; une nouvelle passe (`lastAgentSyncAt`
  changé) relance les cotations ; un échec de `/quotes` garde les valeurs précédentes ;
  découpage en lots au-delà de 90 tickers.
- **Colonnes** : les largeurs de `POSITION_COLUMNS` et `WHEEL_SHARE_COLUMNS` somment à 100 %.
- Le driver `run-frontend --agent` sert une fixture `/quotes` à côté de celle de `/snapshot`.

## 9. La sonde, première tâche

Contre le vrai TWS de l'utilisateur, sans abonnement temps réel, avant tout code définitif :

1. Que `reqMarketDataType(3)` remplit bien `last` et `close` des tickers ib_async (les ticks
   différés 68 et 75) pour ses sous-jacents et pour SPY.
2. Ce que vaut `close` en séance, après la clôture et le week-end : la colonne doit montrer la
   variation du dernier jour de séance, jamais un écart nul ou d'un jour décalé.
3. Le temps de réponse pour environ 70 tickers, qui fixe `QUOTES_TIMEOUT_S`, avec
   `CONNECT_TIMEOUT_S + QUOTES_TIMEOUT_S` sous `AGENT_FETCH_TIMEOUT_MS` (15 s).

Le résultat s'écrit dans la spec ; un écart à 1 ou 2 revient à l'utilisateur avant la suite.

## 10. Décisions arbitrées (2026-09-28)

- La cotation n'est pas conservée : mémoire seule, rafraîchie avec la passe de l'agent.
- Variation du jour seule, sans volatilité implicite.
- Tri signé, possible sur la colonne, jamais actif par défaut.
- « Var. jour » reste partout, à côté de la nouvelle colonne.
- XSP est coté par SPY (pas d'abonnement d'indices CBOE).
- Données différées de 15 minutes acceptées : pas d'abonnement temps réel, pas de trading à la
  minute.
- Suggestion de position : la colonne en premier, l'ordre des lignes inchangé.
