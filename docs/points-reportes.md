# Points reportés

Dette connue et décisions différées, par sous-projet d'origine. Chaque entrée a été vue en
revue, jugée non bloquante, et reportée délibérément. À relire au début du sous-projet qui
la reprend.

---

## Avant la publication du dépôt sur une forge

Décidé au brainstorming du sous-projet 4 : le dépôt sera public. Tout doit être traité avant la
première poussée.

**Nettoyé le 2026-09-17** (branche `nettoyage-donnees`) : plus aucun identifiant de compte, solde,
montant, conid, nom de société ni ticker de position réelle dans les fichiers courants — les
exemples tirés des comptes sont remplacés par des valeurs inventées de même forme (tickers
`ZX…`, conids `9000001…`), arithmétique conservée. `anonymize-statement.mjs` n'applique plus de
facteur d'échelle publié, et aucun des deux anonymiseurs n'interpole plus entre le minimum et le
maximum réels : montants, prix et strikes passent par une correspondance monotone entre bornes
fixes, et le Cash Report de chaque relevé est recalculé depuis ses transactions anonymisées.

- **Les corpus anonymisés gardent les quantités, les dates et l'ordre des montants réels du
  compte**, par décision du propriétaire (option « A », 2026-09-17). `flex_journals_corpus.xml`
  (sous-projet 5) et `statement_ca_corpus_*.htm` (sous-projet 7) exigent une correspondance
  additive des quantités pour leur oracle de réconciliation ; toute correspondance additive est
  linéaire, donc inversible. Les montants ne sont plus récupérables, mais le calendrier de trading
  exact, les tailles de position, les ratios et dates des opérations sur titres — de quoi deviner
  un ticker par recoupement public — le restent. Les dividendes par action écrits en toutes
  lettres dans les descriptions des relevés sont eux aussi réels.
- **L'historique git a été remplacé le 2026-09-17 par un commit unique**, l'état nettoyé : les
  versions antérieures portaient l'identifiant de compte, des montants et tickers réels, des
  fixtures réversibles et l'oracle Python de la couverture. L'ancien historique survit
  seulement dans une sauvegarde locale hors du dépôt, à ne jamais pousser sur une forge.
- **L'intégration continue**, écartée faute de forge, redevient possible. À rouvrir à part.
- **La règle « aucun nom de domaine dans un fichier versionné » devient une protection
  réelle**, plus seulement une convention : la relire avant publication, `deploy/` compris.

---

## Reporté par les sous-projets 3 et 4

- **`SourcesPage.handleFile` attrape désormais les rejets**, mais le seul chemin réellement
  possible aujourd'hui est un échec Dexie. L'agent n'emprunte pas ce chemin : la troisième
  source n'a rien changé ici. À revoir si une quatrième source existe un jour.
- ~~**`db/profile.ts` : le cache `opened` n'est jamais purgé** des profils qui ne sont plus
  utilisés dans l'onglet (changement d'utilisateur répété, ou un perdant de la course
  d'adoption qui referme sa propre instance sans jamais la mettre en cache). Accumulation de
  connexions Dexie ouvertes, jamais de fuite de données.~~ — **sans objet depuis le
  sous-projet 25** (2026-09-21) : `apps/web/src/db/profile.ts` est supprimé, la base locale
  appartient au navigateur et non à un compte — une seule base `ib-analyzer` par origine,
  connectée ou non. Ni profil par utilisateur, ni adoption, ni cache à purger.
- ~~**`DbProvider` ne retente pas automatiquement** après un échec d'ouverture ou d'adoption : le
  repli sur le profil par défaut (`apps/web/src/db/DbProvider.tsx`) est sûr et visible, mais
  définitif jusqu'au prochain changement de session (connexion, déconnexion).~~ — **sans objet
  depuis le sous-projet 25** (2026-09-21) : `DbProvider` ne lit plus la session et n'ouvre plus
  rien ; il sert la base unique du navigateur, donc il n'y a plus d'échec à retenter.
- ~~**Deux utilisateurs *différents* adoptant le profil anonyme en même temps obtiennent chacun
  une copie complète** (`apps/web/src/db/profile.ts`, `adoptDefaultProfile`) : le verrou posé
  à la tâche 13 ferme la course entre deux appels qui visent la **même** base cible (deux
  onglets, même utilisateur), mais `targetName` est dérivé de `userId` — deux comptes
  distincts se connectant pour la première fois sur le même navigateur à quelques secondes
  d'écart ciblent des bases différentes et peuvent chacun lire la totalité du profil anonyme
  avant que l'un des deux ne le supprime. Duplication de données entre utilisateurs, jamais
  de perte : chacun repart avec sa propre copie de ce qui existait avant que quiconque ne se
  connecte. Mordra le jour où deux personnes se créent effectivement un compte à quelques
  secondes d'intervalle sur un poste partagé — comportement préexistant à la tâche 13, mais
  devenu atteignable seulement avec le multi-utilisateur du sous-projet 3.~~ — **sans objet depuis le
  sous-projet 25** (2026-09-21) : `apps/web/src/db/profile.ts` est supprimé, la base locale
  appartient au navigateur et non à un compte — une seule base `ib-analyzer` par origine,
  connectée ou non. Ni profil par utilisateur, ni adoption, ni cache à purger.
- ~~**Fenêtre résiduelle à la première connexion seulement** (`apps/web/src/flex/useFlexAutoSync.ts`) :
  entre la fermeture de la base par défaut par `adoptDefaultProfile` et le
  moment où `useDb()` cesse de la rendre, un déclenchement automatique de synchro tombant
  exactement là écrit dans une base sur le point de disparaître ; le `void (async () => …)()`
  qui lance la synchro n'a pas de `.catch`. Se rattrape au montage suivant (le profil adopté
  n'a pas de `lastFlexSyncAt`, la synchro repart), mais silencieusement.~~ — **sans objet depuis le
  sous-projet 25** (2026-09-21) : `apps/web/src/db/profile.ts` est supprimé, la base locale
  appartient au navigateur et non à un compte — une seule base `ib-analyzer` par origine,
  connectée ou non. Ni profil par utilisateur, ni adoption, ni cache à purger.
  Le `void (async () => …)()` sans `.catch` de `useFlexAutoSync`, lui, reste tel quel : c'est
  la même classe de dette que celle de l'agent, juste en dessous.
- **Même classe de dette côté agent** (sous-projet 4) : `apps/web/src/agent/useAgentSync.ts`
  lance `syncAgent` depuis `tick()` via `void tick()`, sans `.catch` ; un échec Dexie
  imprévu (pas un des codes `AgentSyncCode` normaux, qui sont déjà couverts) devient un
  `unhandledrejection` de console et interrompt la reprogrammation du minuteur au lieu de
  s'afficher en badge. `SourcesPage.tsx`'s `AgentCard.handleSave` a le même défaut : `else
  throw e` dans un gestionnaire `onSubmit` asynchrone n'a personne pour l'attraper.
- **Aucune réinitialisation de mot de passe en autonomie** : l'administrateur recrée une
  invitation pour tout compte bloqué. Devient gênant dès le premier utilisateur qui n'est pas
  l'auteur du dépôt.
- **Le calendrier de la boucle de synchro est recopié à la main dans deux langages.**
  `apps/web/src/flex/sync.ts` (1,5 s avant le premier `get-statement`, 7 s entre deux, douze
  tentatives) et `apps/api/tests/test_flex_throttling.py` portent les mêmes trois nombres,
  reliés par un commentaire de part et d'autre. Le test attrape désormais une cadence trop
  rapide — c'est ce qui manquait — mais il ne peut pas attraper un `sync.ts` modifié sans que
  le test le soit : il rejouerait alors sagement l'ancien calendrier. Un export du calendrier
  lu par les deux côtés fermerait le dernier interstice.
- **`e2e/**` et `apps/web/playwright.config.ts` sont hors du périmètre de `pnpm typecheck`** :
  une régression de type n'y est visible qu'à l'exécution des tests bout en bout, jamais à
  `pnpm check`. Couplage d'ordre implicite entre `auth.spec.ts` et `sync.spec.ts` observé au
  passage.
- **La vérification de déconnexion d'`auth.spec.ts` interroge la session serveur juste après
  le clic**, sans attendre la fin du `DELETE /auth/session` déclenché en fire-and-forget par
  `allauth.ts` : course étroite entre l'assertion et la requête, jamais observée sur plus de
  30 campagnes complètes, mais non fermée. Et même quand elle passe, l'assertion ne prouve
  que le départ de la session côté serveur, pas que l'interface a réagi au clic. Mordra le
  jour où ce test devient instable sous une charge CI plus lourde.
- **Aucune sauvegarde de PostgreSQL sur le VPS.** Le seul contenu irremplaçable est la table
  des utilisateurs (comptes, mots de passe hachés, secrets TOTP) ; les données de
  portefeuille n'y sont pas, par construction (§7.1). À poser au moment de la mise en ligne
  réelle (tâche 10, parquée).
- **La marche arrière de `core/migrations/0003_cache_table.py` code en dur
  `DROP TABLE IF EXISTS django_cache`** alors que la marche avant appelle `createcachetable`,
  qui lit `settings.CACHES["default"]["LOCATION"]`. Un déploiement posant
  `DJANGO_CACHE_LOCATION` sur un autre nom verrait la marche avant créer une table et la
  marche arrière en supprimer une autre — c'est-à-dire aucune. Sans conséquence tant que la
  variable n'est pas posée, et le `IF EXISTS` fait que rien n'échoue bruyamment ; c'est
  précisément ce qui le rend silencieux.
- **`deploy/traefik/` vit dans ce dépôt** faute d'un deuxième occupant du VPS ; déménagera
  dans un dépôt à part à l'arrivée d'une deuxième application.
- **`traefik:v3.3` (`deploy/traefik/docker-compose.yml`) est provisoire, pas un choix.** La
  ligne 3.7.x existe déjà ; la décision prise au sous-projet 3 était de constater la version
  courante au moment du déploiement, lequel est parqué. Sans cette ligne, le premier lecteur
  prendra `v3.3` pour une version retenue délibérément.
- **`SimpleRateThrottle` garde son état par requête sur une instance partagée.**
  `apps/api/ib/api.py` construit `FLEX_THROTTLE` une seule fois à l'import, et
  `allow_request` écrit `self.key`, `self.history` et `self.now` sur cette instance unique.
  Inerte aujourd'hui : le `CMD` du `apps/api/Dockerfile` lance gunicorn avec `--workers 3` et
  aucun `--threads`, donc le worker `sync` par défaut, qui traite une requête à la fois par
  processus. **Ajouter `--threads` désactiverait silencieusement le rate limiting** : deux
  requêtes concurrentes dans le même processus s'écraseraient mutuellement ces trois
  attributs. Aucun test ne le verrait — c'est le pire des défauts possibles à cet endroit.
  Avertissement contre `--threads` tant qu'une instance de throttle par requête n'est pas
  construite.
- **Avertissement WhiteNoise « No directory at .../staticfiles/ »** à chaque `pnpm test:api` :
  bruit inexpliqué, présent dans toute la suite pytest depuis la tâche 1. À faire taire
  délibérément ou à expliquer.
- **`django-ninja` et `django-allauth[mfa]` sans borne haute.** Le passage 1.3 → 1.7 de
  django-ninja a justement changé un défaut de sécurité (CSRF devenu un défaut par
  authentificateur plutôt qu'un paramètre de `NinjaAPI()`) ; deux tests d'`apps/api`
  dépendent en outre de symboles `internal` d'allauth. Un échec serait bruyant (`ImportError`
  ou test cassé), pas silencieux, mais une borne haute reste plus sûre.
- **Consulter les données live depuis un autre appareil que celui qui tourne l'agent** reste
  hors de portée (spec fondateur §13) : cela demanderait un relais par le serveur, exclu comme
  décision fondatrice.
- **Un TWS gérant plusieurs comptes n'est pas traité au-delà du minimum** : l'agent rend la
  liste que TWS lui donne, et le navigateur refuse (`account-mismatch`) dès que cette liste
  n'est pas exactement le compte affiché seul (amendement du 6 septembre 2026, revue de
  branche finale — la vérification était initialement une appartenance, ce qui laissait
  fusionner silencieusement les comptes d'un TWS qui en gère plusieurs). Rien de plus — pas de
  sélection du compte voulu parmi plusieurs, l'utilisateur reste sur un TWS par compte.
- **L'agent ne se lance pas tout seul.** Pas de service système, pas de démarrage automatique
  à l'ouverture de session : l'utilisateur le relance à la main après chaque redémarrage.
- **Les dividendes du jour n'apparaissent pas dans les exécutions intraday** ; ils
  n'arrivent qu'avec la synchro Flex du lendemain matin. Les assignations et exercices, eux,
  sont rendus par `reqExecutions`, sans commission, à l'heure où IB les traite le soir :
  corrigé au sous-projet 18, qui fait posséder à Flex ses jours entiers.
- Et tout ce que la revue de branche du sous-projet 4 aura relevé.

---

## Reporté par le sous-projet 5

- **La colonne `Code` du relevé HTML (`A`, `Ep`, `Ex`) n'est pas lue** : l'inférence par la
  forme de la transaction (prix 0, commission nulle, livraison ou non) suffit sur le corpus
  mesuré. À reprendre si l'inférence se trompe un jour sur un cas non encore observé.
- **Les statistiques ne convertissent aucune devise** : une entrée par devise présente dans
  les lignes de la stratégie, jamais agrégée en une seule.
- **Les journaux n'ont ni filtre de période ou de statut, ni tri par colonne, ni export.**
  Seul le filtre texte sur le ticker existe, comme sur Positions.
- **L'anonymiseur ne préserve pas `proceeds = −quantité × prix`** : chaque montant d'une
  ligne `STK`/`OPT` est mappé indépendamment, sauf le prix de livraison aligné sur le strike
  mappé (§8 du spec du sous-projet 5). Le corpus des journaux vérifie donc les quantités,
  jamais la cohérence interne des montants d'une ligne.
- **`flex_activity_sample.xml` n'est pas régénérée avec les amendements de l'anonymiseur**
  (strikes mappés par rang, prix de livraison aligné).
- **Une combinaison de huit jambes au même instant (deux condors ouverts d'un coup, même
  échéance) atterrit dans Others** : seule la forme à exactement quatre jambes est reconnue
  comme condor (`packages/ledger/src/journals/condor.ts`).

Trouvés en revue des tâches 1 à 11, non corrigés :

- **`sharesContract`, `formatExpiry` et `formatStrike` (`journals/contract.ts`) n'ont pas de
  test unitaire direct** : ils ne sont exercés qu'indirectement, via `formatContractLabel` et
  `formatCondorLabel`.
- **`packages/ledger/src/journals/replay.ts` porte cinq responsabilités** (filtrage et
  regroupement, réserves de livraison, clôtures d'options, livraisons d'actions,
  finalisation). Il faisait 323 lignes quand ce point a été soulevé la première fois, il en
  fait 398 maintenant ; extraire la machinerie de livraison (`DeliveryPool`, `buildPools`,
  `takeDelivery`, `deliverShares`) dans son propre module coûte moins cher maintenant que plus
  tard. Ce point a vieilli en devenant *plus* pertinent, pas moins.
- **`splitShortCall` (`classify.ts`) saute son filtre `nonEmpty` sur les branches `n === aw` et
  `n === lw`** (une part de quantité nulle est possible en principe, inatteignable
  aujourd'hui) ; aucun test unitaire ne couvre l'égalité `n === aw === lw`, ni l'arbitrage
  quand `avg === null` avec les deux capacités positives ; et `Math.floor` s'applique à la
  *somme* de `remaining / ratio` plutôt qu'à chaque lot.
- **`share` et `net` (`packages/ledger/src/journals/rows.ts`) ne gardent pas `whole === 0`** :
  une division par zéro rendrait `NaN`. Défensif seulement — la façon dont les lots sont
  construits ne produit jamais un lot de quantité nulle.
- **`LotBook.positions()` (`book.ts`) peut rendre un agrégat de quantité nulle** si deux lots
  de signes opposés sur le même contrat étaient ouverts en même temps. N'arrive pas
  aujourd'hui : les appelants ferment toujours avant de rouvrir.
- **`expect.closeTo` est utilisé sans précision explicite** dans
  `packages/ledger/src/journals/replay.test.ts:60` (`openTotal` et `openCommission`) : la
  précision par défaut est de deux chiffres (environ 0,005), alors que le bruit flottant réel
  du prorata est de l'ordre de 1e-15. Les deux assertions mordent donc bien moins qu'elles
  n'en ont l'air.
- **Une clôture en forme de règlement qui ne ferme qu'une partie d'une position ne marque pas
  son reliquat `orphan`**, bien qu'une ouverture à prix 0 ne soit jamais une vraie ouverture.
- **`takeDelivery` (`replay.ts`) initialise `amount` et `commission` à `0`**, pas à `null`,
  contre la règle « une valeur absente reste `null` » — aucun chemin atteignable ne produit
  aujourd'hui ce cas.
- **`net()` (`rows.ts`) traite une commission `null` comme nulle** : « commission inconnue »
  et « aucune commission » sont donc indiscernables en aval. Même défaut de l'autre côté de la
  livraison : la branche `null` d'`addShare` (`replay.ts`) n'est exercée par aucun test, alors
  que la propagation du `null` à travers une livraison est exactement ce que dit la règle
  « une valeur absente reste `null` ».
- **`DeliveryPool.shares` (`replay.ts`) n'est plus lu depuis le correctif d'allocation
  gloutonne** : un champ resté sans lecteur.
- **`averageAssignmentPrice` (`classify.ts`) filtre sur `assigned`**, vrai aussi pour des
  actions livrées par un *exercice* — alors que le §3.4 du spec du sous-projet 5 nomme ce
  prix moyen « d'assignation » seulement. Le code garde numérateur et dénominateur sur une
  seule population, ce qui est cohérent, mais la phrase du spec et le code divergent sur le
  nom.
- **Un achat LEAPS et un call vendu d'échéance différente au même instant ne sont couverts
  que parce que le groupe LEAPS est parcouru en premier** dans le classement (§3.4) ;
  inverser l'ordre des deux transactions dans la source classerait le call autrement. Le spec
  est muet sur ce cas d'égalité.
- **Deux gardes défensives inatteignables dans `condor.ts`** : une somme de longueurs de
  `pick(...)` forcée à 4 par le tiroir aux pigeons, et un repli `?? "buyback"` sur une branche
  où l'événement est toujours renseigné. Elles protègent contre un état qui ne peut pas se
  produire.
- **Une jambe de condor remplie en plusieurs exécutions au même instant** formerait un groupe
  de plus de quatre transactions et retomberait en Others.
- **La branche par défaut de `contributions()` (`stats.ts`) serait atteignable pour une ligne
  `settlement`** si `settlementRow` ne forçait pas `strategy: "others"`, et Others n'a pas de
  statistiques : un couplage entre deux fichiers que `stats.ts` ne mentionne nulle part.
- **Aucun test n'ouvre le sélecteur de devise des statistiques pour en choisir une seconde**,
  et aucun n'exerce la note « n montants absents ignorés » ; le dépôt n'a par ailleurs aucun
  test d'interaction sur un `Select` base-ui. **`MonthlyChart` (`StatsPage.tsx`) n'a pas de
  garde explicite pour un panier de devise dont le tableau `months` est vide** : ECharts rend
  un graphique vide plutôt que de planter, c'est donc un cas non testé, pas un défaut.
- **Le `min-w-0` ajouté à `SidebarInset` (`packages/ui/src/components/ui/sidebar.tsx`) n'est
  gardé par aucun test committé.**
- **Onze avertissements oxlint sur la branche** (`pnpm lint`, vérifié le 2026-09-07) : le
  chiffre de neuf noté au sous-projet 3 (« Sans échéance ») a suivi le sous-projet 4, qui a
  ajouté deux avertissements `globals` dans `apps/web/src/agent/useAgentSync.test.tsx`,
  jumeaux de ceux déjà notés pour `useFlexAutoSync.test.tsx`. Aucun nouveau depuis ce
  sous-projet 5. Ce sont des avertissements, `pnpm lint` sort en 0.
- **`Lot.deliveredBy` (`journals/book.ts`) est écrit dans `replay.ts` et lu nulle part** :
  vestige de la conception qui a précédé `ReplayContext.delivered`, qui porte aujourd'hui la
  règle « un put reste en cours tant que ses actions ne sont pas vendues ». Deux mécanismes
  ont été construits, un seul a survécu, le champ est resté.
- **`reconcile()` (`journals/reconcile.ts`) rend `orphans: []`, que `replay.ts` écrase
  inconditionnellement** : le champ est mort à l'intérieur de cette fonction, seul le type de
  retour l'impose encore.
- **Quand une clôture en forme de règlement nomme plus de contrats que le carnet n'en détient**
  (un historique tronqué, la forme de `alpha`), le `ratio = taken / contracts` par
  réclamant utilise le compte *clôturé* : le ratio est donc gonflé et la capacité de
  couverture Wheel du lot livré sous-estimée. Inatteignable sur un historique complet.
- **`ReconciliationCard` rend son état ambre avec un badge `0` et « 0 écarts… » quand
  `differences` est vide mais `orphans` ne l'est pas.** Le §7.2 du spec traite les orphelins
  comme un ajout à l'état « différences » plutôt que comme un état à part, d'où une formulation
  étrange dans cette combinaison.
- **Le test « keeps the legs in the reconciliation as ordinary contracts » de `condor.test.ts`**
  affirme le nombre de lignes et les quantités des jambes, mais ne touche jamais
  `report.reconciliation` : le nom promet une vérification que le test ne fait pas (le
  comportement est couvert par l'oracle).
- Et tout ce que la revue de branche aura relevé.

## Reporté par les relevés conservés

- ~~**La sauvegarde chiffrée du sous-projet 6 doit décider du sort de `db.statements`.**~~ —
  **fermé par le sous-projet 25** (2026-09-21) : les relevés sont dans le paquet, qui est
  compressé en gzip avant chiffrement. Une sauvegarde sans eux rendrait une base non
  reconstructible.
- **Les relevés importés avant la version 4 du schéma ne sont pas récupérables** : le store
  démarre vide sur une base existante et se remplit au prochain import. Leurs lignes vivent
  donc dans le ledger sans fichier pour les réécrire ; une reconstruction les perdrait, ce
  contre quoi la confirmation de « Relire les relevés » (`countOrphanRows`) est la seule
  garde. Tant qu'aucun relevé n'est conservé, le bouton reste désactivé.
- **Aucun plafond de taille ni compression sur `db.statements`.** Mesuré à 200 ko par relevé
  réel, plafond estimé à 500 ko ; le quota d'IndexedDB n'est jamais interrogé et un
  dépassement remonterait comme une erreur d'import brute.
- **`useStatements` matérialise le HTML de tous les relevés du compte** pour n'en afficher
  que la taille, déjà mesurée à l'écriture (`StatementRecord.bytes`). Dexie ne projette pas ;
  séparer les textes dans une table à part serait la vraie réponse, si le nombre de relevés
  devenait grand.
- **Le verrou d'import est par onglet** (`db/importLock.ts`, en mémoire). Une relecture lit
  les relevés conservés hors transaction : un import lancé dans un autre onglet entre cette
  lecture et l'écriture verrait ses lignes balayées alors que son fichier reste conservé.
  Limitation préexistante d'`importLock`, élargie ici de la durée du plan à celle de
  l'analyse.

---

## Reporté par le sous-projet 7

- **La branche Flex du rejeu n'est vérifiée qu'à moitié par des données réelles** : le Flex de
  alpha (2026-09-09) porte enfin une opération sur titres, une fusion 1 pour 1 sans espèces
  (ZXAG.OLD → ZXAF), et `identity.private.test.ts` la rejoue. Mais le fichier ne remonte pas à
  l'ouverture du compte, donc `applyConversion` n'y trouve aucun lot à déplacer : c'est la
  lecture et l'appariement qui sont prouvés, pas la conversion elle-même. La branche
  `applyMixedMerger` reste, elle, sans donnée réelle côté Flex.
- **L'ajustement d'un contrat d'option par un split n'est pas traité** : strike et
  multiplicateur modifiés, aucun cas dans le corpus mesuré, logique différente de celle
  d'une action. La règle 7 réunit désormais l'option ajustée et celle qu'elle prolonge sous
  un seul `conid` (`ZXAK  260417C00012500` puis `ZXAK1 260417C00012500`), ce qui referme la
  réconciliation ; mais le sous-jacent livré n'est plus 100 actions, et le moteur de
  couverture l'ignore toujours.
- **Un split du sous-jacent — un ratio différent de 1 — ne renomme toujours pas les options
  qui le suivent** : la règle 7 ne réunit une option que sous une orthographe qui la nomme
  *elle*, la forme OSI empaquetée, et la règle 9 (sous-projet 10) ne greffe l'ancien nom que
  sur une conversion de ratio exactement 1. Une option nommée par son sous-jacent — ce que
  donnent l'agent et les relevés — reste sous l'ancien nom quand un vrai split ou une fusion en
  titres renomme ce sous-jacent, et sa couverture en actions ne la retrouve pas. Le cas d'une
  conversion 1 pour 1 est fermé depuis le sous-projet 10 ; celui où IB respelle l'option
  elle-même l'est depuis le 2026-09-09.
- **La couverture et les livraisons apparient une option à son sous-jacent par égalité de
  ticker brute** (`poolKey` et `isUnclaimedDelivery` dans `journals/replay.ts`, `lotsOf` dans
  `journals/classify.ts`), alors que la règle 7 réécrit la racine d'une option pour toute son
  histoire. Une option dont IB a changé la racine sort donc du vivier de son sous-jacent :
  observé sur alpha, où le long call `ZXAK1 260417C00012500` ne couvre plus les shorts
  `ZXAK  260410C00006000` qu'il couvrait, lesquels passent du journal LEAPS à Autres. Défendable
  ici — le contrat ajusté ne livre plus 100 actions ZXAK, donc il n'en est plus vraiment la
  couverture — mais la même mécanique lirait une assignation comme une expiration si la
  livraison d'actions tombait sous l'ancienne racine, sans qu'`isUnclaimedDelivery` ne la
  signale, puisqu'il compare lui aussi des tickers. Non observé sur les données réelles
  (50 assignations avant comme après). Le correctif propre passe par un appariement qui
  interroge la table d'identité des deux côtés, jamais par une canonicalisation datée, qui
  rescinderait les lots.
- **Une ambiguïté entre deux options émet un `IdentityIssue` illisible** : deux `conid` qui
  porteraient la même orthographe empaquetée ne peuvent être séparés par aucune opération sur
  titres — les jambes d'un événement nomment des actions, jamais des options —, donc la
  règle 6 s'applique et la page Sources affiche « `ZXAK  260417C00012500` nomme 2 contrats ».
  Le repli est sûr, le message inactionnable. Non observé.
- **Une opération sur titres antérieure au plus ancien relevé importé reste invisible**, et
  un compte qui n'importe que du Flex n'a ni Contract Information ni, pour ses trades
  antérieurs à la case cochée, de `conid` : les renommages sans événement y restent ouverts.
- **`mergeContractRecords` relit tous les contrats du compte à chaque import** : correct,
  et sans conséquence tant qu'un compte compte des dizaines de contrats et non des milliers.
- **`CloseEvent` n'est affiché nulle part dans l'application** : la colonne « Commentaire »
  explique désormais la reprise d'actions et le caractère nu d'un call par un champ à part
  (`JournalRow.note`), mais `row.event` reste sans consommateur — aucun composant ne le lit,
  si bien qu'une sortie provoquée par une opération sur titres ou par une reprise d'actions
  reste indiscernable de n'importe quelle autre clôture à l'écran. Les événements
  `corporate_action`, `expired` et `exercised` n'ont toujours pas de libellé, faute de code
  de note.
- **Six des sept tickers ambigus du corpus ne permettent de distinguer une résolution de
  date correcte d'une résolution cassée, sous aucun fenêtrage** : leur conid « après » ne
  porte qu'un seul alias, et l'alias non-`.OLD` du conid « avant » l'emporte toujours dans
  la règle de priorité de `canonicalOf`. Un seul ticker du corpus prouve effectivement ce
  mécanisme ; une régression qui ne toucherait que les six autres passerait inaperçue.
- **Dans `journals/replay.ts`, la ligne de repli après le balayage final des événements est
  devenue inatteignable** depuis que la capture de la borne a été déplacée ; inoffensif, à
  nettoyer un jour.
- **Deux gardes d'`applyMixedMerger` — une base totale nulle ou négative, et un `f` hors de
  `[0, 1]` — n'ont pas de test dédié.**
- **`parseIdentities` (`flex.ts`) parcourt `el.children` sans filtrer par nom de balise**,
  contrairement à tous les autres lecteurs de section de ce fichier. Sans conséquence
  aujourd'hui sur les quatre sections qu'elle lit ; l'invariant tient par accident, pas par
  construction.
- **`anonymize-statement.mjs` applique le facteur d'échelle monétaire aux cellules
  suffixées `%`**, ce qui produit des pourcentages non plausibles dans des sections qu'aucun
  parseur ne lit ; et `collect()` n'a pas de garde pour un CUSIP nu, sans parenthèses, dans
  la colonne `Security ID`.
- **La carte Sources recalcule son compte d'alias à chaque rendu, sans mémoïsation.**
- **Le commentaire de `mergeContractRecords` (`apps/web/src/db/contracts.ts`) annonce qu'elle
  ne rend que les enregistrements modifiés ; elle rend tous ceux que les identités entrantes
  nomment**, changés ou non. Conséquence : chaque passe de l'agent réécrit l'ensemble de ses
  contrats, ce qui réveille la requête vive et relance le moteur de journaux pour rien.
- **`ContractIdentityCard` monte `useJournals`**, donc un rejeu complet du ledger, sur une
  page qui n'a besoin que de la liste des diagnostics.
- **L'`export *` de `journals/index.ts` publie `applyConversion`, `applyMixedMerger` et
  `withoutOldSuffix` dans l'API de `@ib/ledger`** : seuls les types et
  `pairCorporateActions` / `buildIdentities` étaient destinés à sortir du paquet.
- **`corporate.ts` traite un `amount` négatif comme une fusion mixte** (`cash: out.amount ? …`),
  que la garde `f < 0` écarte ensuite sans le moindre diagnostic — contrairement au cas du
  `realizedPnl` manquant, juste à côté, qui se plaint.
- **La page Historique affiche désormais un ticker `.OLD` là où elle affichait le nom nu**,
  sur un relevé ré-importé : voulu et testé, mais visible par l'utilisateur et documenté
  nulle part.
- **La règle 8 greffe l'alias d'une jambe sur *toutes* les classes qui déclarent son ISIN.**
  Deux `conid` partageant un ISIN — une même valeur cotée sur deux places, cas jamais observé
  dans les corpus mesurés — recevraient donc le même alias, rendant le ticker ambigu à trois
  classes et le laissant tel quel avec un `ambiguous-unresolved`. La dégradation va dans le
  bon sens (on renonce, on ne fusionne pas deux positions réelles), mais elle est silencieuse
  quant à sa cause : le diagnostic parlerait d'un ticker ambigu là où le vrai problème serait
  un ISIN partagé.

---

## Reporté par la reprise d'actions de la wheel (sous-projet 8)

- **Des actions achetées au même instant qu'un call vendu ne le couvrent pas** :
  `classifyOpenings` tourne avant que la boucle des actions de `replayGroup` n'ouvre leurs
  lots. Une assignation du même instant, elle, est visible, `deliverShares` tournant avant.
  Asymétrie antérieure à ce sous-projet, que la reprise rend seulement plus visible.
- **Un call vendu à nu ne se reclasse pas** si des actions sont achetées ensuite : voulu,
  la classification se faisant une fois à la vente.
- **Une reprise réalise une plus-value latente dans une stratégie à statistiques.** Quand les
  actions reprises venaient de l'exercice d'un long call LEAPS, la ligne close en `leaps`
  porte un P/L non nul daté de la **vente du call**, marqué au strike, alors qu'aucun cash
  n'a bougé à cet instant. C'est le comportement retenu — la stratégie qui détenait les
  actions garde son gain —, mais la statistique mensuelle LEAPS montre alors un gain sans
  encaissement.
- **`SHARE_EPSILON` (`packages/ledger/src/journals/takeover.ts`) n'a pas de test qui vise un
  résidu flottant précis.** Elle garde deux comparaisons : dans `takeOverShares`, `if (take <=
  SHARE_EPSILON) continue` évite d'émettre une ligne `integrated` et un lot Wheel fantômes
  pour un résidu de prise nul ; dans `takeOverLot`, `if (rest > 0 && rest <= SHARE_EPSILON)`
  évite d'ouvrir un reliquat `T` qui ne se clôturerait jamais. Garde-fou défensif ; reproduire
  le cas de façon déterministe aurait été fragile.
- **Aucun corpus anonymisé ne contient de reprise** : l'oracle beta n'a pas une seule
  ligne en « others », donc pas un seul lot d'actions non assigné, et ne prouve donc que la
  non-régression. Le comportement neuf n'est couvert que par les tests unitaires de
  `takeover.test.ts` et par une vérification manuelle sur `private/`. Piste concrète : le
  Flex de l'autre compte disponible en local porte 231 lignes d'actions contre 13 pour le
  corpus actuel, l'outillage d'anonymisation existe déjà
  (`packages/ib-parsers/scripts/anonymize-flex.mjs --full`), et un second corpus produit de
  la même façon que celui des journaux — rejoué contre son propre snapshot, zéro écart —
  couvrirait des dizaines de reprises réelles, y compris sur lot orphelin.
- **La note `nakedCall` dit « ni actions ni LEAPS pour le couvrir », ce qui est inexact quand
  des actions existent mais sont déjà engagées derrière un autre call encore ouvert** :
  `wheelCapacity` soustrait `coveredCalls`, donc un call classé nu peut très bien avoir des
  actions au carnet, seulement aucune de libre. Le libellé, approuvé mot pour mot par
  l'utilisateur, n'est pas changé ici ; une formulation plus juste serait de dire qu'aucune
  action *disponible* ne le couvre, plutôt qu'aucune action tout court.

---

## Reporté par le sous-projet 9 (application complète avec un seul fichier)

- **Un relevé seul qui porte des corrections antidatées montre un écart de cash au début.** IB
  compte une correction tardive (retenue à la source, par exemple) dans le Cash Report de la
  période qui la rapporte, mais la date du jour qu'elle corrige ; la mesure « à la veille du point
  de début » (spec §5) la range donc avant le début. Importé seul, le relevé 2026 de alpha porte
  deux lignes d'impôt de ce genre, dont celle du 2025-02-21 déjà connue côté Flex : la carte
  « Cohérence du cash » montre un écart USD égal à ces lignes. Ni les ignorer à l'import (le
  relevé précédent ne les porte pas, le cumul perdrait ces montants) ni mesurer avant la
  première ligne (les lignes Flex antérieures au relevé fausseraient alors relevé + Flex) ne
  corrige le cas ; la vraie réponse demanderait la date de comptabilisation, que le relevé ne
  donne pas. Figé par `alpha.private.test.ts` (l'écart doit égaler ces lignes à la tolérance
  près, et au moins une devise doit être en écart).
- **Un relevé qui finit après le dernier jour Flex**, importé ou relu alors que des lignes Flex
  sont en base, n'écrit pas ses derniers jours alors que son point de fin les compte : la carte
  montre un écart jusqu'à la synchro Flex suivante.
- **Supprimer le relevé qui avait remplacé un point de cash ou le snapshot Flex ne restaure pas
  ce qu'il avait remplacé.** Le point de cash Flex écrasé revient à la synchro Flex suivante ;
  entre-temps la carte dit « début non vérifié ». Le snapshot, lui, est remplacé par celui du
  relevé restant le plus récent, fût-il bien plus ancien que le snapshot Flex d'avant (Positions
  et Dashboard montrent alors un portefeuille daté de ce relevé), ou supprimé s'il n'en reste
  aucun. Conforme au §4.1 du spec ; préférer un Positions vide à un snapshot ancien serait une
  décision à prendre.
- **Un compte sans aucune position dont le relevé omet la section *Open Positions*** n'a pas de
  snapshot : Positions reste à l'état vide au lieu d'afficher un portefeuille vide.
- **« Relire les relevés » peut remplacer un snapshot Flex du même jour** par celui du relevé :
  même clôture, `conid` vides. Aucun code ne lit `Position.conid` aujourd'hui.
- **Les fixtures anonymisées ont un EUR incohérent** : l'anonymiseur réécrit des montants EUR du
  ledger sans réécrire le Cash Report. L'oracle versionné du cash ne vérifie que l'USD.
- **Le compte rendu de purge ne chiffre ni les positions ni les points de cash** : il les nomme
  seulement, comme avant pour les positions.
- **Une devise sans aucune ligne affiche quand même un appel à l'action.** Un compte qui n'a
  jamais eu d'EUR voit « EUR : aucun Cash Report, le solde part de 0 » et l'invitation à ajouter
  le Cash Report (`CashCheckCard.tsx`), sans rien à faire. Conforme au §6.1, qui veut une ligne
  par devise de `BALANCE_CURRENCIES` ; masquer la ligne d'une devise absente du ledger serait
  plus juste.
- **Rattraper l'historique après Flex affiche « Positions ignorées » sur chaque relevé** : un
  relevé plus ancien que le snapshot Flex ne le remplace pas, et le compte rendu le dit à chaque
  fichier. Conforme au §4.1, bruyant pour l'usage normal.
- **Petites dettes relevées en revue** : `parseCashReport` et `parseCashPoints` (`flex.ts`)
  filtrent les `CashReportCurrency` presque à l'identique ; la JSDoc de
  `FlexParseResult.cashReport` ne cite pas la fenêtre non déclarée ; `rawBalanceUpTo` parcourt
  deux fois les lignes par devise et `replayStatements` refiltre la liste des points à chaque
  relevé (sans effet à ces volumes) ; `toCents` n'a que deux bornes testées ; les corps de
  transaction de `importFile.ts` et `replayStatements.ts` ne sont pas réindentés ;
  `CashCheckCard.test.tsx` n'affirme pas la variante du badge « début non vérifié » et ne montre
  jamais un écart et une devise non calée ensemble ; `seed.test.ts` ne peut pas attraper une
  erreur de calage, le point de fin de la démo égalant le solde brut par construction.

---

## Reporté par le sous-projet 10 (identité des options sans Flex)

- **La preuve de la règle 9 ne distingue pas, à elle seule, une option renommée d'une option de
  l'acquéreur aux mêmes termes.** Qu'une classe porte les termes de l'option sous la racine
  d'arrivée (`TSTC  270115C00002500`) prouve seulement qu'une classe existe à ces termes-là,
  jamais qu'elle est la continuation de l'option renommée : l'acquéreur peut avoir sa propre
  option, sans rapport avec la fusion, aux mêmes termes exactement. Une garde ferme le cas
  mesuré en revue (`hasSuffixedSibling` dans `followUnderlyingRenames`) : quand une autre classe
  porte ces mêmes termes sous une racine suffixée par l'OCC — la racine d'arrivée suivie d'un ou
  plusieurs chiffres, `TSTC1` pour `TSTC`, signe que le deliverable de l'option renommée n'est
  plus standard —, la greffe vers la classe sous la racine nue est refusée, silencieusement.
  Validé sur les données réelles de `alpha` : `alpha.private.test.ts` reste à 4/4 vert avec
  la garde en place. Le cas où l'option renommée garde, elle, exactement la racine d'arrivée —
  sans racine suffixée ni aucun autre signe distinctif — reste indiscernable ; aucune donnée
  réelle mesurée ne le porte. L'entrée ci-dessous sur la « racine suffixée côté cible » décrit le
  cas miroir, une greffe qui n'a pas lieu faute de témoin ; elle ne couvre pas celui-ci.
- **Un ratio différent de 1 ne fait pas suivre les options.** L'OCC ajuste alors le contrat —
  strike, multiplicateur ou quantité livrée —, et rien dans nos sources ne dit lequel. Aucune
  donnée réelle mesurée ne porte ce cas.
- **Une fusion avec cash ne fait pas suivre les options** : la règle 9
  (`packages/ledger/src/journals/identities.ts`, `followUnderlyingRenames`) l'écarte
  délibérément, le nouveau contrat n'étant pas la simple continuation du précédent.
- **Une racine suffixée côté cible (`KEEL1`) reste hors de portée** tant qu'aucun fichier ne
  porte l'orthographe de départ : il n'y a alors ni classe à reconnaître, ni témoin.
- **Le chaînage de deux renommages au même instant ne se résout pas.** Le tri « le plus récent
  d'abord » de `followUnderlyingRenames` rend `0` sur l'égalité et le tri est stable, donc la
  greffe du maillon le plus ancien ne trouve pas encore celle du plus récent quand les deux
  événements partagent exactement le même horodatage : sur un chaînage `AAA→BBB→CCC` au même
  instant, `BBB` résout vers `CCC` mais `AAA` reste `AAA`. Vérifié, non corrigé : irréaliste en
  données réelles (deux renommages à la milliseconde près l'un de l'autre), à surveiller plutôt
  qu'à corriger.
- **L'agent a besoin de deux passes encadrant le renommage** pour rattacher les exécutions
  passées sous l'ancien nom : une passe qui ne voit que le nom du jour ne les retrouve pas ;
  l'agent n'écrit qu'après le dernier jour Flex et ne remonte jamais le temps.
- **L'appariement couverture/livraison compare toujours des tickers bruts** (dette du
  sous-projet 7, `poolKey` et `isUnclaimedDelivery` dans `journals/replay.ts`, `lotsOf` dans
  `journals/classify.ts`) : une option renommée sort du vivier de son sous-jacent. Relevés
  seuls, le comportement devient celui de Flex, ce qui est le but de ce sous-projet, mais le
  défaut de fond reste entier.
- **L'ensemble des noms de départ de la règle 9 est plus large que « le nom porté juste avant »**
  (`followUnderlyingRenames`) : il prend tous les alias non-`.OLD` de la classe sortante. La
  garde « orthographe déjà revendiquée » contient le risque, mais chaque alias supplémentaire
  est une greffe active, pas dormante : un ancien alias d'une classe d'action fait greffer une
  orthographe d'option qui résout ensuite vers l'option d'arrivée, pas seulement une entrée
  inerte dans la table.
- **Une condition défensive redondante subsiste** dans la boucle de la règle 9 :
  `isPackedOptionSymbol` y est testé sur un alias que `namedContracts` a déjà filtré à l'entrée.
- **Les trois tests négatifs des relevés synthétiques n'assertent que sur la résolution du
  ticker** (`packages/ib-parsers/src/optionRenames.test.ts`, « refuses the graft when… »), pas
  sur le fait que l'événement a bien été formé : un futur échec d'appariement des jambes
  satisferait la même assertion.
- **Dans ce même test, l'assertion sur les lignes orphelines ne mord sur aucune des deux
  régressions visées** (« reconstructs the last statement's positions exactly ») : c'est la
  liste des écarts (`report.reconciliation.differences`) qui porte toute la détection.
- **Des trois tests neufs de l'agent, un seul est rouge avant l'implémentation**
  (`packages/ib-parsers/src/agent.test.ts`, « gives an option the packed spelling… ») ; les deux
  autres (« keeps the underlying when… », « leaves a stock and a currency pair untouched »)
  sont des garde-fous de non-régression, ce que le plan assumait.
- **Le test privé du compte réel se saute tout seul quand les fichiers réels sont absents**
  (`apps/web/src/db/alpha.private.test.ts`, `describe.skipIf`), ce qui est voulu : sur une
  machine sans eux, il ne prouve rien, et ce sont les deux relevés synthétiques qui portent la
  preuve.

---

## Reporté par le sous-projet 11 (page Consistance)

- **Changement de compte : un instant de données mêlées dans la barre de titre.** `useLiveQuery`
  (dexie-react-hooks 4.4) garde le résultat du compte précédent jusqu'à ce que la nouvelle
  requête réponde ; `useLedger`, `useSnapshot` et `useContractIdentities` répondent
  indépendamment, donc `buildJournals` peut apparier un instant le ledger de B au snapshot de A,
  et Couverture montrer le rapport de A sous le nom de B (clignotement rouge fugace). Préexistant
  sur les pages, désormais visible en permanence. Reporté : la correction touche `db/hooks.ts`
  pour toutes les pages (rendre `loading` quand le snapshot ou les lignes portent un autre
  `accountId`) ou remonte les pages (`key={scoped}` sur le fournisseur), ce qui change les
  scénarios de changement de compte testés sur Sources de données.
- **L'indicateur et la carte ne comptent pas pareil.** Avec des orphelines seules, l'indicateur
  annonce « 1 écart » (écarts + orphelines) quand `ReconciliationCard` dit « 0 écarts… » puis
  « 1 ligne d'origine inconnue ». À rapprocher du point déjà noté sur la carte (« Reporté par le
  sous-projet 5 », `ReconciliationCard` rend son état ambre avec un badge `0` quand `differences`
  est vide mais `orphans` ne l'est pas) ; harmoniser le libellé de la carte le jour où il est
  repris.
- **Aucun test des textes de chargement des indicateurs** (« Couverture : chargement… »), état
  transitoire ; les clés existent en fr et en en.
- **`corporate-actions.spec.ts` échoue à l'assertion `fr.positions.empty`, sans rapport avec ce
  sous-projet.** Une fois F1 corrigé (`exact: true` sur les sélecteurs de lien), la spec tourne
  et échoue à `await expect(page.getByText(fr.positions.empty)).toBeVisible()` (ligne 78) : après
  les trois imports de relevés HTML seuls, Positions affiche un vrai portefeuille (« Données du
  2024-12-31 », des dizaines de lignes) au lieu de son état vide. Le commentaire du test (lignes
  71-75) dit encore « le parseur de relevé n'écrit aucun snapshot », vrai au sous-projet 7 où le
  test a été écrit, faux depuis le sous-projet 9 : CLAUDE.md documente désormais qu'« un relevé
  HTML porte un snapshot à sa fin de période (Open Positions, cash USD) ». Ce sous-projet n'a
  touché ni la ligne de l'assertion ni son commentaire, seulement `exact: true` sur le clic qui la
  précède ; la vérification directe sur `main` depuis ce worktree a été refusée par l'isolation de
  session (« this command redirects git to the shared checkout via -C »), mais la chronologie
  (commentaire écrit sous-projet 7, comportement changé sous-projet 9, sous-projet 11 n'y touche
  pas) situe la cassure avant cette branche. Reporté : corriger l'assertion demanderait de choisir
  un nouvel état à vérifier (un compte qui n'importe aucun relevé avant ce point, ou l'affirmation
  du portefeuille désormais attendu), une décision de scénario plutôt qu'une correction à
  l'aveugle.

---

## Reporté par le sous-projet 12 (Historique en défilement continu)

- **La barre temporelle ne peut pas annoncer le dernier mois quand le tableau est en bas.**
  `aria-valuenow` vaut `firstVisible` (spec §3.4), et le navigateur borne le défilement à
  `total − visibleCount` : quand le mois le plus ancien compte moins de lignes que la fenêtre,
  Fin et ↓ ne font jamais annoncer ce mois par le curseur, bien qu'il soit à l'écran. Conforme
  au spec ; une valeur qui suivrait la dernière ligne visible en bas de tableau serait plus
  juste pour un lecteur d'écran.
- **Outillage : le serveur laissé par `--keep` ne survit pas à l'appel de commande dans le bac
  à sable des agents.** À la tâche 6, le serveur Vite et le script de vérification ont dû
  tourner dans le même appel. Rien à changer au driver ; le savoir évite de chercher une panne.

---

## Reporté par le sous-projet 13 (capital de la Wheel)

- **Aucun test de deux devises dont les derniers flux diffèrent.** `computeStats`
  (`packages/ledger/src/journals/stats.ts`) prolonge chaque devise jusqu'au même `lastMonth`
  global, mais aucun test ne pose une devise qui s'arrête un mois avant l'autre. Risque faible :
  une seule ligne partagée par toutes les devises fait ce prolongement.
- **Le test « still counts a put closed at the very first instant of the next month »
  (`capital.test.ts`) ne distingue pas `≥` de `>`.** Chaque `endWhen` est un instant ISO complet,
  toujours plus grand que la date nue `D` à laquelle il se compare : le test passerait avec `>`.
  À renommer ou commenter plus tard ; la règle elle-même (§2 du spec) n'est pas en cause.
- **Le filtre des tickers à exposition nulle de `capital.ts` n'est pas testé.** Il faudrait une
  ligne Wheel ouverte qui vaille 0, jamais observée en pratique.
- **`nextMonthStart` répète le passage d'année de `monthsBetween`.** Deux lignes courtes ;
  une factorisation n'apporterait rien de lisible.
- **`sectorSlices` donne `share = 0` quand toute l'exposition vaut 0.** Inatteignable : le moteur
  écarte les tickers à 0, donc une exposition non vide ne totalise jamais 0.
- **Le stub `getContext` de `apps/web/vitest.setup.ts` n'est pas gardé**, contrairement à celui
  de `matchMedia`. Sans conséquence tant que chaque test web tourne dans jsdom.
- **À 400 px, le tableau-légende des secteurs défile dans son propre conteneur** et cache Total et
  Part, les deux colonnes dont le camembert a besoin, sans aucun indice de défilement. Correction
  prévue : `hidden sm:table-cell` sur Assigné et Couverture des puts.
- ~~**Observation de spec pour l'utilisateur : le rendement de fin de mois oscille fort sur une
  Wheel.**~~ Réglé le 2026-09-12 : le rendement se mesure au pic du mois (révision du §8 du spec),
  si bien que des puts expirés le 21 et revendus le 2 ne laissent plus de mois `null`, et que les
  puts du mois entrent dans le dénominateur d'un mois qui finit sur des actions seules.
- **Observation de spec pour l'utilisateur : « Cash investi » ne diffère d'« Alloué » que du
  cumul des profits/pertes**, si bien que deux des quatre courbes de capital se confondent par
  construction. Séparer leurs étiquettes de fin (`labelLayout: shiftY`) ne sépare pas les
  courbes.
- **Quand plusieurs courbes de capital finissent près de 0, l'étiquette la plus basse tombe sur
  la ligne des mois** (`apps/web/src/lib/capitalCharts.ts`, `capitalOption`). `moveOverlap: "shiftY"`
  borne son déplacement à la hauteur du graphique, pas à celle de la zone de tracé : sur un compte
  d'un seul mois, « Cumul des profits/pertes » et « Assigné » recouvrent le libellé du mois. Les
  étiquettes restent lisibles (fond de carte) et le mois reste dans l'infobulle. Vu à la
  re-relecture de la vague de corrections, reporté plutôt qu'une seconde vague : ne touche que ce
  cas limite.
- **`.claude/skills/run-frontend/driver.mjs:183` a perdu une espace** (`const name =(route…`)
  quand la ligne a été modifiée pour l'attente des graphiques. Aucun effet ; ni oxlint ni
  `pnpm check` ne formatent ce fichier.

---

## Reporté par le sous-projet 14 (capital des LEAPS, des Condors et du portefeuille)

- **`worstWing` (`packages/ledger/src/journals/capital.ts`) s'appuie sur l'ordre positionnel de
  `row.legs`** — put acheté, put vendu, call vendu, call acheté — sans vérifier le genre des
  jambes. `detectCondor` et le tuple `CondorLegs` garantissent cet ordre aujourd'hui ; un
  réordonnancement dans `condor.ts` fausserait le montant en silence. Correctif suggéré :
  rendre `null` (compté incomplet) quand les genres ne sont pas `[long_put, short_put,
  short_call, long_call]`.
- **Avec un snapshot mais sans statistiques de journaux, la première ligne du tableau de bord
  porte la carte « Couverture en Cash » seule dans une grille à deux colonnes**
  (`apps/web/src/pages/DashboardPage.tsx`) — la même carte à demi-largeur qu'avant ce
  sous-projet, cas cosmétique.
- **À 400 px, la légende défilante du graphique de capital pagine (« Al‹ 1/2 ›»)** :
  comportement de légende hérité du sous-projet 13 (`capitalOption`,
  `apps/web/src/lib/capitalCharts.ts`), à lire avec les entrées du sous-projet 13 sur les
  étiquettes de fin et sur 400 px.
- **`ExposureCard` (`apps/web/src/components/stats/ExposureCard.tsx`) place désormais le
  camembert et le tableau côte à côte à partir d'une largeur de carte de 42 rem (`@2xl`) plutôt
  que du point de rupture d'écran `md`** : entre environ 768 px et 1000 px de largeur d'écran,
  barre latérale ouverte, la page Wheel les empile là où elle les mettait auparavant côte à
  côte. Délibéré (spec §4.2, pour que la même carte tienne dans la moitié du tableau de bord),
  noté parce que le §1 du spec dit que le rendu de la page Wheel ne change pas.

---

## Reporté par le sous-projet 15 (Secteur et Score)

- **Une écriture refusée sur la page Secteur et Score reste silencieuse.** L'édition, la
  suppression et l'ajout de ligne (`apps/web/src/components/sectors/EditableCell.tsx`,
  `SectorRow.tsx`, `SectorAddRow.tsx`) lancent `commit()`, `deleteSector(...)` et `add()` sans
  attendre leur résultat (`void`) : une base fermée ou un quota dépassé laisse le champ modifié
  sans `aria-invalid` ni message, comme si de rien n'était. Non bloquant : Dexie ne rejette pas
  ces écritures sur un profil ouvert normalement. À reprendre si un scénario réel de refus
  apparaît (verrou de profil, quota IndexedDB).
- **Préexistant, hors de cette branche : `tickerOf("BRK B")` et `sectorOf` ne s'accordent pas.**
  `tickerOf` (`packages/ledger/src/journals/contract.ts`) coupe sur le premier espace et rend
  `"BRK"` pour une action à espace dans son ticker, ce que suit la ligne ajoutée automatiquement
  à la table sectorielle et ce que lisent les journaux et l'exposition de Stats ; mais
  `PositionsPage.tsx` appelle `sectorOf(position.symbol)` avec le symbole brut `"BRK B"`, jamais
  passé par `tickerOf`. Une ligne auto-ajoutée pour BRK B ne colore donc jamais la page
  Positions, et le ledger fusionnerait de toute façon BRK A et BRK B sous le même ticker coupé.
  À revoir le jour où `tickerOf` apprend à distinguer les classes d'actions.
- **`mergeSectorRows` (`apps/web/src/db/sectors.ts`) est exporté mais n'a pas de test direct** :
  seul `importSectorCsv` l'exerce, et rien d'autre ne l'importe. À rentrer dans le module qui
  l'utilise, ou à tester pour lui-même, le jour où un second appelant apparaît.
- **`EditableCell.commit()` retente l'écriture refusée telle quelle à chaque perte de focus
  suivante**, tant que le champ reste marqué modifié : aucun nouveau texte tapé, donc le même
  rejet, sauf pour un score, dont seul le texte se reparse (aucune écriture avant que la valeur
  change réellement). Sans conséquence tant que le point précédent ne se manifeste pas.
- **`apps/web/src/routes/AppLayout.test.tsx` échoue une fois sous charge de suite complète, sur
  `main` aussi** (« Unable to find role=link … Couverture : aucun snapshot… », environ 9 s) et
  passe seul : un test instable dépendant de la charge, préexistant à ce sous-projet.
- **`apps/web/src/pages/SectorsPage.test.tsx`, « adds only once on a double Enter, and shows no
  false 'already in the table' error », a échoué une fois sous charge de suite complète**, sur
  `main` au merge du sous-projet 16 (`pnpm check` à la racine, tests privés et instance de
  développement en marche) : la ligne NVDA était bien seule, mais le message « NVDA est déjà dans
  la table. » s'affichait. Passe seul et à la relance complète ; la branche du sous-projet 16 ne
  touche ni la page ni `db/sectors.ts`. Deux lectures, non tranchées : une course du seul test
  (`waitFor` se résout sur la ligne ajoutée avant que le second Entrée n'ait fini de réagir), ou
  une vraie course de la ligne d'ajout (`SectorAddRow`), le second Entrée voyant le ticker déjà
  écrit avant que le champ ne soit vidé — celle-là serait visible pour qui tape vite. À
  instrumenter avant de corriger.

---

## Reporté par le sous-projet 16 (positions par stratégie et suggestion de position)

- **Le total de la suggestion compte toutes les positions du snapshot, pas seulement les
  actions et les options** (`packages/coverage/src/suggestions.ts`, boucle sur
  `report.positions`, ligne 54). Conforme à l'outil Python d'origine et au §4.2 du spec, mais
  `heldTickers`/`missingSectorRecords` ne gardent que STK/OPT (`apps/web/src/db/sectors.ts`,
  `CLASSIFIED_TYPES`), et l'agent rend `ib.portfolio()` sans filtre
  (`apps/tws-agent/ib_tws_agent/main.py:165`) : une position de change `CASH` (par exemple
  `EUR.USD`) ajouterait sa valeur absolue au total, diminuerait toutes les parts et
  assouplirait le seuil de 5 %. Non observé sur des données réelles. Question produit posée à
  l'utilisateur ; correctif possible : écarter les positions hors STK/OPT et le noter comme
  écart au Python au §4.5.
- ~~**Le badge « used » des actions Wheel est vert quand les calls Wheel ouverts dépassent les
  actions**~~ — **fermé par le sous-projet 22** (2026-09-18) : la carte ne compte plus que les
  calls couverts, donc « used 100/100 » dit vrai et le call sans rien derrière lui est sur la
  page Autres.
- **Aucun test web ne montre la carte « Actions » de la page LEAPS remplie, ni les cartes
  LEAPS vides** (`apps/web/src/pages/StrategyPositionsPage.test.tsx`) ; le §6 du spec nomme
  « les trois cartes LEAPS ». Le calcul des actions LEAPS est testé en unitaire
  (`packages/coverage/src/strategy.test.ts`) et les cartes vides passent par le même
  `GroupCard` que la Wheel, testée.
- **Le comparateur de chaînes `a < b ? -1 : a > b ? 1 : 0` existe désormais en quatre copies
  privées** : `packages/ledger/src/journals/holdings.ts` (`compare`),
  `packages/coverage/src/strategy.ts` (`compareText`), le tri inline de
  `packages/coverage/src/suggestions.ts` et `packages/ledger/src/journals/stats.ts`. Sans
  conséquence ; un utilitaire partagé les réunirait.
- **La graine de démonstration n'a aucun prix dans son snapshot** (`SAMPLE_JOURNAL_SNAPSHOT` et
  `DEMO_POSITIONS`, `apps/web/src/mocks/journals.ts`, `marketPrice` et `marketValue` à `null`) :
  sur les captures `run-frontend --seed`, les colonnes Dernier prix, Valeur de marché et P&L
  latent des pages Positions Wheel et LEAPS affichent « — » partout. Voulu pour les tests qui
  lisent ces données ; donner des prix aux seules `DEMO_POSITIONS` et à une copie démo du
  snapshot rendrait la démonstration parlante sans toucher les tests.
- **`positionSuggestions` suppose des tickers uniques dans ses entrées** : deux lignes de même
  ticker normalisé donneraient deux suggestions. Inatteignable depuis Dexie, la table
  sectorielle étant indexée par ticker normalisé (`apps/web/src/db/sectors.ts`,
  `normalizeTicker`).

---

## Reporté par le sous-projet 17 (la Wheel ne prend que ce qu'il faut)

- **« Même instant » est strict.** Un rachat de call Wheel et une vente d'actions passés en
  deux ordres séparés d'une seconde ne sont pas liés : la vente reste dans l'ordre du carnet.
  Aucun cas réel observé, alpha les passe à la même seconde.
- **Une vente d'actions Wheel sans rachat de call** reste dans l'ordre du carnet et peut
  vendre un reliquat Autres plus ancien. Voulu : rien ne dit que la vente appartient à la
  Wheel.
- **Une livraison ne choisit toujours pas nominativement les lots Wheel qui couvrent le
  call** : entre deux lots Wheel repris à des strikes différents, l'ordre du carnet décide. Le
  P/L reste dans la Wheel, seule sa répartition entre lignes peut s'intervertir.
- **`LotBook.closePreferring` peut laisser un reste de limite infinitésimal** quand un lot
  porte un ratio autre que 100 (lot converti, 53,333… actions par contrat) :
  `budget -= take / per` peut laisser ~1e-15 contrat, et le lot Wheel suivant se voit
  retirer ~1e-13 action — une ligne quasi nulle et un `remaining` à 599,9999999999. Avec le
  multiplicateur par défaut, la division tombe juste ; aucun cas réel observé. Un seuil
  (`if (budget < 1e-9) budget = 0`) le fermerait.
- **Deux comportements du §4.1 n'ont pas de test dédié** : la limite partagée par deux ventes
  du même instant (supprimer la réécriture de `wheelBuybacks` dans `replayGroup` ne casse
  aucun test), et une clôture à prix 0 d'un call Wheel (expiration, assignation) qui ne
  compte pas comme un rachat (supprimer la garde `!isSettlementShape(tx)` non plus).
- **La chronologie ZXAF rejouée (`replay.test.ts`, « chronology of spec 17 §2.2 ») ne
  discrimine que le §3** : retirer seul le §4 ou seul le §5 la laisse passer, parce que les
  ventes du 2026-05-06 accompagnent des rachats et que les lots Wheel sont déjà en tête après
  la conversion. Le §5 garde son test dédié (« keeps the Wheel part of a cut ahead of its
  remainder through a conversion »), le §4 les siens dans `takeover.test.ts`.
- **Des actions Wheel vendues pendant qu'un call couvert est ouvert laissent ce call adossé à
  des actions hors Wheel**, et rien ne répare l'écart. Une vente ordinaire, sans rachat au même
  instant, reste FIFO et peut vendre le lot Wheel le plus ancien ; la part libre de la Wheel est
  ensuite bornée à zéro (`takeOverShares`), si bien qu'un call suivant ne reprend que ses propres
  contrats, pas le manque. À l'assignation du premier call, la priorité Wheel ne trouve plus que
  les actions reprises pour le second, au strike de celui-ci : le P/L tombe dans la mauvaise
  ligne, voire la mauvaise stratégie, son total restant conservé. Antérieur au sous-projet 17
  (même résultat sur la base) ; c'était le « mode dur » du saut positionnel du sous-projet 8.
  Épingler chaque call aux actions qui l'adossent fermerait ce point, la livraison non
  nominative et le suivant d'un coup.
- **La limite de livraison d'un call Wheel passe par deux ratios** : `deliverShares` donne
  `delivery.shares / delivery.ratio` contrats, que `closePreferring` reconvertit en actions avec
  le `sharesPerContract` de chaque lot Wheel. Pour une option ajustée (150 actions par contrat)
  livrant des lots Wheel à 100, la priorité ne couvre que 100 actions par contrat, le reste part
  FIFO. Conforme au §4 du spec (« converti par lot ») ; aucun cas réel observé. Une limite en
  actions serait exacte.

---

## Reporté par le sous-projet 18

- **Une migration Dexie 8 laisse une ligne agent ou un snapshot dont l'heure est illisible
  non convertie, plutôt que de faire échouer l'ouverture de la base.** L'agent écrit
  toujours un instant valide ; aucun cas réel observé.
- **La page Sources affiche deux fuseaux sur le même écran.** `SourcesPage.tsx:490` et
  `:575` lisent `account.lastFlexSyncAt` et `account.lastAgentSyncAt` avec `formatDateTime` :
  ce sont des instants de l'application, en vrai UTC, à côté des heures du ledger qui sont
  l'heure de New York stampée UTC. Les deux affichages peuvent donc différer de quatre à
  cinq heures pour un même événement. Préexistant, inchangé par ce sous-projet.
- **La propriété de plage entière suppose que le dernier jour d'une réponse Flex est
  complet, allant jusqu'à la clôture de la veille.** Vrai sur les deux fichiers Flex privés.
  Une requête finissant le jour même, ou une section datée après les autres, ferait
  disparaître les exécutions de l'agent de cette journée entière jusqu'à la synchro
  suivante.

---

## Reporté par le sous-projet 19 (l'agent local relaie Flex)

- **Sans port TWS, rien ne sonde l'agent hors de la page Sources** : la page Sources, tant
  qu'elle est ouverte, resonde un agent absent (toutes les 10 s, au focus et au retour de
  l'onglet), et `useAgentPolling` sonde les comptes qui ont un port TWS ; aucune autre page ne
  sonde (spec §4.4). La synchro automatique d'un compte sans port TWS, hors de la page Sources,
  attend donc la visite suivante de l'onglet pour voir un agent démarré en cours de route.
- **`apps/web/e2e/agent.spec.ts` échoue à `getByText("AAPL 2026-01-16 C 150")`, sans rapport
  avec cette branche.** Vérifié sur `6661d2e`, avant tout commit du sous-projet 19 : l'échec
  préexiste. À investiguer séparément.
- **Le CLI shadcn lancé depuis `packages/ui` écrit dans un dossier `@/` littéral et importe
  `cn` depuis le paquet npm `cn`, pas `packages/ui/src/lib/utils`.** `pnpm dlx shadcn@latest
  add radio-group` n'a pas trouvé l'alias `@` (aucun `paths` dans
  `packages/ui/tsconfig.json`) et a créé `@/components/ui/radio-group.tsx` au lieu de
  `src/components/ui/radio-group.tsx`, importé `cn` du paquet `cn` (ajouté par erreur à
  `package.json` et à `pnpm-lock.yaml`), plutôt que l'utilitaire local. Corrigé à la main pour
  `radio-group` (fichier déplacé, import réécrit, dépendance et verrou restaurés) ; la
  procédure de `packages/ui/README.md` ne couvre pas cette variante du CLI, à documenter le
  jour où un second composant la reproduit.
- **`useFlexAutoSync.test.tsx` a deux tests qui mordent moins qu'ils n'y paraissent.** Le test
  « does not sync in the default mode when the agent is absent, even logged in, and records
  nothing » affirme que `lastFlexSyncStatus` reste `undefined`, mais `syncAccount` — la seule
  fonction qui écrit ce champ (via `record`) — est mockée pour toute la suite : cette
  assertion ne peut pas rougir tant que le mock reste en place, quel que soit le code réel de
  `record`. Le test « retries an attempt that left the account stale once the account is
  entered again » couvre un démontage suivi d'un remontage du même composant
  (`view.unmount()` puis `renderProbe()`), pas un changement de `accountId` sur une instance
  qui reste montée — le scénario réel visé par la note sur `mounted`/`attempts` (§4.4).
- **`apps/web/src/routes/AppLayout.test.tsx`, les tests des indicateurs de consistance,
  échouent une fois de temps en temps en suite complète et passent seuls** — même symptôme
  déjà noté pour ce fichier au sous-projet 15 (« Reporté par le sous-projet 15 »), observé à
  nouveau sur cette branche. Préexistant, indépendant du sous-projet 19. **Revu au sous-projet
  22** (2026-09-18), troisième occurrence : environ une exécution complète sur trois échoue,
  le fichier seul passe ses seize tests. La fréquence est donc assez haute pour qu'un
  `pnpm check` rouge sur ce seul fichier ne prouve rien — le relancer avant de chercher plus loin.

---

## Reporté par le sous-projet 20 (Tri et filtres de colonne)

- **Une recherche de page tapée moins de 300 ms avant un démontage ou un changement de compte
  n'est pas mémorisée.** `usePageSearch` (`apps/web/src/hooks/useTableView.ts`) n'écrit le
  texte qu'à l'échéance de son anti-rebond (`PAGE_SEARCH_DEBOUNCE_MS`), et le nettoyage de
  l'effet annule le minuteur : quitter la page ou passer à un autre compte juste après la
  dernière frappe perd ces derniers caractères au retour. Le filtre affiché, lui, n'a jamais
  divergé du texte mémorisé.
- **La recette `sed` de `packages/ui/README.md` ne correspond plus au CLI shadcn**, qui écrit
  désormais dans un dossier `@/` littéral et importe `cn` depuis un paquet npm `cn` (déjà
  observé au sous-projet 19 pour `radio-group`) : réécrire les imports `@/` ne suffit plus, il
  faut aussi déplacer le fichier et retirer la dépendance ajoutée. La recette est à réécrire
  le jour où l'on ajoute un composant.

---

## Reporté par le sous-projet 21 (recherche, tri et filtres des pages de stratégie)

- **`FilteredTableBox` pose un `aria-label` en plus du `CardTitle` visible**
  (`apps/web/src/components/table/FilteredTableBox.tsx:64`) : sans rôle sur le conteneur, rien
  n'est annoncé deux fois, et c'est l'ancrage dont les tests de page se servent pour naviguer.
- **`def.id as DetailGroupId` dans `StrategyPositionsPage`**
  (`apps/web/src/pages/StrategyPositionsPage.tsx:78`) : un prédicat de type sur le `.filter()`
  qui le précède éviterait l'assertion.
- **Le `beforeEach` du describe « search, expiries and column filters » de
  `StrategyPositionsPage.test.tsx` (ligne 140-141) vide `localStorage`** que le `beforeEach`
  global du fichier (ligne 73-74) vide déjà.
- **« sorts on a column and keeps the legs under their condor »
  (`apps/web/src/pages/JournalPage.test.tsx:183`) compte les jambes après tri sans assurer
  l'ordre des lignes de tête** : la garantie réelle est structurelle, le moteur ne plaçant
  jamais une jambe à la racine (`buildJournals`), pas un fait que ce tri-là démontre.
- **Pour la Wheel et les Condors, `linesByGroup`
  (`packages/coverage/src/strategy.ts`) calcule les quatre `DETAIL_GROUPS` sans exception,
  mais `STRATEGY_BOXES` (`apps/web/src/lib/strategyBoxes.ts`) n'en déclare que deux pour
  chacune** : le prix de la fonction unique, des groupes calculés et jamais rendus.
- **`setExpiry` est mémoïsé sur `[defs, views]`**
  (`apps/web/src/pages/StrategyPositionsPage.tsx:69-72`), et `views` (`useStrategyBoxViews`)
  est un objet neuf à chaque rendu : la mémoïsation ne sert à rien.
- ~~**La page Autres ne montre pas toute la part nue du portefeuille**~~ — **fermé par le
  sous-projet 22** (2026-09-18) : une page de stratégie ne montre que sa part couverte, et la
  page Autres reprend le reste.

---

## Reporté par le sous-projet 22 (la part nue quitte les pages de stratégie)

- **Un call Wheel réellement couvert par un LEAPS long garde une cellule de couverture vide** sur
  la page Wheel : sa couverture vient de `leaps`, qui n'est pas une source de la Wheel
  (`STRATEGY_COVER_SOURCES`). Le plafond de `migratedContracts` l'empêche de migrer à tort vers
  Autres — rien n'est faux, seulement muet. C'était déjà le comportement avant ce sous-projet.
  L'élargir demande de décider ce qu'une page de stratégie dit d'une couverture qui ne lui
  appartient pas.
- **Un put vendu ne migre jamais**, `secureShortPuts` (`packages/coverage/src/coverage.ts`) lui
  allouant toujours `cash` sans regarder le cash disponible ; un manque de cash reste un problème
  global du rapport. La règle est écrite sur les ventes d'options en général et suivra le moteur
  s'il change.
- **La page Autres peut afficher `UNCOVERED` sur une de ses propres lignes alors que la barre de
  titre est verte.** Cas vérifié contre le moteur : un call vendu à nu — classé `others` à la
  vente, le journal ne reclasse jamais — puis 100 actions du sous-jacent achetées ensuite.
  `buildRiskReport` rend `allocations: [{source:"stock", quantity:1}]` et `uncoveredQuantity: 0`,
  donc le verdict Couverture de la barre de titre passe au vert, tandis que la page Autres
  affiche toujours `UNCOVERED ×1` : `strategyCoverageBadges(line, "others")`
  (`apps/web/src/lib/riskReport.ts`) lit la quantité propre de la ligne et ne regarde jamais
  `line.coverage`. Ce n'est pas une régression de ce sous-projet : le comportement date du
  sous-projet 16, `migratedContracts` ne protège que la part qu'il fait migrer, jamais les lignes
  qu'Autres détenait déjà. Le corriger demanderait l'opération inverse — sortir une ligne
  d'Autres pour la rendre à la stratégie qui la couvre désormais —, hors du périmètre de ce
  sous-projet.

---

## Reporté par le sous-projet 23 (valeurs du jour)

- **La devise du `dailyPnL` d'une position hors USD n'est pas vérifiée** : la sonde du
  sous-projet 23 n'a vu qu'un compte et des positions en USD. `dayChange` n'en dépend pas — ses
  deux termes viennent du même message —, le montant affiché si.
- **Une position a montré un `dailyPnL` nul en séance** pendant la même sonde, marché ouvert,
  sur six cents titres. À comparer à ce qu'affiche TWS pour ce titre : si TWS montre zéro
  aussi, fermer le point.
- **Le « jour » est celui du réglage de TWS** (heure de remise à zéro du P&L dans Global
  Configuration), pas nécessairement la clôture de New York. L'application ne le lit nulle part.
- **Les largeurs des colonnes numériques avaient été mesurées contre les en-têtes et contre les
  valeurs de la fixture de démonstration, jamais contre un contenu de cellule réaliste** — ce
  n'était pas une marge sous-pixel occasionnelle, c'est ce que la revue de la branche entière du
  sous-projet 23 a trouvé et corrigé : sur les douze colonnes partagées, chaque colonne numérique
  dégageait le besoin exact de la fixture, à la fixture près, et sur la table « Actions
  assignées » de la Wheel, `dayChange` et `dailyPnl` (5,5 % et 5,75 % d'un plancher de 48rem)
  débordaient déjà sur la propre fixture de démonstration : trois cellules ("+0.8%$120.00$120.00")
  s'affichaient collées, sans séparation. Corrigé en resserrant le besoin de chaque colonne
  numérique sur un contenu réaliste choisi et mesuré, jamais deviné : un pourcentage signé à trois
  chiffres (`-100.0%`), un montant à quatre chiffres et à cents négatif (`-$1 234,56`), une valeur
  de marché à cinq chiffres et négative, un prix à quatre chiffres avec les quatre décimales du
  formateur. Le plancher des douze colonnes partagées passe de 62rem à 70rem, celui de la Wheel de
  48rem à 63rem — et à 1280 px avec le menu ouvert (976 px de carte), le premier laisse 144 px hors
  écran (la fin de Décision et toute la Couverture), le second 32 px (un tiers de la Couverture) :
  un compromis assumé, pas une régression à corriger en resserrant une colonne sous son besoin. Le
  prochain qui change une de ces deux tables doit re-mesurer contre un contenu de cellule
  plausible dans le pire cas, jamais contre les en-têtes seuls ni contre la fixture de démo — la
  leçon que cette entrée retient de la revue.
- **La colonne `coverage` de la table « Actions assignées » de la Wheel (`WHEEL_SHARE_COLUMNS`)
  porte le même défaut que celui corrigé ci-dessus, non corrigé ici.** Son besoin n'a jamais été
  calculé que sur le mot de son en-tête (« Couverture ») ; or cette table affiche toujours, sur
  chaque ligne, le badge « used x/y » (`riskReport.ts:60`), jamais un simple mot. Mesuré sur des
  données semées réelles, pas un pire cas construit : le badge fait environ 99 px (texte et
  remplissage compris) contre environ 74,8 px de boîte de contenu au nouveau plancher de 63rem —
  un débordement d'environ 16 px. Ce défaut précède le sous-projet 23 : il valait environ 32 px
  au plancher de 48rem d'avant cette revue, et cette revue l'a réduit sans le causer, en
  élargissant la colonne au passage sans jamais la mesurer sur son propre contenu. Le corriger
  demande de donner à `coverage` un besoin calculé sur sa cellule, comme les colonnes numériques
  l'ont désormais — ce qui relèvera encore le plancher de la table.

---

## Reporté par le sous-projet 24 (l'assignation d'après minuit)

- **Le recouvrement entre relevés HTML et agent, quand un compte n'a aucune ligne Flex, reste
  ouvert.** `planAgent` ne filtre alors rien (`flexMax === null`) et `planStatement` ne
  supprime jamais une ligne agent : une exécution que TWS rend après minuit et qu'un relevé
  importé ensuite couvre aussi ferait le même doublon que celui corrigé ici, sans que rien ne
  le résorbe à la synchro suivante. Déjà noté hors périmètre au sous-projet 18
  (`2026-09-16-plage-jours-marche-design.md`), revu et explicitement reporté au sous-projet 24
  : aucun compte réel n'est dans ce cas.
- **Le trou du férié en semaine ne se résorbe jamais, contrairement aux autres trous de la
  règle.** Aucun calendrier de jours fériés — décision assumée (§8 de la spec du sous-projet) —
  mais un cas récurrent lui échappe : l'échéance du jeudi qui précède le Vendredi saint. Si IB
  passe l'assignation après 04:00 le vendredi férié, `marketDayOf` la range au vendredi, alors
  que le `maxDay` de Flex reste au jeudi faute de toute transaction le vendredi (marché fermé) :
  le doublon ne disparaît jamais, aucune synchro Flex ultérieure ne rattrapant un jour où rien ne
  se négocie. Contrairement à tous les autres trous de la règle, qui se résorbent dès que Flex
  rattrape, c'est ce qui justifie de le consigner. Probabilité basse : les trois heures de
  traitement observées à ce jour (22:13, 01:02, 01:16) sont toutes couvertes par le seuil de
  04:00.
- **Renvoi à l'entrée du sous-projet 18** « La propriété de plage entière suppose que le dernier
  jour d'une réponse Flex est complet » (section « Reporté par le sous-projet 18 » de ce même
  fichier) : elle reste vraie, mais sa portée s'est étendue par ce sous-projet — une réponse qui
  s'arrête un vendredi revendique désormais aussi la nuit et le week-end qui suivent, pas
  seulement la clôture de la veille.

---

## Reporté par le sous-projet 25

- **Les sept assertions `expect(upgraded.verno).toBe(LATEST_VERSION)` de
  `apps/web/src/db/schema.test.ts` sont cérémonielles.** Démontré pendant ce sous-projet :
  `verno` est posé par le constructeur de Dexie, avant tout `.open()`, donc ces lignes
  constatent ce que le code déclare et jamais ce qu'une migration fait. Vérifié par
  l'expérience : en supprimant une déclaration de version, ce fichier reste entièrement vert.
  Un commentaire le dit déjà sur place ; elles ont été conservées plutôt que supprimées pour
  ne pas retoucher une deuxième fois un fichier hors périmètre.
- **`apps/web/src/api/allauth.ts` porte un ordre d'étalement fautif** :
  `{ credentials, headers: {...}, ...init }` écrase l'objet d'en-têtes fusionné si un
  appelant passe ses propres en-têtes. Latent aujourd'hui — aucun appelant ne le fait — mais
  c'est exactement le défaut qui faisait disparaître le jeton CSRF dans `api/backup.ts`,
  corrigé là-bas.
- **Le compteur de sourdine du déclencheur est global au module**, pas lié à une instance de
  base (`apps/web/src/db/backup/trigger.ts`). Sans effet aujourd'hui, un seul singleton
  existant. Conséquence résiduelle acceptée : si une passe d'agent recouvrait les écritures
  d'un import lancé au même moment, le dépôt de cet import serait sauté — fenêtre resserrée à
  ses seules écritures, rattrapée par le déclencheur suivant ou le bouton « Sauvegarder
  maintenant ».
- **`handleEnable` et `handleDisable` n'ont pas de test dédié pour leur `catch`**,
  contrairement à `handleExport`.
- **La suite Playwright (`apps/web/e2e/`) n'a pas été exécutée** de tout le sous-projet : elle
  demande un Django et un PostgreSQL réellement démarrés, et ne tourne ni dans `pnpm check` ni
  dans `pnpm test:api`. Les commentaires d'`auth.spec.ts` ont été corrigés par lecture seule.
- Et tout ce que la revue de branche aura relevé.

---

## Reporté par le sous-projet 26 (la clé enveloppée par une phrase de passe)

- **Le format hérité n'est lu par personne**, choix du 2026-09-22 au motif d'un utilisateur
  unique et d'un VPS qui n'est pas en ligne. Une deuxième installation avant la mise en ligne
  exigerait de réintroduire une branche de compatibilité, son invite d'interface et ses tests.
- **La règle de force de la phrase mesure la longueur, pas l'entropie** : `motdepasse123`
  passe. Le rempart est Argon2id, assumé au spec §10.
- **Changer la phrase n'est effectif qu'au prochain dépôt** : d'ici là, l'ancienne ouvre encore
  le blob du serveur. Dit à l'utilisateur, jamais forcé par un dépôt immédiat.
- **Un navigateur qui garde une clé périmée n'a aucun chemin vers le formulaire de phrase** :
  `handleRestore` (`apps/web/src/components/settings/BackupCard.tsx`) n'ouvre le formulaire
  que quand `readBackupState` rend `null`, et `disableBackup` garde la ligne en place. Un
  navigateur A qui restaure un blob déposé par un navigateur B prend donc le chemin `{ key }`,
  échoue par `BackupKeyError` et lit « Cette phrase de passe n'ouvre pas la sauvegarde »,
  alors qu'aucune phrase ne lui a jamais été demandée. Hors des cinq chemins du spec, mais une
  vraie impasse.
- **« Chiffrement de la clé… » s'affiche aussi pendant une restauration**, où c'est la clé qui
  est déballée, pas chiffrée (`settings.backupDeriving`). Les séparer demanderait une
  quatorzième clé i18n.
- **L'assertion d'enveloppe de `BackupCard.test.tsx` est faible** :
  `expect(row!.wrap.salt).toHaveLength(16)` passerait tout aussi bien si `adoptBackupKey`
  avait reçu une enveloppe fraîchement générée plutôt que celle de l'en-tête.
- **Pas de soumission par Entrée** dans le formulaire à deux champs de la phrase de passe,
  faute d'élément `<form>`.
- **`rewrapBackupKey` ne rejette que l'absence de ligne, pas une ligne désactivée**, et son
  `BackupKeyError` s'affiche comme « mauvaise phrase ». Inatteignable tant que le bouton reste
  derrière `enabled`.
- **Les tests coûteux du blob mélangent deux formes de délai Vitest** : les describes
  d'Argon2id de `crypto.test.ts` passent le délai en troisième argument numérique, là où
  `state.test.ts`, `sync.test.ts` et `BackupCard.test.tsx` le passent en objet `{ timeout }`.
  Les deux formes sont valides sous Vitest 4.
- **La parité des clés entre `fr.json` et `en.json` n'est toujours vérifiée par aucun test** —
  dette du sous-projet 27, que ce sous-projet a de nouveau relue à la main (487 clés de
  chaque côté, aucun écart).
- **Le driver `run-frontend` ne peut pas vérifier visuellement la carte Sauvegarde tout seul** :
  il ne sait ni simuler une session authentifiée, ni piloter les formulaires de la carte
  (activation, restauration) avant la capture. Le sous-projet 26 a dû écrire un script
  Playwright à la main pour ces captures.
- Et tout ce que la revue de branche aura relevé.

---

## Sous-projet 27

- **Aucun test ne couvre une portée qui exclut `wheel` alors que des actions Wheel existent.**
- **Un même ticker détenu en deux devises produirait deux niveaux d'actions, jamais exercé.**
- **`formatLevelValue` laisse `Intl` rendre le signe négatif** : un ICU qui rendrait U+2212
  changerait l'apparence sans casser un test.
- **La couleur d'un condor n'est vérifiée par aucun test, seulement à l'œil.**
- **`LevelsPrimitive.attached` n'accepte pas `requestUpdate`** : sans effet tant que la
  primitive est recréée à chaque changement de niveaux.
- **`apps/web/src/i18n/index.test.ts` ne vérifie pas la parité des clés entre `fr.json` et
  `en.json`** — dette antérieure à ce sous-projet.
- **Un condor ouvert avant la fenêtre de deux ans ne dessine rien**, et une échéance qui
  tombe un jour férié de marché n'a ni verticale ni étiquette : le niveau disparaît en
  silence plutôt que de se poser au bord.
- **Un changement de thème réinitialise le zoom et le défilement du graphe** : le graphe est
  recréé, `fitContent()` rejoue.
- **`duration` et `barSize` de `/bars` n'ont aucun appelant** ; leur comportement est fixé par
  un test que personne n'exerce.
- **Le graphe ne s'ouvre qu'à la souris** : les lignes cliquables n'ont ni `role`, ni
  `tabIndex`, ni gestion clavier, et un clic sur un badge ou une infobulle de la ligne le
  bascule aussi.
- **`tsc --noEmit -p .` ne vérifie rien** sur un tsconfig-solution : seul `tsc -b` — ce que
  lance `pnpm check` — contrôle réellement les projets référencés. Vu pendant la vague de
  correction finale, après qu'un typage réputé propre soit passé à côté d'une erreur.
- **La suite d'`apps/web` flanche sous charge**, et pas à cause de ce sous-projet : mesuré le
  2026-09-22, `main` échoue une fois sur trois exécutions (`AppLayout.test.tsx`), la branche
  une fois sur deux, jamais deux fois le même test. La cause est le délai par défaut d'une
  seconde des `findBy...` de Testing Library, qui expire quand la machine est chargée. À
  traiter par un délai explicite sur les assertions concernées, pas en relançant jusqu'au vert.

---

## Sans échéance

- **Aucune intégration continue.** Décidé au brainstorming du sous-projet 3 : `origin` est un
  dépôt local (`/home/seb/git/IB_Analyzer2`), aucune forge n'héberge le code, donc aucun
  serveur ne peut exécuter `pnpm check` ni `pnpm test:api` sur une machine propre. À
  reconsidérer le jour où le dépôt vivra sur une forge — décision d'un autre ordre pour un
  dépôt privé touchant à des données financières.

- **La page Historique n'a pas d'état d'erreur.** Un échec de lecture Dexie laisse la ligne
  de chargement indéfiniment. La clé i18n `history.error`, orpheline, a été supprimée plutôt
  que conservée en mensonge : la rétablir avec l'état, ou vivre sans.
- **Un lien stylé en bouton devrait être un `<Link>` portant `cn(buttonVariants(...))`**,
  plutôt qu'un `Button` rendu en lien avec `nativeButton={false}` et `role="link"`. Les deux
  sites hérités (`AccountsPage` pour « Ouvrir », `UnknownAccountPage`) sont corrects et testés
  au niveau du rôle d'accessibilité ; adopter le motif plus simple pour tout nouveau site.
  **Le `cn(...)` n'est pas décoratif** : `buttonVariants` émet à la fois `border-transparent`
  (base) et `border-border` (variante `outline`), et seul tailwind-merge tranche. Sans lui, le
  lien sort avec une bordure transparente — constaté à la revue finale du sous-projet 3.
  **Trois sites l'utilisent encore nu** et sortent donc avec cette bordure transparente :
  `PositionsPage.tsx:47`, `SettingsPage.tsx:53` et `UncoveredCard.tsx:36` (`DashboardPage`
  porte `cn(...)` depuis le sous-projet 14). Les autres sont corrects. Tant que les trois
  restent, la règle énoncée ci-dessus est contredite par le dépôt lui-même : les corriger, ou
  dire pourquoi on ne le fait pas.
- **`packages/ui/src/hooks/use-mobile.ts` déclenche un avertissement oxlint** (`set-state-in-effect`),
  hérité tel quel de la première version. **Neuf avertissements au total** sur la branche, comptés
  à la fin du sous-projet 3 : `api/session.tsx` ×3 (`only-export-components` ×2,
  `set-state-in-effect`), `db/DbProvider.tsx` ×2 (`only-export-components`),
  `pages/SettingsPage.tsx`, `pages/SourcesPage.tsx`, `flex/useFlexAutoSync.test.tsx` et
  `use-mobile.ts` lui-même. `pnpm lint` sort en 0 : ce sont des avertissements, pas des
  erreurs. Le chiffre « trois » qui figurait ici datait du sous-projet 1 et n'avait pas suivi.
- **La plage Flex est bornée par la fenêtre déclarée, pas par section.** `planFlex` ne
  descend plus sous `fromDate` (correctif du trou de `alpha`, mars–août 2025 : une ligne de
  trésorerie datée du 2025-02-21 revendiquait 342 lignes de relevé que la réponse ne
  remplaçait pas), mais il revendique toujours une seule plage pour toutes les sections. Si
  une Flex Query déclarait un jour plus de 365 jours, ses trades s'arrêteraient à 365 jours
  quand ses sections de trésorerie couvriraient tout : la plage revendiquée redeviendrait
  plus large que celle réellement livrée, et le trou reviendrait — à l'intérieur de la
  fenêtre déclarée, cette fois. La vraie réponse serait une plage par famille de lignes
  (trades, trésorerie, opérations sur titres), chacune bornée par ce que sa propre section
  rapporte. À rouvrir si un compte affiche une période Flex de plus de 365 jours dans la page
  Sources.
- **Un ajustement tardif est perdu jusqu'au prochain relevé.** La ligne Flex antérieure à
  `fromDate` est ignorée : le jour appartient aux relevés, mais tant qu'aucun relevé
  postérieur à l'ajustement n'est importé, la correction n'existe nulle part et le solde
  s'en écarte d'autant. Le compteur `skipped` de l'import la signale, sans dire laquelle ni
  qu'il faudrait retélécharger le relevé qui la couvre. La sortie propre serait de retenir
  la fenêtre déclarée par chaque synchro sur la fiche du compte : `planStatement` prendrait
  sa borne de cette fenêtre au lieu du `min(when)` des lignes Flex, et l'ajustement pourrait
  alors être conservé sans empoisonner personne.
- **Un ledger importé avant ce correctif garde la ligne empoisonnée.** `planFlex` n'écarte
  que les lignes *entrantes* ; il n'efface jamais les siennes, à raison. Une ligne Flex déjà
  stockée en deçà de la fenêtre reste donc la plus ancienne du ledger, et `planStatement`
  continue d'y voir sa borne : les relevés refusent d'écrire ces mois-là, silencieusement.
  Le remède est la reconstruction complète — « Supprimer les transactions », puis « Relire
  les relevés » et une synchro Flex. Aucune auto-réparation n'est possible : une requête
  Flex réellement plus large dans le passé est indiscernable de l'empoisonnement.
- **`label` des positions reste en anglais quelle que soit la langue**, comme dans l'ancienne
  application.

### Le serveur a répondu, mais mal

La branche du sous-projet 3 a une histoire complète et testée pour « serveur injoignable » —
`unreachable` traverse `allauth.ts`, `session.tsx`, `SessionMenuItem`, `SettingsPage` et la
carte de synchro, avec des tests à chaque étage. Elle n'en a **aucune** pour « le serveur a
répondu, et il a répondu mal ». Un 5xx est raconté partout comme autre chose que ce qu'il est.
Les quatre morceaux tiennent ensemble et se corrigeront ensemble :

- **Aucun test pour un 500 sur `/auth/session` ni sur `/auth/login`.** Toute la couverture
  d'erreur passe par un `fetch` qui rejette (injoignable) ou par un 401/400 (refusé).
- **`fetchSession` traite un 500 comme un 401** (`apps/web/src/api/allauth.ts` : `if
  (!response.ok) return { kind: "anonymous" }`). Un serveur en panne fait donc afficher
  « connectez-vous » à un utilisateur déjà connecté, et `SettingsPage` lui montre sa carte
  d'invitation à se connecter — un message faux, sans le moindre indice que le serveur va mal.
- **`rejected` et `unreachable` sont confondus dans les deux sens.** Les cartes « Changer de
  mot de passe » et « Double authentification » de `SettingsPage` n'affichent
  « Serveur injoignable » que sur `unreachable` et retombent sinon sur un
  `settings.actionFailed` générique : un 5xx y perd toute sa nature. Et à l'inverse
  `fetchTotpStatus` renvoie `unreachable` sur un 404 dépourvu du corps attendu, et
  `fetchSession` sur un 200 au corps illisible — dans les deux cas le serveur a bel et bien
  répondu. Trois états seraient nécessaires là où il y en a deux.
- **Les 401 et 429 du proxy Flex n'ont pas de champ `code` et sont absents de l'OpenAPI.**
  `apps/api/ib/api.py` déclare `response={200, 502: ErrorOut, 504: ErrorOut}` ; les deux autres
  sont produits par `django_auth` et par ninja lui-même, avec leur corps à eux.
  `apps/api/openapi.json` ne liste donc que `200`, `502` et `504`, et
  `apps/web/src/flex/proxy.ts` doit deviner ces deux cas au code HTTP seul. Cela marche —
  `retryAfterMs` est lu sur le 429 depuis la revue finale — mais rien dans le contrat typé ne
  garantit ces deux réponses.

### Moteur

- **`weightedAvgCost` fait `?? 0`** : un coût d'action inconnu entre dans la moyenne comme un
  lot à coût nul, ce qui peut tirer `stockCost` vers le bas et éteindre en silence la note de
  risque « strike sous le coût de l'action ». Le Python n'avait jamais de `null`, donc ce
  n'est pas un écart de fidélité.
- **`fmtExpiry` est exporté mais n'est exercé que transitivement**, par la description de
  structure.

### Parseurs

- **`currency-missing` est émis une fois par ligne**, avec le contenu de la ligne dans
  `detail` (`packages/ib-parsers/src/statement.ts`). Ailleurs le fichier dédoublonne par
  `Set` (voir `unknown-asset-category`). Sur un relevé dont un bloc perdrait son en-tête de
  devise, la page Sources de données afficherait un avertissement par ligne.
- **`columnsSeen` est l'union de tous les `<thead>` d'une section.** Un renommage de colonne
  propre à un seul bloc échappe donc encore à `column-missing` — exactement le défaut qui
  faisait perdre les commissions de conversion. Une vérification par bloc l'attraperait.
- **`column-missing` est câblé sur `Trades`, `Open Positions` et `Cash Report` côté Flex, et
  sur `Transactions` côté relevé HTML** ; `CashTransactions`, `CorporateActions` et
  `OptionCashSettlement` n'émettent toujours rien quand une colonne surveillée disparaît, alors
  que le spec place cette règle dans le contrat commun des parseurs.
- **L'énumération des codes d'anomalie du spec §4.1 est périmée** : neuf codes existent
  (`section-unread`, `unknown-asset-category` et `currency-missing` s'y sont ajoutés).

### Fixture anonymisée

- **Elle n'est plus arithmétiquement cohérente.** Chaque montant est mappé indépendamment,
  donc `netCash ≈ proceeds + ibCommission` ne tient plus, et `fxRateToBase` porte un taux
  synthétique fixe sur toutes les lignes. Aucun test actuel n'en dépend, mais un futur test
  de réconciliation écrit contre cette fixture bâtirait sur du sable — l'écrire contre des
  lignes construites à la main.
- **La carte monétaire préserve l'ordre de rang** des montants réels. Depuis le 2026-09-17 elle
  interpole entre des bornes fixes, plus entre le minimum et le maximum réels : les magnitudes ne
  se lisent plus, seul l'ordre complet est divulgué.

### Tests qui ne mordent pas assez

- **`apps/web/src/db/importFile.test.ts`, « scopes the snapshot to the account »** : un seul
  compte est jamais importé, donc `db.snapshots.get("other") === undefined` passerait quelle
  que soit la clé utilisée. Semer un snapshot sur un second compte avant l'import et vérifier
  qu'il est intact.
- **`packages/ib-parsers/src/flex.test.ts`, « cancels everything on an open position without
  quantity »** : affirme `transactions == []` sur un corps dont Trades et CashTransactions sont
  déjà vides ; l'assertion passerait même si la branche catch cessait de jeter les
  transactions.
- **`apps/web/src/lib/businessConstants.test.ts`** : la regex couvre les quatre libellés
  d'option et les trois sortes de structures, mais pas « long position », « short position » ni
  « other ».
- **`apps/web/src/db/sectors.test.ts`** : `Number.isFinite` accepte « 1e3 » et les scores
  négatifs sans borne.

### Outillage

- **Le script de contrôle de fuite de l'anonymiseur exclut les noms d'attributs contenant
  `Date` mais pas `dateTime`** (comparaison sensible à la casse) : ce dernier ressort donc en
  faux positif. Sans conséquence, les dates sont préservées par conception.
- **`driver.mjs` : `--ib-account` appelle `db.accounts.update`**, qui est un no-op silencieux
  si le compte n'existe pas ; la dérivation du compte se replie sur `"alpha"` en dur si la
  première route n'a pas la forme `/accounts/<id>/…`, ce qui importerait en silence dans le
  mauvais compte.
- **`driver.mjs` : après un `--import`, la capture de la page Sources ne montre pas la carte de
  compte rendu**, parce que le driver renavigue vers la route et que cet état React local est
  perdu.
- **`driver.mjs` : une capture `fullPage` d'une page de données réelles longue (un journal
  Wheel sur un historique complet) rend un PNG de plusieurs dizaines de milliers de pixels de
  haut, illisible par l'outil `Read`** (mise à l'échelle trop agressive pour distinguer une
  ligne). Contournement qui a marché à la tâche 8 : piloter Playwright soi-même (mêmes ports
  via `tools/dev-env/ports.mjs`, même flux seed/import que `driver.mjs`) en ciblant les lignes
  par leur texte (`page.locator("tr", { hasText: … })`) plutôt qu'en capturant la page entière,
  pour un extrait textuel et une capture resserrée sur la zone utile.
- **`packages/coverage/src/report.ts:133` est la seule ligne du dépôt à dépasser 120
  caractères** ; aucun formateur n'est configuré et oxlint sort 0.
- **Rien dans `pnpm check` ne vérifie la cohérence entre `pnpm-lock.yaml` et les
  `package.json`.** La tâche 20 a ajouté `@playwright/test` à `apps/web/package.json` en
  `^1.62.1`, mais le verrou régénéré dans ce worktree-là avait figé son spécificateur à
  `1.62.1` sans le `^` — invisible tant que `node_modules` restait celui, déjà installé, de
  la tâche 8, et donc passé au travers de vingt et une tâches et deux revues avant d'être vu
  sur un clone propre. `pnpm install --frozen-lockfile` (et donc `apps/web/Dockerfile:7`) est
  le seul filet, à l'installation ; rien ne le rejoue en continu.

### Agent local (sous-projet 4)

Les dix-sept tâches ont eu une revue propre à chaque fois ; ce qui suit est ce que ces revues
ont vu et jugé non bloquant.

- **Rien ne relie la forme JSON qu'émet `write_index.py` (Python) à celle qu'attend
  `agentIndex.ts` (TypeScript).** Les deux côtés s'accordent aujourd'hui par convention sur
  `{ version, filename }`, chacun avec ses fixtures écrites à la main ; si un nom de champ
  dérivait d'un côté, la page Aide retomberait silencieusement sur « ce serveur ne sert pas le
  paquet », indiscernable d'une vraie absence de paquet.
- **`packages/ib-parsers/src/agent.ts` redit deux fois une connaissance qui existe déjà
  ailleurs** : `OPTION_TYPES` répète ce que `isOptionCategory` (`flex.ts`, non exporté) sait
  déjà, et `MONTHS` y est un tableau alors que `common.ts` porte la même information en record,
  dans le sens opposé. Un helper et une table partagés dans `common.ts` fermeraient les deux.
- **`db/importLock.ts` : la Map `lanes`, scopée par compte depuis la tâche 7, ne supprime
  jamais une file vidée.** Bénin à l'échelle de l'application (quelques comptes par onglet,
  objets minuscules, durée de vie bornée par l'onglet) ; deviendrait un vrai cumul si des
  identifiants de compte transitoires apparaissaient un jour.
- **`SnapshotStatus` et `AccountDataProvider` s'abonnent chacun à la table `snapshots`** (le
  second via `useRiskReport`, qui l'appelle aussi) : deux abonnements Dexie à la même donnée,
  tous deux dans la coquille. Sans conséquence, `dexie-react-hooks` le gère.
- **Bruit et conformité passive dans `apps/tws-agent`** : `pnpm test:agent` affiche deux
  avertissements de dépréciation (`StarletteDeprecationWarning` sur `httpx`/`TestClient`,
  `anyio` `BlockingPortal`) venus des versions épinglées par le plan, pas du code écrit — piste
  : `[tool.pytest.ini_options] filterwarnings` dans `apps/tws-agent/pyproject.toml`. Et
  « l'agent ne journalise que les erreurs » n'est vrai que parce que `cli.py:serve` passe
  `log_level="warning"` à uvicorn : rien ne l'impose ni ne le teste, conforme au plan mais
  silencieux si ce réglage change un jour sans qu'on y pense.
- **`agent/sync.ts` : `fail()` ne couvre que l'échec**, là où `record()` de `flex/sync.ts`
  couvre les deux issues — divergence justifiée (l'écriture du succès de l'agent doit vivre
  dans la transaction `syncAgent`), mais les deux modules de synchro n'ont plus la même forme.
- **Plusieurs tests de la branche protègent moins qu'ils n'y paraissent, chacun imposé
  verbatim par le plan** : `expect(AGENT_PROBE_TIMEOUT_MS).toBe(2_000)` (`client.test.ts`) est
  une tautologie, `AbortSignal` ne laissant pas relire sa durée après création ; « keeps
  lastAgentSyncAt from the last success » fixe le même `now` aux deux passages et ne
  discrimine donc rien, la propriété qu'il nomme étant en réalité protégée par un autre test ;
  le nettoyage d'effet de `useAgentSync.ts` fait bien `clearTimeout` et `unsubscribe`, mais
  aucun test ne rougirait si l'un des deux disparaissait, le garde `cancelled` masquant le
  symptôme ; le test de cadence dépend d'une marge théorique de quelques dizaines de ms pour
  qu'`advanceTimersByTimeAsync` franchisse la borne ; le test de régression de
  `router.test.tsx` ne parcourt qu'un niveau de routes (`flatMap(r => r.children ?? [])`),
  suffisant pour la régression nommée mais pas pour une réinsertion plus profonde ; le champ
  port TWS reste `type="text"` sans qu'aucun des cinq tests n'exerce une saisie non numérique
  côté DOM ; les tests d'origine de `HelpPage` calculent leur attendu depuis
  `window.location.origin`, la même source que l'implémentation ; le cas `{ version: 1 }`
  d'`agentIndex.test.ts` n'isole pas la règle qu'il nomme, faute de `filename` dans le même
  corps ; aucun test n'affirme l'absence du lien Sources sur `HelpPage` quand aucun compte n'a
  été ouvert, seulement sa présence ; et l'assertion `"AAPL 2026-01-16 C 150"` du scénario bout
  en bout (`e2e/agent.spec.ts`) est satisfaite à l'identique par la position semée et par celle
  de l'agent, masquée aujourd'hui par l'assertion de badge voisine. Aucun de ces trous n'a
  laissé passer de bug pendant les dix-sept tâches ; ils bornent ce que la suite protégerait si
  le code changeait sous elle.
- **Le test de changement de compte de la tâche 13 vérifie que le champ port est visiblement
  vide avant d'enregistrer ; celui, plus ancien, du formulaire Flex ne le fait jamais.**
  Aligner l'ancien sur le nouveau serait un gain gratuit.
