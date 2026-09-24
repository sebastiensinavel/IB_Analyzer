# IB Options Analyzer 2 — guide de travail

Application web d'analyse de portefeuilles Interactive Brokers (actions + options), exposée
sur internet, dont le **serveur ne stocke aucune donnée de portefeuille**. Tout le métier
tourne dans le navigateur. Le serveur Django mince est aussi le socle réutilisable d'autres
applications sur VPS.

**Source de vérité : `docs/specs/2026-09-03-architecture-design.md`.** Ne pas rouvrir son §13
« décisions écartées » sans le demander explicitement.

**Dette connue : `docs/points-reportes.md`.** Points vus en revue, jugés non bloquants et
reportés délibérément, classés par sous-projet. À relire au début de chaque sous-projet.

## Données réelles

`private/` (ignoré par git) contient les fichiers réels servant à écrire les parseurs :
`SU10012345_2025_2025.htm` (relevé HTML d'un an) et `flex_<compte>_<date>.xml` (réponse brute
Flex). Les fixtures versionnées en sont des versions **anonymisées**. Ne jamais committer un
identifiant de compte, un jeton ou un montant réel.

Oracles du cash : sur `beta`, la réponse Flex seule retrouve son *Starting Cash* d'ouverture
au centime (`cash.private.test.ts`), et le solde USD de l'historique finit sur le
`TotalCashBalance` de TWS au centime (vérifié au 2026-09-01, montant jamais écrit dans le
dépôt). `alpha`, dont les relevés remontent à l'ouverture du compte (2022), retrouve un
*Starting Cash* de 0 à `CASH_CHECK_TOLERANCE` près, relevés seuls comme avec Flex. Relevés
seuls, son portefeuille se reconstruit sans un écart depuis le sous-projet 10. Le relevé 2026
importé seul garde un écart USD dû à deux corrections antidatées, figé par le même test.

## Règles qui mordent si on les oublie

- **Le serveur ne voit jamais** transactions, positions ni jetons Flex, sauf le jeton en transit
  par le proxy, en mode « agent local et serveur » quand l'agent est absent, jamais journalisé.
  Toute fonctionnalité qui a besoin d'une donnée de portefeuille se fait dans le navigateur.
- **`apps/api` existe et n'aura jamais de table de portefeuille.** Une tâche qui semble
  réclamer un endpoint, un modèle ou une migration pour des transactions, des positions ou
  des secteurs est un **signal d'arrêt**, pas un travail à faire : c'est l'ancienne
  architecture qui remonte. S'arrêter et demander.
- **La connexion n'est jamais exigée pour utiliser l'application** ; elle ne l'est que pour
  appeler le proxy Flex. Une synchro relayée par l'agent n'en exige aucune. Aucune route du
  SPA n'est protégée : un serveur injoignable grise la synchro, jamais le reste de
  l'application.
- **Aucun nom de domaine dans un fichier versionné.** Il vit dans le `.env` du VPS et dans
  `deploy/traefik/.env`, jamais dans le dépôt. L'agent le reçoit par `ib-tws-agent init
  --origin`, la page Aide le lit dans `window.location.origin`, jamais dans le code.
- **Comptes jamais combinés** : chaque vue est scopée `/accounts/:accountId/...`. Les comptes
  vivent en IndexedDB, rien n'est codé en dur.
- **Les stratégies actives sont un réglage du compte** : `AccountRecord.strategies?:
  ActivableStrategy[]`, lu par **`activeStrategies` seul** (`apps/web/src/lib/strategies.ts`),
  jamais en relisant `account.strategies` ailleurs — absent vaut `["wheel"]`
  (`DEFAULT_ACTIVE_STRATEGIES`, un choix de l'application, jamais du moteur) ; le moteur appelé
  sans liste (`buildJournals`, `strategyPositions`…) garde les trois stratégies. L'écriture passe
  par `setActiveStrategies` (toute la liste) ou `toggleActiveStrategy` — la carte « Stratégies
  actives » de Sources de données appelle ce dernier, une lecture-modification-écriture atomique
  dans une seule transaction Dexie, pour que deux cases cochées coup sur coup composent au lieu
  de se marcher dessus. Dans `packages/ledger/src/journals/classify.ts`, une ouverture n'est proposée qu'aux stratégies
  actives, sinon Autres : un groupe de plusieurs contrats ouvert au même instant sans les Condors
  actifs va **tout entier** dans Autres, jamais jambe par jambe dans la Wheel ou les LEAPS. Le
  menu (`NavSection.strategy`) masque les sections des stratégies inactives, Autres toujours
  visible ; `StrategyRoute` (`apps/web/src/routes/StrategyRoute.tsx`) renvoie une route de
  stratégie inactive au tableau de bord du compte, sans redirection tant que la fiche du compte
  n'est pas chargée. Les graphes de Positions et de Suggestion de position dessinent les
  stratégies actives plus Autres, jamais `STRATEGIES` en dur. Ajouter une stratégie demande son
  entrée dans `ACTIVABLE_STRATEGIES`, sa règle dans `classify.ts`, ses sources de couverture
  (`strategyCoverSources`), sa section de menu, ses routes et ses libellés.
- **La base locale appartient au navigateur, jamais à un compte** : une seule base
  `ib-analyzer` par origine, connecté ou non. Le compte Django n'ouvre que deux portes, le
  proxy Flex et la sauvegarde chiffrée, et ne touche jamais aux données. Un `DbProvider` qui
  relirait la session ferait réapparaître le bug du 2026-09-21 : session expirée, serveur
  éteint ou simplement lent affichaient un portefeuille vide.
- **La sauvegarde est un blob opaque, opt-in** : `core.Backup` ne stocke que des octets
  chiffrés par le navigateur (AES-GCM 256), leur taille et leur date, plafonnés à 20 Mo. La
  clé vit en IndexedDB et **voyage enveloppée dans l'en-tête du blob** : une phrase de passe
  d'au moins `MIN_PASSPHRASE_LENGTH` caractères dérive par Argon2id la clé qui l'enveloppe
  (`packBlob`/`readHeader`, `apps/web/src/db/backup/crypto.ts`, octet de version 2). Le
  serveur ne voit ni la phrase ni la clé, et ne gagne pour cela ni colonne ni endpoint. Il n'y
  a **plus de code de récupération** depuis le sous-projet 26, et aucun blob antérieur n'est
  lu. `BackupStateRecord.wrap` est obligatoire : une sauvegarde active a toujours une
  enveloppe. Le paquet emporte toutes les tables sauf `backup`, `statements` compris. Le dépôt
  suit les écritures qui comptent — `TRIGGER_TABLES`, toutes sauf `snapshots` — jamais les
  snapshots de l'agent. L'export local `.json.gz`, lui, reste en clair.
- **Paramètres et Aide s'atteignent sans aucun compte** : `AppLayout` ne rebondit vers
  `/accounts` que pour une route scopée à un compte, jamais pour ces deux-là. C'est le seul
  chemin de restauration d'une sauvegarde sur un navigateur neuf, qui n'a par définition aucun
  compte — resserrer la garde le referme.
- **Propriété de plage, jamais comparaison de contenu** (spec §6.2) : Flex est propriétaire
  de ses jours réels, le relevé HTML n'écrit qu'avant, l'agent n'écrit qu'après. Deux
  transactions jumelles le même jour sont légitimes. **Cette plage ne descend jamais sous la
  fenêtre déclarée par la réponse** (`fromDate`) : une ligne Flex datée avant — un ajustement
  tardif qui porte la date de l'opération qu'il corrige — est ignorée, jamais écrite ni
  revendiquée. La revendiquer effacerait des mois de relevé que la réponse ne remplace pas,
  et l'écrire ferait de ce jour la borne où les relevés cessent d'écrire. La borne haute se
  lit en **jour de marché** pour les seules lignes de l'agent — avant 04:00 la veille, un
  week-end le vendredi —, parce qu'IB passe les assignations d'une échéance dans la nuit qui
  la suit. `marketDayOf` et `MARKET_DAY_START_HOUR` vivent dans `packages/ledger/src/filter.ts`.
- **Constantes métier** : `BUYBACK_RATIO` et `MAX_STRUCTURE_LOSS` dans `packages/coverage`,
  `DEFAULT_MULTIPLIER` dans `packages/ledger/src/constants.ts` — le moteur de journaux en a
  besoin et `coverage` dépend de `ledger`, donc l'inverse serait un cycle ; `coverage` la
  ré-exporte seule. `CASH_CHECK_TOLERANCE` vit dans `packages/ledger/src/cash.ts`, que
  `coverage` ne touche pas. Une seule définition chacune, jamais recodées ailleurs.
- **Le moteur de couverture n'a plus d'oracle Python** : `packages/coverage` a été validé au
  sous-projet 2 contre un oracle Python, depuis retiré avec ses fixtures. Seuls ses tests
  Vitest écrits à la main le fixent désormais ; ne pas réintroduire de Python pour lui.
- **Conversion de devises** : `amount` à la devise de cotation, `quantity` et `commission` à la
  devise de base, paire reconnue à la forme `^[A-Z]{3}\.[A-Z]{3}$` (spec §3.5).
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- **`clientId 0` obligatoire** dans l'agent pour voir les ordres passés depuis TWS.
- **Agent et services locaux écoutent sur `127.0.0.1`**, jamais `0.0.0.0`.
- shadcn ici est **base-ui**, pas Radix : `render={<X/>}` au lieu de `asChild`, `onValueChange`
  typé `T | null`.
- L'agent local est **optionnel** : son absence ne produit jamais une erreur, seulement des
  fonctionnalités en moins (spec §2).
- **L'agent relaie Flex, le serveur seulement si le compte l'autorise** : `AccountRecord.flexRelay`
  absent vaut `agent`, lu par `flexRelayMode` seul ; `pickFlexRelay` (`apps/web/src/flex/relay.ts`)
  choisit au début de chaque synchro, agent d'abord, et ne se replie jamais sur le serveur quand
  l'agent présent échoue. Pas de relais disponible n'est pas un échec : rien n'est écrit. Côté
  agent, le jeton voyage dans le corps, jamais dans l'URL, et `httpx`/`httpcore` restent à
  `WARNING`.
- **Un relevé HTML remplace ses propres lignes sur sa période déclarée** ; les jumelles d'un
  même fichier sont suffixées `#2`, `#3`.
- **Plusieurs fichiers importés ensemble s'écrivent dans l'ordre de leurs périodes**, jamais
  dans celui de la sélection : `importFiles` (`db/importFile.ts`) parse tout, trie par
  `compareByPeriod` — le comparateur de « Relire les relevés » — puis écrit fichier par
  fichier, une transaction chacun, sous un seul `withImportLock`. Un lot laisse ainsi la base
  qu'un rejeu laisserait ; un fichier refusé n'écrit rien et n'arrête pas les autres.
- **Le HTML brut d'un relevé est conservé** (`db.statements`, clé `accountId|start|end`,
  la période déclarée), jamais une réponse Flex ni une réponse de l'agent. « Relire les
  relevés » (`db/replayStatements.ts`) purge toute la couche `statement_html` du compte et
  la rejoue depuis les fichiers, du plus ancien au plus récent, en une transaction : le
  parseur est seul juge de la période, donc de l'ordre et de la clé. Supprimer un relevé
  passe par la même reconstruction. Rien ne quitte le navigateur.
- **« Supprimer les transactions » (`db/clearDerived.ts`) purge le dérivé, jamais la source** :
  `transactions`, `contracts`, `snapshots`, `cashPoints` et `imports` du compte, en une
  transaction. La fiche du compte (jeton Flex, port TWS), les relevés HTML et la table
  sectorielle restent : « Relire les relevés » reconstruit l'historique, les contrats, le
  snapshot et les points de cash venus des relevés, une synchro Flex les siens, l'agent ses
  transactions, ses contrats et son snapshot.
- **Une relecture des relevés réalimente `contracts` par fusion, jamais par reconstruction** :
  un `conid` connu de la seule réponse Flex ou d'une passe d'agent n'a aucun relevé pour le
  réécrire, donc la table n'est jamais vidée avant d'être réécrite.
- **`OptionCashSettlement` est importé en `trade` `OPT` sans quantité** ; côté Flex ce cas n'est
  pas encore observé.
- **`Position` vit dans `packages/ledger`**, `avgPrice` par unité, `expiry` en `YYYY-MM-DD`,
  `symbol` = sous-jacent pour une option.
- **Le snapshot de positions est un document par compte**, remplacé quand le `asOf` du fichier
  est supérieur ou égal. **Un relevé HTML porte un snapshot** à sa fin de période (Open Positions,
  cash USD), soumis à la même règle qu'un Flex ; « Relire les relevés » remplace ou supprime un
  snapshot venu d'un relevé, et ne remplace un snapshot Flex ou agent que si un import le ferait.
- **Le solde cumulé de l'Historique est calé, jamais stocké** : `cashPoints` (Dexie 6) garde par
  devise le point de fin le plus récent et le point de début le plus ancien des Cash Report des
  fichiers — jamais de l'agent —, et `anchoredBalances` (`packages/ledger/src/cash.ts`) décale le
  solde pour finir sur l'*Ending Cash*, puis mesure l'écart au *Starting Cash* à la veille du
  point de début. La carte « Cohérence du cash » de la page Consistance l'affiche ; sans Cash
  Report, le solde part de 0 et la carte le dit. La carte « Cash » en bas de la page Positions
  (`CashBalancesCard`) montre le dernier point de ce même solde par devise, avec ou sans
  snapshot : « — » seulement quand ni transaction ni Cash Report n'existe.
- **Les tableaux de la page Positions partagent leurs colonnes** : `POSITION_COLUMNS`
  (`apps/web/src/lib/positionColumns.ts`) fixe l'ordre et la largeur des douze colonnes, et
  `PositionTable` les pose en disposition fixe sur chaque tableau, celui du cash compris, qui
  laisse vides les colonnes autres que Position et Valeur de marché. Une colonne s'ajoute là,
  jamais dans un seul tableau : les colonnes ne seraient plus alignées. Les pages de stratégie
  reprennent `POSITION_COLUMNS` pour leurs tableaux d'options et d'actions LEAPS ; seules les
  trois tables d'actions assignées de la Wheel ont leurs onze colonnes propres, `WHEEL_SHARE_COLUMNS`
  (même fichier), délibérément : elles ne s'alignent pas sur les douze colonnes partagées.
- **L'Historique ne pagine pas** : un seul tableau virtualisé (`components/history/HistoryTable.tsx`)
  défile dans sa carte, en-tête figé, bordé d'une barre temporelle (`TimelineScrubber`). Ses lignes
  ont une hauteur constante, `HISTORY_ROW_HEIGHT` (`lib/historyColumns.ts`), et aucune cellule ne
  passe à la ligne : la barre place un mois à `index × hauteur` sans rien mesurer, une ligne plus
  haute la fausserait. La barre suit les lignes filtrées. Un changement de compte remonte le
  tableau (`key`) ; un changement de recherche, de critère ou de tri le ramène en haut par
  `resetKey` sans le remonter, pour ne pas fermer le panneau de colonne de l'en-tête, qui porte
  le tri et le filtre ; une ligne arrivée en direct ne fait ni l'un ni l'autre. La barre temporelle n'est rendue que sans tri. La
  position s'écrit dans `scrollTop`, jamais par `scrollToOffset` (jsdom n'a pas `scrollTo`).
- **Tri et filtres des tableaux sont un état d'affichage en `localStorage`, jamais en IndexedDB ni
  sur le serveur** : une clé par compte et par tableau (`ib2:tableView:<compte>:history`,
  `…:positions:<groupe>`, `…:positions:<stratégie>:<groupe>`, `…:journal:<stratégie>`) et par page
  pour la recherche par ticker (`ib2:pageSearch:`), effacées par `deleteAccount`. Le moteur est
  pur (`lib/tableCriteria.ts`, `lib/tableView.ts`) ; chaque
  colonne déclare son type et sa valeur à côté de ses largeurs (`historyColumnSpecs`,
  `positionColumnSpecs`). Un `null` trie en dernier dans les deux sens et n'est retenu que par
  `—`. Les soldes de l'Historique se calculent sur tout le ledger avant tout filtre ou tri. Une
  carte de Positions a sa propre vue : Type, Décision et Couverture n'y ont pas le même sens
  d'un groupe à l'autre ; seule la recherche par ticker est commune. La Couverture se filtre sur
  `coverageValues`, jamais sur le texte des badges. L'Historique, Positions, les quatre pages
  Positions de stratégie et les quatre Journaux se trient et se filtrent par colonne ; aucun autre
  tableau ne le fait.
- **Toute heure IB est l'heure murale de New York stampée UTC** (`IB_REPORT_TIME_ZONE`,
  `toReportTime` dans `packages/ib-parsers/src/common.ts`) : Flex et relevés telle quelle,
  l'agent converti depuis son vrai UTC. Seuls les instants de l'application
  (`lastAgentSyncAt`, `importedAt`…) restent en vrai UTC, et le badge « En direct » lit
  `lastAgentSyncAt`. **Flex possède ses jours entiers ; l'agent n'écrit qu'après le dernier
  jour de marché Flex, et ne supprime jamais** : TWS rend une assignation le soir, parfois
  après minuit — un samedi 01:02 pour une échéance du vendredi —, là où Flex la date 16:20.
  Un snapshot `agent` remplace toujours le courant ; un fichier remplace si son `asOf`
  atteint le jour du courant (`db/snapshot.ts`).
- **Aucun `ImportRecord` pour l'agent** : l'état vit sur le compte (`twsPort`,
  `lastAgentSyncAt`, `lastAgentSyncStatus`).
- **Les valeurs du jour viennent de l'agent seul** : `dailyPnl` est le P&L du jour que
  `reqPnLSingle` rend, sans abonnement ; `dayChange` est déduit dans
  `packages/ib-parsers/src/agent.ts` par `dailyPnL / (value − dailyPnL)`, **jamais** le
  *Change %* de TWS, qui suit le dernier échange quand celui-ci suit le prix de marque. Les
  deux sont `null` pour un relevé et pour Flex, et `dayChange` l'est aussi pour un contrat
  mouvementé le jour même — le P&L du jour part alors du prix d'exécution. Une page de
  stratégie proratise `dailyPnl` et reprend `dayChange` tel quel, et abandonne les deux dès que
  `dayChange` de la position est `null` (`dayShare`, `packages/coverage/src/strategy.ts`).
  L'étape PnL de l'agent (`collect_pnl`, `PNL_TIMEOUT_S`) ne fait jamais échouer `/snapshot`.
- **Les couleurs vivent dans les tokens de `apps/web/src/index.css`**, reprises des maquettes
  `docs/style/{dark,white}-finance-desktop.html` (sous-projet 31) : `primary` et `success` sont tous deux teal, si bien
  qu'aucune étiquette ne s'appuie sur leur différence (`journalTone.ts` prend les teintes des
  séries). Ce qui ne lit pas le CSS — ECharts, lightweight-charts — lit `lib/chartColors.ts`
  seul, que `chartColors.test.ts` tient en phase avec `index.css`. L'index d'une série porte
  un rôle (0 actions, 1 calls vendus, 2 puts vendus et ouvert, 3 LEAPS) : ne jamais le
  réordonner. Les barres de défilement sont dessinées en CSS seul ; aucun `scrollbar-width`
  hors du `@supports` d'`index.css`, qui désactiverait leur style dans Chrome.
- **Il n'y a pas de page Aujourd'hui** : Historique, Positions et Dashboard portent les
  données intraday.
- **Les journaux sont une vue calculée du ledger, jamais stockée** : `buildJournals` dans
  `packages/ledger/src/journals/`, recalculé par `useJournals` à chaque changement. Pas de
  table, de store ni de migration Dexie pour les journaux.
- **Le capital d'une stratégie se mesure au prix d'entrée, jamais à la valeur de marché** :
  `computeCapital` (`packages/ledger/src/journals/capital.ts`) compte une action de la Wheel au
  `openPrice` de sa ligne — le strike du put qui l'a livrée ou du call qui l'a reprise —, un put
  vendu à `strike × DEFAULT_MULTIPLIER × |quantité|`, un LEAPS à son prix d'achat ×
  `DEFAULT_MULTIPLIER` et les actions qu'il a livrées à leur strike, un Condor à sa pire aile
  brute, crédit non déduit (la règle de `structureAssignmentCash`, que `ledger` ne peut pas
  importer). Un call vendu ne compte rien. Une ligne est ouverte en fin de mois selon `startWhen`
  et `endWhen`, **jamais selon `ongoing`** : un put assigné reste `ongoing` tant que ses actions
  ne sont pas vendues, le lire ouvert compterait deux fois le même argent. Ses mois sont ceux de
  `StrategyStats`, qui courent jusqu'à la dernière transaction du compte. **Le rendement mensuel se
  mesure au pic du mois, jamais en fin de mois** : le plus d'argent immobilisé à la fois pendant le
  mois (`peakDuring`), une ligne passant la main à l'instant où elle se termine. Un Condor clôturé
  en perte avant la fin du mois garde ainsi son rendement négatif ; `returnRate` n'est `null` que
  pour un mois sans rien d'immobilisé. Les courbes de capital, elles, restent en fin de mois.
- **Le tableau de bord est la portée `portfolio`, jamais une addition** : `buildJournals` appelle
  `computeStats` et `computeCapital` sur `scopeStrategies(scope, active)` pour `wheel`, `leaps`,
  `condors` et `portfolio` ; `scopeStrategies` (`packages/ledger/src/journals/types.ts`) rend
  `[scope]` pour une stratégie et **la liste active** — jamais les trois stratégies d'office —
  pour `portfolio`, Autres n'y entrant jamais. Le profit/perte total du tableau de bord est donc
  la somme des totaux des stratégies actives et son rendement la somme de leurs profits/pertes
  sur la somme des montants alloués, sans qu'aucune fonction ne combine des résultats par
  stratégie.
- **Journaux et rapport de risque se calculent une fois, dans la coquille** :
  `AccountDataProvider` (`db/AccountDataProvider.tsx`), monté par `AppLayout` pour le compte
  affiché, appelle `useJournals` et `useRiskReport` ; la barre de titre et toutes les pages les
  lisent par `useAccountJournals` et `useAccountRiskReport`, qui lèvent une erreur hors du
  fournisseur. Aucune page n'appelle `useJournals` ni `useRiskReport` directement.
- **Les cartes Positions non couvertes, Reconstitution du portefeuille et Cohérence du cash
  vivent sur la page Consistance**, et nulle part ailleurs. La barre de titre porte en
  permanence deux verdicts (`lib/consistency.ts`),
  Couverture et Reconstitution : vert, rouge, gris sans snapshot. Seule une position non
  couverte clignote ; un écart de reconstitution est une alerte, rouge fixe, même quand un
  historique tronqué suffit à l'expliquer. Juste à leur gauche, `SnapshotStatus` (date ou
  « En direct », échec de l'agent, bouton Actualiser) est lui aussi dans la barre de titre, et
  sur aucune page.
- **Un call vendu sur des actions détenues est un call couvert**, qu'elles aient été
  assignées ou achetées au marché. Il couvre d'abord les actions déjà dans la Wheel et libres ;
  seules celles qui **manquent** entrent alors dans la wheel, prises hors Wheel dans l'ordre du
  carnet et **reprises au strike de ce call** : le lot est coupé sur place, clos dans sa
  stratégie d'origine au strike (événement `integrated`, `journals/takeover.ts`) et rouvert dans
  la wheel au même strike, la part reprise gardant le rang du lot dans le carnet. Reprendre au
  coût réel ferait entrer la plus-value d'avant-wheel dans la stratégie ; laisser la part
  reprise en fin de file ferait livrer les mauvaises actions à l'assignation. La
  classification se fait une fois, à la vente : un call vendu à nu ne se reclasse jamais.
  **Un call Wheel fait sortir d'abord des actions Wheel** (`LotBook.closePreferring`) : à son
  assignation, et quand une vente d'actions tombe au même instant que son rachat, dans la limite
  des contrats rachetés. Toute autre vente reste FIFO. Le rang d'un lot est `rankWhen`, que les
  deux morceaux d'une coupe héritent : une opération sur titres trie sur lui, jamais sur
  `openWhen`.
- **`JournalRow.note` porte un code, jamais une phrase** : `packages/ledger` n'écrit aucun
  texte visible, `apps/web/src/i18n/{fr,en}.json` porte la partie fixe et le libellé de
  contrat s'y interpole.
- **Les événements de sortie d'option (assignation, exercice, expiration) sont inférés** de
  la forme des transactions — une clôture à prix 0 sans commission, avec ou sans livraison
  d'actions au strike au même instant —, jamais lus d'une colonne IB. Aucun champ `code` sur
  `Transaction`.
- **`LEAPS_MIN_MONTHS = 3`** vit une seule fois, dans `packages/ledger/src/journals/types.ts`.
- **Les tranches d'un même ordre sont fondues en une ligne** (`journals/fills.ts`) : même
  contrat, même sens, même source, moins de `FILL_MERGE_WINDOW_MS` (2 s) entre voisines.
  Quantités et montants sommés, prix moyenné par la quantité, instant et `externalId` du
  plus ancien, tous les ids conservés dans `openIds`/`closeIds`. Une ligne sans commission
  ne fond jamais : c'est une jambe d'expiration, d'assignation ou de livraison, appariée
  par `resolveDeliveries`.
- **`Transaction.symbol` d'une option Flex est le symbole OCC empaqueté** ; le ticker se lit
  par `tickerOf(symbol)`, qui gère à la fois la forme paddée et une racine à six caractères.
- **L'oracle des journaux** est `packages/ib-parsers/tests/fixtures/flex_journals_corpus.xml`,
  produit par `anonymize-flex.mjs --full` et rejoué contre son propre snapshot : zéro écart.
  Un écart est un bug du moteur.
- **Les opérations sur titres sont appariées et rejouées, jamais stockées** : deux lignes
  `corporate_action` qui partagent leur instant et le nom de leur événement — la description
  privée du triplet `(TICKER, NOM, ISIN)` qui nomme la jambe — font une conversion. La base
  de coût est reportée, `openPrice` divisé par le ratio ; seule une fusion mixte consomme de
  la base, et seulement à hauteur de `proceeds − realizedPnl`. Quand le carnet détenait
  exactement ce que l'événement fait sortir, il détient exactement ce qu'il fait entrer : le
  résidu du ratio — 53,3333/1600 n'est pas représentable — se pose sur le plus gros lot
  déplacé, le seul qu'il ne peut pas retourner vendeur, jamais quand l'historique est
  tronqué avant l'événement.
- **L'ISIN d'une jambe dit quel contrat son ticker désignait ce jour-là** (règle 8 du §5.2) :
  IB donne au contrat neuf d'un changement de CUSIP le ticker que portait l'ancien, renomme
  l'ancien `X.OLD`, puis rebaptise le neuf des mois plus tard — et les *Contract Information*
  réécrites n'en gardent aucune trace. Ce ticker devient donc un alias de la classe que
  l'ISIN de la jambe désigne, stampé du seul jour de l'événement, ce qui rend le ticker
  ambigu et laisse la règle 4 le dater. Sans cela les titres entrants se rangent sur le
  contrat mort (ZXAL/ZXAM, 2025-03-05). **Cette greffe est marquée, jamais seulement datée** :
  un alias qu'aucune source n'a écrit est classé après toutes les orthographes qu'une source a
  réellement écrites dans `canonicalOf`, sans quoi la fenêtre d'un relevé close avant
  l'événement le ferait gagner par la seule date et ferait basculer toute la classe sur le nom
  mort — la même protection couvre la greffe de la règle 9.
- **Le `conid` est un indice d'équivalence, jamais une clé de contrat.** `contractId` reste
  sur le ticker ; l'identité sert seulement à choisir *quel* ticker. En faire une clé
  scinderait les lots d'un contrat vu une fois avec et une fois sans. **Une option n'entre
  dans une classe que sous sa forme OSI empaquetée** (`ZXAG  270115C00002500`), la seule qui
  la nomme *elle* et que seul Flex écrit : TWS nomme une option par son sous-jacent, donc lire
  ces alias-là ferait revendiquer « AAPL » par toutes les options d'AAPL (spec §5.2, règle 7).
  Une transaction qui nomme l'option par son sous-jacent reconstruit cette forme depuis ses
  termes (`packedOptionSymbol`) pour interroger la table ; et une conversion 1 pour 1 du
  sous-jacent greffe l'ancienne orthographe sur la classe du nouveau ticker, sur preuve
  qu'elle existe (spec §5.2, règle 9).
- **`Transaction.realizedPnl` n'est écrit que sur les lignes `corporate_action`** ; le moteur
  calcule lui-même le P/L des trades et ne doit jamais en importer une seconde version.
- **La table sectorielle se fusionne par ticker, elle n'est jamais remplacée** : l'import CSV
  (`db/sectors.ts`) ajoute et met à jour, une colonne absente du fichier garde sa valeur, une
  cellule vide l'efface, aucune ligne n'est supprimée. Chaque import IB — `importFile`, donc la
  synchro Flex, `syncAgent` et `replayStatements` — y ajoute dans sa propre transaction les
  tickers `STK`/`OPT` nouveaux, jamais un `.OLD`, et **ne modifie jamais une ligne existante**.
  Toute écriture passe par `db/sectors.ts` et réécrit `updatedAt`. La page Secteur et Score vit
  sous `/accounts/:accountId/sectors` pour garder la coquille active, mais la table reste commune
  à tous les comptes. Sa colonne **« En cours » est calculée, jamais stockée** : 1, sur le teal
  des puts en cours du journal Wheel (`LABEL_TONE_CLASS.open`), quand le snapshot de **n'importe
  quel compte** détient une action ou une option du ticker (`heldTickers`, même lecture que
  l'ajout par import) ; 0 sinon, y compris sans aucun snapshot.
- **Les positions d'une stratégie sont une vue calculée, jamais stockée** : `strategyPositions`
  (`packages/coverage/src/strategy.ts`) lit les lignes de journal ouvertes (`endWhen === null`) et
  les apparie au snapshot par `contractId(row.contract)`, la clé de la réconciliation. Une ligne
  montre la part de la stratégie — quantité et prix d'entrée du journal, dernier prix d'IB — et, de
  la couverture IB, seulement celle de la stratégie (`strategyCoverSources(strategy, active)`) :
  `cash` et `stock` pour une vente Wheel, `leaps` pour une vente LEAPS, jamais `UNCOVERED` pour une
  stratégie active, la part nue d'un call relevant d'Autres ; un LEAPS acheté garde son « used
  x/y », des actions LEAPS n'ont aucun badge.
  Le badge et le filtre Couverture d'une option achetée se lisent sur `StrategyLine.used`
  (`apps/web/src/lib/riskReport.ts`), plafonné par la ligne, ailes de Condor comprises.
  Les actions Wheel ont leur propre couverture, `coveredShares` (`wheelHoldings`,
  `packages/ledger/src/journals/holdings.ts`). Les quatre stratégies ont leur page
  (`positions/wheel`, `/leaps`, `/condors`, `/others`), servies par un seul composant : ses
  encadrés sont déclarés dans `STRATEGY_BOXES` (`apps/web/src/lib/strategyBoxes.ts`) et un encadré
  sans ligne ne se rend pas. **Un condor se lit sur ses jambes** — son composite n'a ni right ni
  strike, donc rien ne le valorise — et les actions de la Wheel restent dans leur table propre,
  jamais aussi dans le groupe des positions longues. `strategyCoverSources(strategy, active)` donne
  `spread` aux Condors ; **Autres possède les sources des stratégies inactives** — un call vendu
  contre un LEAPS inactif y porte le badge `leaps`, pas `UNCOVERED` — et rien quand les trois sont
  actives, son ancien comportement : une vente d'Autres porte alors `UNCOVERED ×|quantité|` lu sur
  la ligne elle-même. **Une page de stratégie ne montre que sa part couverte** :
  `migratedContracts` (`packages/coverage/src/strategy.ts`) retranche d'une vente d'options les
  contrats que la couverture du snapshot ne porte plus, et la page Autres les reprend, fondus par
  contrat et sans badge d'origine — une position nue n'appartient à aucune stratégie ; il ne
  retranche que **la part nue d'Autres** — ses ventes moins ce que ses propres sources (celles des
  stratégies inactives) couvrent —, jamais sa part déjà couverte. Le total repris ne dépasse
  jamais l'`uncoveredQuantity` du moteur, moins la part nue d'Autres, donc la part migrée ne
  peut pas contredire la barre de titre ; sans snapshot rien ne migre. La quantité d'une telle
  ligne ne vaut alors plus celle du Journal de la stratégie, qui reste le registre des lots : la
  classification se fait une fois, à la vente. Les cartes d'actions assignées de la Wheel ne
  comptent que les calls couverts, ce qui rend « used x/y » vrai. **Les pages Wheel et LEAPS
  rangent leurs lignes par point de contrôle** : `strategyBoxContents`
  (`packages/coverage/src/strategyBoxes.ts`) coupe les actions Wheel d'un ticker en part libre
  et part couverte — la couverte au-dessus ou en dessous selon le prix moyen des calls contre
  le prix moyen d'assignation du ticker, jamais celui des lots FIFO, une comparaison impossible
  en dessous — et un LEAPS en part libre et part utilisée (`used`, plafonnée par la ligne). Les
  graphes ne changent pas d'un encadré à l'autre.
- **La suggestion de position mesure en valeur de risque, jamais en capital** :
  `positionSuggestions` (`packages/coverage/src/suggestions.ts`) additionne `riskValue` des positions
  du compte affiché, par ticker et par secteur de la table sectorielle, et porte
  `select_put_sell_candidates` de l'outil Python d'origine. `MIN_SUGGESTION_SCORE`, `MAX_SUGGESTIONS` et
  `MAX_SUGGESTION_TICKER_SHARE` vivent une seule fois dans `packages/coverage/src/constants.ts`.
- **Les graphes de cours viennent de TWS par l'agent, jamais d'un fournisseur tiers ni du
  serveur** : `/bars` (`apps/tws-agent`), deux ans de journalier `TRADES`, sans cache. Les
  niveaux dessinés sont une vue calculée des journaux (`strategyLevels`,
  `packages/ledger/src/journals/levels.ts`), sans couleur ni texte : `apps/web/src/lib/chartLevels.ts`
  donne la teinte de la palette et l'étiquette traduite. Une page de stratégie ne dessine que
  la sienne ; Positions et Suggestion de position dessinent les quatre. Les barres `TRADES`
  d'IB sont ajustées des splits et les options n'ont pas d'historique de fin de journée : les
  graphes ne montrent que des sous-jacents, splits non traités (spec §3). **L'axe du temps se
  pose à la main**, `setVisibleLogicalRange` sur la plage que rend `visibleRange`
  (`components/PriceChart.tsx`) : `timeExtent` prolonge les données de `CHART_MARGIN_DAYS`
  jours ouvrés au-delà du plus lointain des deux, dernière barre ou date dessinée, et la même
  marge est laissée à gauche. `fitContent` recollerait le bord droit sur la dernière bougie —
  son `applyDefaultOffset` écrase le décalage par `rightOffset`, 0 — et renverrait tous les
  jours vides à gauche, échéances futures comprises.
- **Un graphe peut montrer un autre titre que son ticker, et le dit** : `chartProxyOf`
  (`apps/web/src/lib/chartProxies.ts`) porte la seule table de substituts — `XSP` → `SPY`. Le
  Mini-SPX est un **indice** : aucune action ne porte ce nom chez IB en USD, si bien que
  `Stock('XSP','SMART','USD')` rend l'erreur 200, et l'indice lui-même demande l'abonnement
  « CBOE Streaming Market Indexes », non souscrit (vérifié au 2026-09-22 : la recherche TWS
  n'offre aucune ligne *Index* sous XSP ni sous SPX). Élargir la résolution au lieu de
  substituer serait pire que l'erreur : `XSP` est aussi l'ETF iShares Core S&P 500 sur **TSE,
  en CAD**, qu'un graphe rendrait sans rien dire. `PositionChartRow` demande donc le substitut,
  l'écrit au-dessus du graphe (`charts.proxy`), nomme le ticker réellement demandé dans
  « aucun historique », et garde `strategyLevels` sur le vrai ticker : les niveaux restent aux
  strikes XSP. L'agent, lui, ne connaît aucun de ces tickers — la substitution est un choix
  d'affichage, comme les teintes de `chartLevels.ts`.

## Workflow

Chaque sous-projet : `superpowers:brainstorming` → spec dans `docs/specs/` →
`superpowers:writing-plans` → plan dans `docs/plans/` → `superpowers:subagent-driven-development`
en TDD, dans un git worktree `.claude/worktrees/<nom>`, mergé sur `main` une fois la revue de
branche propre.

**L'instance de dev d'un worktree reste démarrée pour la relecture, et s'arrête avant le
merge.** Une fois la dernière case du plan cochée, `pnpm dev:start` dans le worktree (Vite et
Django en arrière-plan, sur les ports du worktree) et donner les deux URL à Seb : il regarde la
branche avant de décider du merge. Au merge, `pnpm dev:stop` dans le worktree **avant** `git
merge` et `git worktree remove` : après, plus rien ne dit quels processus lui appartenaient.

**Un réglage visuel se mesure d'abord, il ne s'itère pas sur des captures.** Ajuster des
largeurs de colonnes ou faire tenir des libellés a coûté trois quarts d'heure par agent au
sous-projet 20, passés à démarrer un navigateur, capturer, régler, recommencer. À la place :
un script qui mesure la largeur réelle de chaque libellé et de la donnée la plus longue et
qui sort les pourcentages en une passe, l'instance de dev laissée en marche, `pnpm check`
**une seule fois à la fin** — il lance lint, typage, build et tous les tests — et des tests
ciblés pendant l'itération. Et surtout : **les arbitrages d'affichage se tranchent avant de
lancer l'agent**, jamais après avoir vu ses captures, sinon chaque question rejoue une vague
entière. Une justification visuelle s'accompagne des deux captures qui la montrent, vérifiées :
au sous-projet 20, un agent a justifié un choix par une paire identique au pixel près.

**Les cases du plan se cochent dans le worktree au fur et à mesure**, dans le même commit que
la tâche. Le plan de la branche est l'état d'avancement : une reprise de session part de la
première case non cochée, jamais d'une reconstitution à partir des commits ni d'une
improvisation — c'est en improvisant qu'on réinvente l'ancienne architecture.

Ordre des sous-projets et statut — le registre tenu à jour, au-delà de la liste de conception
d'origine arrêtée au sous-projet 6 (spec §12) :

| # | Sous-projet | Statut |
|---|---|---|
| 1 | Socle monorepo, `ledger`, `ib-parsers`, Historique au palier 2 sans serveur | fait (2026-09-03) |
| 2 | `coverage` porté avec oracle, positions Flex, Positions et Dashboard, table sectorielle | fait (2026-09-04) |
| 3 | Serveur Django : invitations, 2FA, proxy Flex, déploiement VPS | livré (2026-09-04), sauf la mise en ligne réelle sur le VPS, en attente de l'utilisateur |
| 4 | Agent local, positions intraday, exécutions du jour | fait (2026-09-06) |
| 5 | Journaux Wheel, LEAPS, Condors | fait (2026-09-07) |
| 6 | Sauvegarde chiffrée et page Paramètres | fondu dans le 25 |
| 7 | Opérations sur titres et identité de contrat | fait (2026-09-09) |
| 8 | Le journal Wheel prend les actions qu'il couvre | fait (2026-09-09) |
| 9 | Application complète avec un seul fichier : positions du relevé, solde calé | fait (2026-09-11) |
| 10 | Identité des options sans Flex (relevés, agent) | fait (2026-09-16) |
| 11 | Page Consistance et verdicts permanents dans la barre de titre | fait (2026-09-11) |
| 12 | Historique en défilement continu | fait (2026-09-11) |
| 13 | Capital et exposition de la Wheel | fait (2026-09-12) |
| 14 | Capital des LEAPS, des Condors et du portefeuille | fait (2026-09-12) |
| 15 | Page Secteur et Score : table sectorielle fusionnée, éditable, alimentée par les imports | fait (2026-09-14) |
| 16 | Positions par stratégie et Suggestion de Position | fait (2026-09-15) |
| 17 | La Wheel ne prend que ce qu'il faut | fait (2026-09-16) |
| 18 | Propriété de plage en jours de marché | fait (2026-09-16) |
| 19 | L'agent local relaie Flex | fait (2026-09-16) |
| 20 | Tri et filtres de colonne de l'Historique et de Positions | fait (2026-09-17) |
| 21 | Recherche, tri et filtres des pages de stratégie, Positions Condors et Autres | fait (2026-09-18) |
| 22 | La part nue quitte les pages de stratégie | fait (2026-09-18) |
| 23 | Valeurs du jour : P&L du jour et variation par position | fait (2026-09-19) |
| 24 | L'assignation d'après minuit : propriété de plage en jour de marché | fait (2026-09-19) |
| 25 | Le compte serveur : ce qu'il ouvre, ce qu'il sauvegarde | fait (2026-09-21) |
| 26 | La sauvegarde sans rien à conserver : clé enveloppée par un mot de passe | fait (2026-09-22) |
| 27 | Les graphes de cours dans les tableaux de positions | fait (2026-09-21) |
| 28 | Premiers pas : accueil, compte serveur facultatif, première étape, Aide | fait (2026-09-22) |
| 29 | Les tableaux de la Wheel et des LEAPS rangés par point de contrôle | fait (2026-09-22) |
| 30 | Les stratégies actives d'un compte | fait (2026-09-23) |
| 31 | Habillage « finance-desktop » : tokens, polices, tableaux, graphes, barres de défilement | fait (2026-09-24) |

## Outillage

Node 22 (`corepack enable --install-directory ~/.local/bin` pour pnpm — node système, pas de
sudo), uv, Python 3.14, Docker. `pnpm dev` lance l'application web, `pnpm dev:api` le
serveur Django. **Un port et une base par checkout** (`tools/dev-env/ports.mjs`) : la
racine du dépôt garde `5173`/`8000`/`ib_analyzer`, un worktree `.claude/worktrees/<nom>`
prend le plus petit numéro libre N ≥ 1 et sert sur `5173+N`/`8000+N` — 5174/8001, puis
5175/8002 —, avec une base `ib_analyzer_<nom>`. Le numéro est écrit une fois dans
`.git/worktrees/<nom>/dev-slot` : le worktree le garde toute sa vie, `git worktree remove` le
libère pour le suivant. Vite, Playwright, le driver de `run-frontend`, `pnpm dev:api`,
`pnpm test:api` et `pnpm dev:start`/`dev:stop`/`dev:status` (`tools/dev-env/instance.mjs`,
Vite et Django détachés, journaux dans `dev-instance/` du dossier git du checkout) suivent
tous cette règle, si bien que l'app peut tourner à la racine pendant qu'un worktree
vérifie sa propre branche, sans jamais se répondre l'un pour l'autre. Ne jamais recoder
un port en dur dans ces outils. **L'agent local, lui, ne suit pas cette règle** : il reste sur
`127.0.0.1:8100` pour tous les checkouts, mais ne répond qu'aux origines de sa configuration
(`origins` dans `config.toml`, sous `platformdirs.user_config_dir("ib-tws-agent")`). Un
worktree servi sur `5174` est refusé en 403 sans en-tête CORS, et l'app le voit absent :
ajouter `http://127.0.0.1:5174` à la liste à la main — `ib-tws-agent init` la réécrit avec
une seule origine — puis relancer l'agent. `pnpm check` avant tout
merge ; il vérifie la fraîcheur d'`apps/web/src/api/schema.d.ts` contre `openapi.json` mais
**ne lance jamais Python**, ni Django, ni pytest. Turborepo n'est pas installé tant que le
besoin n'existe pas. Deux écarts délibérés à la lettre du spec, à ne pas « corriger » :
`@noble/hashes` est une dépendance de production de `ib-parsers` parce que le hachage
WebCrypto est asynchrone ; `playwright` est une dépendance de développement d'`apps/web`
parce que le skill `run-frontend` imposé a besoin d'un navigateur. Dans `packages/ui`, après
`pnpm dlx shadcn@latest add`, réécrire les imports `@/` du fichier généré en relatifs (voir
`packages/ui/README.md`) : l'alias `@` appartient aux applications. Le skill
`.claude/skills/run-frontend/` se pilote depuis la racine du dépôt ; sa graine de
démonstration est `--seed`. Il accepte aussi `--import=` (répétable, dans l'ordre),
`--sectors=` et `--ib-account=` pour importer des fichiers réels ou une table sectorielle
avant la capture, et `--empty`, qui crée les deux comptes sans aucune donnée pour simuler la
première visite. Il accepte aussi `--agent`, qui intercepte l'agent local
(`127.0.0.1:8100`) avec une fixture au lieu d'un vrai TWS. Une page
qui porte un graphique ECharts attend d'elle-même 1 200 ms avant sa capture, la fin de
l'animation d'entrée ; `--wait=<ms>` impose un autre délai, sur toute page.
L'anonymiseur Flex (`packages/ib-parsers/scripts/anonymize-flex.mjs`) accepte `--full`, qui lève
le plafond de lignes par section pour produire un corpus complet — utilisé pour l'oracle des
journaux. `pnpm --filter web test -- <motif>` ne filtre pas : le script est `vitest run`, donc
le `--` de pnpm donne `vitest run -- <motif>` ; la forme qui filtre est `npx vitest run <motif>`
depuis `apps/web`.

**`apps/api`** : un unique workspace uv à la racine du dépôt (`pyproject.toml`, `uv.lock`),
membres `apps/api` et `apps/tws-agent`. `pnpm test:api` (`uv run
--project apps/api pytest apps/api`) exécute les tests Python de l'API ; il demande un
PostgreSQL joignable, démarré par `docker compose -f docker-compose.dev.yml up -d db`.
`pnpm test:agent` (`uv run --project apps/tws-agent pytest apps/tws-agent`) exécute ceux de
l'agent, sur un `FakeIB` : aucun PostgreSQL, aucun TWS requis. `pnpm build:agent` construit
la roue et écrit `index.json` dans `apps/web/public/agent/`, ce que fait aussi l'image `web`
à la construction. `pnpm gen:api` régénère `apps/web/src/api/schema.d.ts` depuis
`apps/api/openapi.json` (`openapi-typescript`) après tout changement de l'API ; le fichier
généré est committé, sa fraîcheur est ce que vérifie `pnpm check`. Django 5.2 LTS sur
Python 3.14. `pnpm --filter web e2e` (Playwright, dossier `apps/web/e2e/`) tourne à part,
contre un serveur Django et un PostgreSQL réellement démarrés : ni `pnpm check` ni
`pnpm test:api` ne l'incluent.

## Tests

Vitest sur les paquets TS purs et `apps/web`, pytest sur `apps/api` et `apps/tws-agent`
(`FakeIB`), Playwright en bout en bout. **Un test doit échouer si le comportement change**,
pas juste couvrir des lignes. `apps/web` teste sur `fake-indexeddb` avec un ledger semé en
base, jamais en moquant les hooks. `coverage` : tests écrits à la main.

## VPS (sous-projet 3)

VPS OVH. Un seul Traefik pour tout le VPS, sur un réseau Docker externe partagé, une pile
Compose par application, une instance PostgreSQL par application. ufw : `deny incoming`, seuls
80, 443 et 2002 (SSH) ouverts. Le nom du réseau externe Traefik est à lire sur le VPS au moment
du déploiement. L'ancienne topologie (TWS tunnelé en SSH vers le VPS, le pont TWS sur l'hôte)
disparaît : l'agent tourne sur la machine de l'utilisateur, jamais sur le VPS.

`deploy/traefik/` installe ce Traefik unique : c'est de l'**infrastructure du VPS, pas de
l'application**. Il vit dans ce dépôt parce que cette application est la première occupante
du VPS et que Traefik n'y existait pas encore ; il déménagera dans un dépôt à part dès
qu'une deuxième application s'y installera. Procédure complète, tracée commande par commande,
dans `docs/deploiement-vps.md`. Les images Docker (`web`, `api`) se construisent et la pile
Compose valide, mais **le site n'a jamais répondu en HTTPS** : la mise en ligne réelle
attend un accès SSH, le nom de domaine, le nom du réseau Traefik et une source de clone
atteignable depuis le VPS — quatre informations que seul l'utilisateur peut fournir, et
qu'aucun fichier versionné ne doit porter (le nom de domaine en particulier). L'image `web`
construit aussi la roue de l'agent et la sert sous `/agent/` : un utilisateur n'a besoin que
d'`uv` et du site pour installer l'agent, jamais d'un accès direct à ce dépôt.
