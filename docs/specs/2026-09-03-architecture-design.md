# IB Options Analyzer 2 — Architecture

> Spec fondateur du dépôt. Décisions arrêtées le 3 septembre 2026 après revue de la
> première version (Django + cookiecutter, données côté serveur).
> Ce document fixe l'architecture. Chaque sous-projet (§12) aura ensuite son propre spec
> et son propre plan.

---

## 1. But

Analyser plusieurs portefeuilles Interactive Brokers (actions + options) avec historique
complet, à travers une application web **exposée sur internet et partageable**, dont le
serveur **ne stocke aucune donnée de portefeuille**.

Fonctionnalités, toutes conservées de la première version, rendu visuel identique :

- Dashboard : cash requis vs disponible, positions non couvertes.
- Positions : table détaillée, verdict de couverture, décision de rachat.
- Historique : toutes les transactions, filtres, soldes cumulés USD et EUR.
- Aujourd'hui : exécutions du jour (nécessite l'agent local).
- Journaux Wheel, LEAPS, Condors : cycles reconstitués depuis l'historique, agrégats par mois.
- Multi-comptes, **jamais combinés** : chaque vue est scopée `/accounts/:accountId/...`.
- Langues en et fr, thème clair et sombre.

### Objectif secondaire, tout aussi structurant

Le serveur et la coquille frontend forment un **socle réutilisable** pour d'autres
applications sur VPS Linux, de la mini-application à l'ERP : authentification avec 2FA,
plusieurs types d'utilisateurs, multi-langue, thème, moyen de paiement activable, tests
automatisés, démarrage en une commande.

**Conséquence de conception :** le spécifique IB est confiné dans des paquets nommés comme
tels (§5). Tout le reste est générique par construction.

---

## 2. Les trois paliers d'usage

L'application doit être complète sans agent local. Ce qu'un utilisateur obtient dépend des
sources qu'il branche :

| Palier | Sources | Ce qui est disponible |
|---|---|---|
| 1 | Flex Query seule | Historique 365 jours, positions et couverture à la clôture de la veille, journaux, primes |
| 2 | Flex + relevés HTML | Idem, avec l'historique profond au-delà de 365 jours |
| 3 | Flex + HTML + agent local | Idem, plus positions intraday, exécutions du jour, page Aujourd'hui |

**Note du 2026-09-06** : il n'y a plus de page Aujourd'hui ; le palier 3 ajoute positions
intraday et exécutions du jour dans Historique, Positions et Dashboard
(`2026-09-06-agent-local-design.md` §2.1).

**Note du 2026-09-10** : un relevé HTML seul suffit désormais à tout sauf à l'intraday —
historique, positions et couverture à sa fin de période (Open Positions et Cash Report se lisent
aussi dans le relevé), journaux, et solde cumulé calé sur le cash de fin
(`2026-09-10-fichier-seul-design.md`). Le §13 ne change pas : les positions sont lues, jamais
dérivées du ledger.

Les pages Aujourd'hui et les données intraday n'apparaissent que si l'agent est détecté
(§8). Tout le reste fonctionne aux trois paliers.

Les positions des paliers 1 et 2 viennent de la section **Open Positions** de la Flex Query
(prix de marché, coût moyen, strike, échéance, multiplicateur, à la clôture de la veille).
C'est l'entrée du moteur de couverture. Dériver les positions depuis l'historique reste
possible en contrôle croisé mais n'est pas la source de vérité : transferts de titres et
opérations sur titres rendent ce calcul fragile.

Chaque palier impose une liste de sections et de colonnes à cocher dans la Flex Query. Cette
liste est documentée, et **vérifiée par le parseur à chaque synchro** : ce qui manque est
listé lisiblement dans la page Sources de données (§9).

---

## 3. Contraintes Interactive Brokers — les faits

Reprises de la première version, toutes vérifiées empiriquement. Elles déterminent
l'architecture plus que les frameworks.

### 3.1 Trois sources d'historique

| Période | Source | Ce qu'on obtient |
|---|---|---|
| Aujourd'hui | TWS via l'agent local, `reqExecutions` | Exécutions depuis minuit seulement |
| 365 derniers jours glissants | Flex Web Service (Activity Query) | Données jusqu'à la clôture de la veille. **Plafond de 365 jours par requête**, pas de paramètre de date par appel |
| Au-delà | Activity Statement exporté en HTML depuis le Client Portal | Plage libre à l'export |

### 3.2 Flex Web Service

- **Pas d'en-tête CORS** sur `ndcdyn.interactivebrokers.com` (vérifié le 2026-09-03) : un
  navigateur ne peut pas l'appeler. D'où le proxy serveur (§7.4).
- Protocole en deux étapes : `SendRequest` rend un code de référence, `GetStatement` rend le
  XML, parfois après plusieurs essais.
- Une Flex Query par compte. Période `Last N Days`, jamais `Last Week/Month/Year`.
- Token : validité 6 h par défaut, à passer à 1 an. Régénérer invalide le précédent.
- Rythme : 1 req/s, 10 req/min par token. Codes `1009`/`1019` : attendre 5 s ; `1018` : 10 s.
- Les comptes papier n'ont pas accès au Flex Web Service.
- Les mouvements de cash (`Deposits & Withdrawals`) n'arrivent que si le type est coché
  dans la section Cash Transactions. `transactionID` est obligatoire.
- Les transferts de titres (ACATS) sortent dans une section `Transfers` distincte que la
  première version ne lisait pas. Trou connu, à traiter dans `ib-parsers`.
- `Conid` et `Security ID` sur la section **Trades** sont **optionnels** : cochés, ils
  permettent de suivre un contrat à travers un changement de ticker, et leur absence n'est
  jamais une erreur.

### 3.3 Relevé HTML

Sections nommées (`id="tbl<Nom>_<compte>Body"`), en-têtes de colonnes explicites, lignes
`subtotal` à exclure, ruptures `header-asset` et `header-currency` à lire comme contexte,
symbole d'option empaqueté (`AANZ 26SEP25 24 P`), ventes en quantité négative, opérations
sur titres dans `CorporateActions`. Pas d'identifiant stable : clé par hash de contenu.

### 3.4 TWS

- `clientId 0` obligatoire pour voir les ordres passés depuis l'interface TWS.
- TWS redémarre chaque nuit et perd sa session : l'agent se connecte à la demande, jamais
  en continu.

### 3.5 Conversions de devises

IB stocke une conversion (`EUR.USD`) sur une seule ligne qui touche deux devises : `amount`
va à la devise de cotation, `quantity` à la devise de base, et **la commission aussi à la
devise de base**. La paire est reconnue à la forme du symbole (`^[A-Z]{3}\.[A-Z]{3}$`). Cette
règle est portée telle quelle dans `ledger`.

---

## 4. Vue d'ensemble

```
Machine utilisateur                                  VPS
──────────────────                                   ───
TWS ──▶ tws-agent (palier 3 seulement, + relais Flex)  api : Django mince
           Python, ib_async                                 auth sur invitation, 2FA
           127.0.0.1, CORS vers l'app                       proxy Flex sans état, si le compte l'autorise
              ▲                                             sauvegarde chiffrée opaque (opt-in)
              │                                             paiement plus tard
Navigateur ◀──┴─────────────────────────────────────────────┘
  ledger complet en IndexedDB                          PostgreSQL : utilisateurs + blobs
  parseurs Flex XML + relevé HTML
  moteur de couverture (TS)
  journaux, agrégations, graphiques
```

**Principe : tout le métier tourne dans le navigateur.** Le serveur authentifie, relaie,
et garde au plus un blob qu'il ne peut pas lire. L'agent local fournit des données brutes.

---

## 5. Dépôt

```
IB_Analyzer2/
  apps/
    web/              SPA Vite + React + shadcn/ui : pages, i18n, thème. Uniquement du code applicatif
    api/              Django mince : app core (auth, invitations, sauvegarde), app ib (proxy Flex)
    tws-agent/        Python, ib_async, optionnel, installable par uv tool / pipx
  packages/
    ui/               composants shadcn générés, à part du code applicatif
    ledger/           TS pur : modèle de transaction, propriété de plage, soldes, journaux, agrégations
    ib-parsers/       TS pur : Flex XML et relevé HTML vers lignes de ledger et positions
    coverage/         TS pur : moteur de couverture porté du Python
  docs/
    specs/            ce document, puis un spec par sous-projet
    plans/            un plan par sous-projet
  docker-compose.yml  api + postgres, sur le réseau externe du Traefik du VPS
  package.json        workspaces pnpm
  pyproject.toml      workspace uv (api, tws-agent)
```

| Paquet | Spécifique IB | Socle réutilisable |
|---|---|---|
| `apps/web` : coquille (layout, sidebar, thème, i18n, auth, Paramètres) | non | oui |
| `apps/web` : pages métier | oui | non |
| `apps/api/core` | non | oui, tel quel |
| `apps/api/ib` | oui | non |
| `apps/tws-agent` | oui | non |
| `packages/ui` | non | oui |
| `packages/ledger`, `ib-parsers`, `coverage` | oui | non |
| `docker-compose.yml`, CI | non | oui |

Outillage : pnpm workspaces pour le TS, uv pour le Python. `pnpm dev` lance web et api,
`docker compose up` déploie. Turborepo n'est pas installé au départ ; il s'ajoute quand
plusieurs paquets auront des builds à orchestrer avec cache.

---

## 6. Navigateur

### 6.1 Le ledger

Un tableau de transactions normalisées par compte, persisté en **IndexedDB via Dexie**,
chargé en mémoire à l'ouverture du compte. Tous les écrans lisent ce tableau.

Modèle d'une ligne, repris de la table `Transaction` de la première version :

```
kind        trade | dividend | interest | fee | tax | corporate_action | transfer
symbol, secType, right, strike, expiry
quantity, price, amount, commission, currency
when        ISO 8601, heure murale de New York stampée UTC (§6.2)
description
source      flex | statement_html | agent
externalId  flex:trade:{tradeID} | flex:cash:{transactionID} | html:{hash} | agent:{execId}
```

Ordre de référence : `when` puis `externalId`. Il rend les soldes cumulés déterministes ;
les relevés HTML horodatent à minuit, d'où l'importance du second critère.

Ordres de grandeur, mesurés ou estimés :

| Donnée | Taille ou coût |
|---|---|
| 10 000 transactions en JSON | environ 3 Mo |
| Solde cumulé, une passe triée | inférieur à 5 ms |
| Agrégations par mois, symbole, stratégie | quelques ms |
| Relevé HTML d'un an | 740 Ko, parsé par DOMParser en moins de 200 ms |

### 6.2 Propriété de plage : trois sources, jamais de comparaison de contenu

Les sources ne peuvent pas se reconnaître (identifiants IB, hash, `execId`). Deux
transactions jumelles le même jour sont légitimes. La déduplication se fait donc **par
propriété de plage**, règle héritée de la première version et étendue à l'agent :

- **Flex est propriétaire** de ses jours réels, du jour de `min(when)` au jour de
  `max(when)` inclus, jamais d'un jour antérieur à la fenêtre que la réponse déclare
  (`fromDate`). Les données rétrécissent cette fenêtre, elles ne l'élargissent jamais : les
  sections d'une même réponse ne couvrent pas la même plage, et un ajustement tardif —
  annulation de retenue à la source, dividende re-déclaré — porte la date de l'opération
  qu'il corrige, des mois avant la fenêtre, alors que les trades de ces mois-là en sont
  sortis depuis longtemps. Une telle ligne n'est ni écrite ni comptée dans la plage : ce
  jour-là appartient aux relevés, qui le rapportent en entier. Sans période déclarée, la
  plage se lit dans les seules données.
- **Le relevé HTML n'écrit qu'avant** `min(when)` Flex, en jours entiers. Sans ligne Flex,
  il importe tout.
- **L'agent n'écrit qu'après** le dernier **jour de marché** Flex, en jours entiers : une
  réponse Flex court jusqu'à la clôture de la veille, son dernier jour est complet. Le jour
  de marché d'une heure d'avant 04:00 est la veille, et celui d'un samedi ou d'un dimanche le
  vendredi précédent : IB passe les assignations d'une échéance dans la nuit qui la suit,
  parfois après minuit. Seules les lignes de l'agent sont lues ainsi ; Flex et les relevés
  gardent leur jour civil.
- **À chaque synchro Flex**, les lignes HTML et agent tombant dans ses jours sont
  supprimées et remplacées, dans la même écriture IndexedDB.

Conséquence assumée : une section décochée dans la Flex Query (typiquement Deposits &
Withdrawals) n'existe que dans les relevés, et à l'intérieur de la plage Flex elle est
supprimée sans être remplacée. L'avertissement listant les types supprimés est conservé,
affiché dans la page Sources de données, et ne se déclenche qu'une fois par nature.

**Une seule horloge** (sous-projet 18) : toute heure IB du ledger et des snapshots est
l'heure murale de New York stampée UTC. Flex et les relevés la donnent sans fuseau ;
l'agent rend du vrai UTC, ramené à cette horloge par `toReportTime`
(`packages/ib-parsers/src/common.ts`). Sans cela, et sans jours entiers, une assignation
que Flex date 16:20 et que TWS rend à 22:13 heure de New York serait comptée deux fois. La
même horloge ne suffit pas : il faut encore que la nuit qui suit une séance lui appartienne
(sous-projet 24), sinon une assignation passée à 01:02 le samedi échappe au vendredi que Flex
possède.

### 6.3 Parseurs (`packages/ib-parsers`)

Deux modules TS purs, tous deux sur **DOMParser** :

- **Flex XML** : Trades, Cash Transactions, Corporate Actions, Transfers, Open Positions.
  Rend des lignes de ledger et des positions à la veille avec cash disponible.
- **Relevé HTML** : mêmes sections que la première version (`Transactions`, `CombDiv`,
  `CombFees`, `CombInt`, `WithholdingTax`, `CorporateActions`, `CombDepWith`) plus `Transfers`.

Chaque parseur vérifie les sections et colonnes requises par palier et rend une liste de
manques lisibles (« section Open Positions absente », « colonne Trade Price absente »). Une
valeur absente reste `null`, jamais `0`. Une erreur de normalisation annule la synchro
entière, sans toucher au ledger.

Les fixtures de test sont les fichiers réels anonymisés de la première version.

### 6.4 Moteur de couverture (`packages/coverage`)

Port fidèle en TS de `ib_analysis` : classification, multiplicateur, description de
contrat, structures à risque défini dans l'ordre iron condor puis spreads, calls courts
couverts par actions puis LEAPS, puts courts sécurisés par cash uniquement, une position
longue ne couvre jamais deux jambes courtes, règle de rachat `current <= sale / BUYBACK_RATIO`,
`risk_value`, `required_cash`.

`BUYBACK_RATIO`, `MAX_STRUCTURE_LOSS`, `DEFAULT_MULTIPLIER` et les libellés sont définis
**une seule fois** dans ce paquet. Rien n'est recodé ailleurs.

Entrée : positions et cash, quelle que soit leur origine (Flex ou agent), dans un type
`Position` commun. Sortie : le `RiskReport` que consomment déjà les pages Positions et
Dashboard.

**Vérification du port** : au sous-projet 2, un oracle Python (le moteur de la première
version et un générateur de paires entrée/sortie) a prouvé que le moteur TS le reproduisait
à l'identique, et les 115 tests Python ont été portés un par un en Vitest. Le port acquis,
l'oracle a été retiré du dépôt (2026-09-17) : il ne suivait plus le moteur, n'attrapait
qu'une seule mutation que les tests écrits à la main laissaient passer — fixée depuis par un
test dédié — et portait un portefeuille réel anonymisé. Le moteur n'est plus fixé que par
ses tests Vitest.

### 6.5 Journaux et agrégations (`packages/ledger`)

Fonctions pures qui prennent le ledger d'un compte et rendent des structures prêtes à
tracer :

- Soldes cumulés par devise, règle des conversions de devises incluse (§3.5).
- Primes par mois, cumul, par sous-jacent, par secteur.
- **Wheel** : vente de put, assignation, ventes de call, sortie. Cycles datés, primes par
  cycle, cash immobilisé par mois.
- **LEAPS** : achat de call longue échéance et ventes de puts ou calls rattachées.
- **Condors** : détection des quatre jambes, ouverture, clôture, résultat.
- **Others** : ce qui ne loge dans aucune des trois.

Chaque journal est testé sur des fixtures de séquences de transactions, avec un test qui
échoue si l'appariement change. Les graphiques ECharts ne font que tracer ces sorties.

Les règles d'appariement sont fixées dans `2026-09-07-journaux-design.md`.

### 6.6 Comptes

Les comptes ne sont plus codés en dur. Ils vivent en IndexedDB : libellé, identifiant IB,
jeton et query id Flex, port de l'agent. Les routes `/accounts/:accountId/...` restent
identiques. Le dernier compte visité est mémorisé.

### 6.7 Table sectorielle

Le Dashboard agrège les primes par secteur. Le mapping ticker → secteur est une donnée
**personnelle** de l'utilisateur (l'ancien `company.csv` porte ses scores et statuts) : il ne
va pas dans le dépôt. Il vit en IndexedDB, un enregistrement par utilisateur et non par compte,
et fait partie de la sauvegarde chiffrée. Sa page, **Secteur et Score**, l'importe en CSV avec
les colonnes `Ticker`, `Name`, `Category`, `Score`, `Status` (les colonnes `S-*` sont ignorées),
**fusionné par ticker** : une colonne absente du fichier garde sa valeur, aucune ligne n'est
supprimée. La même page l'édite à la main. Chaque import Interactive Brokers (relevé, Flex,
agent) y ajoute les tickers d'actions et d'options qu'il ne connaît pas, sans jamais modifier
une ligne existante. Un ticker absent du mapping est classé « Sans secteur », jamais rejeté.
Livré avec le sous-projet 2, fusion, édition et ajout automatique au sous-projet 15.

### 6.8 Positions et cache hors ligne

Les positions courantes sont mises en cache en IndexedDB avec leur origine et leur
horodatage. Sans agent, elles datent de la veille (Flex). Avec agent, elles sont
rafraîchies à l'ouverture de page et sur bouton Actualiser. Sans TWS ni réseau, la page
affiche la dernière copie connue, jamais une erreur.

---

## 7. Serveur (`apps/api`)

### 7.1 Ce que le serveur sait

Des utilisateurs, et pour ceux qui l'ont activé, un blob chiffré opaque. **Rien d'autre.**
Aucune transaction, aucune position, aucun jeton Flex en base ni en journal.

### 7.2 Structure

Django écrit à la main, sans cookiecutter : un fichier de réglages d'une centaine de
lignes, variables d'environnement pour les secrets, PostgreSQL. **Pas de Redis ni de
Celery** tant qu'aucune tâche de fond n'existe. Deux apps :

- `core` : utilisateurs, invitations, sauvegarde chiffrée, futur paiement. Socle.
- `ib` : proxy Flex. Spécifique.

API par **Django Ninja**, client TS généré depuis l'OpenAPI, ce qui maintient la frontière
de types sans effort.

### 7.3 Authentification

- **django-allauth headless** : connexion, session par cookie, déconnexion, parcours MFA.
- **Inscription fermée.** Un administrateur crée l'invitation depuis l'admin Django ; le
  lien à usage unique permet de définir son mot de passe.
- **2FA TOTP optionnelle** par utilisateur via `allauth.mfa`, codes de secours.
- Rôles par groupes Django. Un seul rôle au départ, utilisateur.
- Emails en anglais et français par gettext.
- **L'application n'est pas fermée derrière la connexion** (amendement du sous-projet 3,
  §13). L'inscription reste fermée et sur invitation comme ci-dessus ; seule la porte
  change : aucune route du SPA n'est protégée, la connexion n'est exigée que pour appeler le
  proxy Flex (§7.4). Le serveur est optionnel au même titre que l'agent local (§2) : son
  absence ne produit jamais une erreur, seulement des fonctionnalités en moins.

### 7.4 Proxy Flex

**Note du 2026-09-16** : l'agent local relaie les mêmes deux appels (sous-projet 19,
`2026-09-16-relais-flex-agent-design.md`). Ce proxy ne sert plus qu'aux comptes en mode
« agent local et serveur », quand l'agent est absent.

Deux endpoints, un par étape du protocole Flex (`SendRequest`, `GetStatement`). Le
navigateur fournit jeton et query id à chaque appel. Le serveur relaie la réponse XML telle
quelle, **sans la parser ni la journaliser**, en respectant les délais de reprise IB.
Throttling Ninja par utilisateur aligné sur les limites IB. Réservé aux utilisateurs
connectés.

### 7.5 Sauvegarde chiffrée, opt-in

Trois endpoints : déposer, lire, supprimer le blob de l'utilisateur. Le serveur stocke des
octets opaques, un horodatage et une taille plafonnée (20 Mo). Un seul blob par utilisateur,
remplacé à chaque dépôt.

Côté navigateur :

- **Clé AES-GCM 256 générée par WebCrypto** au premier envoi, stockée en IndexedDB.
- **Affichée une seule fois** sous forme de code de récupération, à conserver par
  l'utilisateur. Le serveur ne la voit jamais.
- Restaurer sur un autre appareil demande ce code, une fois par appareil. Sur l'appareil
  habituel, rien n'est jamais demandé.
- Contenu : tout l'état local, comptes, jetons Flex, ledger, positions en cache, table sectorielle.
- **Désactivée par défaut.** L'utilisateur qui ne veut rien sur le serveur n'a rien à faire.

### 7.6 Paiement

Rien de câblé. `dj-stripe` est le chemin prévu, l'app `core` lui laisse la place.

---

## 8. Agent local (`apps/tws-agent`)

**Note du 2026-09-06** : deux endpoints, `GET /health` et `GET /snapshot?port=` ; le port TWS
est un paramètre de requête saisi dans le navigateur ; le fichier de configuration ne porte
que les origines et le port d'écoute ; le paquet est servi par le site
(`2026-09-06-agent-local-design.md` §3, §9) ; `POST /flex/send-request` et
`/flex/get-statement` relaient Flex (sous-projet 19).

Paquet Python `ib-tws-agent` d'environ 150 lignes : ib_async, la seule bibliothèque IB bien
maintenue, et un serveur HTTP minimal.

- Écoute sur `127.0.0.1` uniquement.
- Répond aux en-têtes CORS et Private Network Access **pour l'origine de l'application
  seulement**. Les navigateurs traitent localhost comme sûr même depuis une page HTTPS ;
  Chrome demande une permission une fois.
- Endpoints `GET /health`, `GET /positions`, `GET /executions/today`, un paramètre de port
  TWS par compte.
- Connexion à la demande en `clientId 0`, jamais persistante.
- Rend des données brutes. Tout calcul se fait dans le navigateur.
- Installation par `uv tool install` ou pipx, configuration en un fichier. Documentation
  pas à pas incluant les réglages API de TWS.

Le navigateur détecte l'agent par un ping sur `/health` à l'ouverture. Absent, l'application
reste au palier 1 ou 2 sans message d'erreur.

---

## 9. Pages et navigation

Structure de menu identique à la première version, plus deux pages dans la section
Configuration :

| Section | Page | Route | Nouveauté |
|---|---|---|---|
| Vue d'ensemble | Dashboard | `/accounts/:id/dashboard` | |
| | Positions | `/accounts/:id/positions` | |
| | Historique | `/accounts/:id/history` | |
| | Aujourd'hui | `/accounts/:id/today` | visible avec agent seulement |
| Stratégies | Journal Wheel | `/accounts/:id/journal/wheel` | |
| | Journal LEAPS | `/accounts/:id/journal/leaps` | |
| | Journal Condors | `/accounts/:id/journal/condors` | |
| | Journal Autres | `/accounts/:id/journal/others` | |
| Statistiques | Wheel | `/accounts/:id/stats/wheel` | |
| | LEAPS | `/accounts/:id/stats/leaps` | |
| | Condors | `/accounts/:id/stats/condors` | |
| Configuration | Sources de données | `/accounts/:id/sources` | remplace Portefeuilles |
| | Paramètres | `/settings` | nouvelle |

**Note du 2026-09-06** : la ligne Aujourd'hui disparaît ; une page Aide, `/help`, hors compte,
s'ajoute à la section Configuration.

**Note du 2026-09-07** : une quatrième page de journal, Journal Autres, accueille ce qui ne
loge dans aucune des trois stratégies ; une nouvelle section Statistiques ajoute trois pages,
Wheel, LEAPS, Condors, un histogramme mensuel par stratégie sans conversion de devises
(`2026-09-07-journaux-design.md` §7).

**Note du 2026-09-11** : une page Consistance, `/accounts/:id/consistency`, s'ajoute à la section
Configuration sous Sources de données. Elle réunit les positions non couvertes (venues du
Dashboard), la reconstitution du portefeuille (venue des Journaux) et la cohérence du cash (venue
de l'Historique) ; la barre de titre porte en permanence deux verdicts, Couverture et
Reconstitution, liés à cette page (`2026-09-11-consistance-design.md`).

**Sources de données** : par compte, jeton et query id Flex, état de la dernière synchro,
sections Flex manquantes, import de relevés HTML avec compte rendu (lignes importées,
ignorées, types supprimés), import CSV de la table sectorielle, détection de l'agent.

**Paramètres** : sauvegarde serveur (activer, dernière date, supprimer, code de
récupération, restaurer), export et import JSON local du ledger, langue, thème, 2FA.

Composants, thème, clés i18n et pages de la première version sont copiés. Seule la source
des données change : hooks sur IndexedDB au lieu d'appels API.

---

## 10. Sécurité et vie privée

| Donnée | Où elle vit | Qui peut la lire |
|---|---|---|
| Transactions, positions | IndexedDB du navigateur | l'utilisateur |
| Jeton et query id Flex | IndexedDB | l'utilisateur ; transitent par l'agent local, et par le proxy serveur en mode « agent local et serveur » quand l'agent est absent ; jamais journalisés |
| Blob de sauvegarde | PostgreSQL du VPS | personne sans le code de récupération |
| Compte utilisateur, mot de passe haché, secret TOTP | PostgreSQL | le serveur |
| Données live TWS | agent local, jamais le serveur | l'utilisateur |

Le jeton Flex est en lecture seule chez IB. Le mot de passe n'est pas demandé une seconde
fois ; le seul secret supplémentaire est le code de récupération, requis uniquement pour
restaurer sur un nouvel appareil.

Vider les données du navigateur sans sauvegarde serveur ni export impose de réimporter les
relevés HTML ; les 365 jours Flex se rechargent seuls.

---

## 11. Tests

| Couche | Outil | Portée |
|---|---|---|
| `ledger` | Vitest | Propriété de plage, soldes, journaux sur fixtures de séquences |
| `ib-parsers` | Vitest | Fichiers réels anonymisés : sections, sous-totaux, quantités négatives, multi-devises, conversions |
| `coverage` | Vitest | Tests écrits à la main, dont les 115 portés du moteur Python de la première version |
| `apps/web` | Vitest + Testing Library | Pages, navigation, formatage |
| `apps/api` | pytest + Ninja TestClient | Auth, invitations, throttling, proxy stubbé, sauvegarde |
| `apps/tws-agent` | pytest, ib_async stubbé | Endpoints, CORS, TWS éteint |
| Bout en bout | Playwright | Invitation, connexion, 2FA, langue, thème, parcours palier 1 complet |

Règle héritée : **un test doit échouer si le comportement change**, pas seulement couvrir
des lignes. Aucune constante métier n'est codée en dur hors de `coverage`.

---

## 12. Sous-projets, dans l'ordre

Chacun a son spec et son plan. Chaque étape livre quelque chose d'utilisable.

1. **Socle du monorepo et Historique au palier 2, sans serveur.** Squelette pnpm/uv,
   `packages/ui`, `ledger`, `ib-parsers` (HTML et Flex XML depuis fichier), IndexedDB,
   coquille web copiée, page Historique avec soldes cumulés.
2. **Couverture et positions.** `coverage` porté avec l'oracle, positions depuis Open
   Positions Flex, pages Positions et Dashboard, import de la table sectorielle.
3. **Serveur.** Django mince, invitations, 2FA, proxy Flex, synchro à l'ouverture,
   déploiement sur le VPS derrière le Traefik existant. **Livré (2026-09-04)**, à
   l'exception de la mise en ligne réelle : les deux images Docker se construisent, la pile
   Compose valide, la procédure est écrite et tracée commande par commande dans
   `docs/deploiement-vps.md`, mais le site n'a jamais répondu en HTTPS. La suite demande un
   accès SSH au VPS, le nom de domaine, le nom du réseau Traefik et une source de clone
   atteignable depuis le VPS — quatre informations que seul l'utilisateur peut fournir.
4. **Agent local et Aujourd'hui.** Paquet Python, détection, positions intraday.
   **Fait (2026-09-06)**, sans page Aujourd'hui.
5. **Journaux** Wheel, LEAPS, Condors, avec leurs graphiques. **Fait (2026-09-07)**, avec un
   quatrième journal, Others, et trois pages de statistiques
   (`2026-09-07-journaux-design.md`).
6. **Sauvegarde chiffrée et Paramètres.**

---

## 13. Décisions écartées, et pourquoi

| Écarté | Raison |
|---|---|
| Flex Query appelée depuis le navigateur | Pas de CORS chez IB, vérifié |
| Relais navigateur → serveur → agent (WebSocket sortant) | Un agent sur localhost avec CORS suffit tant que TWS et le navigateur sont sur la même machine, et le serveur ne voit alors aucune donnée live. Possible plus tard pour consulter depuis un autre appareil |
| Transactions, positions et secteurs stockés côté serveur | L'architecture de la première version (`portfolio.Transaction`, `SectorMap`, `PositionSnapshot` en PostgreSQL). Le serveur ne voit aucune donnée de portefeuille : c'est la contrainte fondatrice, pas un détail d'implémentation. Le ledger vit en IndexedDB, la sauvegarde chiffrée du sous-projet 6 ne rend le serveur ni lisible ni responsable |
| Ingestion Flex ou relevés HTML côté serveur | Même raison : le fichier et son contenu ne quittent pas le navigateur. Le serveur ne fait que relayer l'appel Flex, jeton en transit, jamais journalisé |
| Moteur de couverture sur le serveur, endpoint sans état | Les positions transiteraient par le serveur. Le port TS, vérifié par oracle, garde tout dans le navigateur |
| Moteur de couverture dans l'agent | Les paliers 1 et 2 n'ont pas d'agent |
| Serveur tout TypeScript (Hono, better-auth, Drizzle) | Viable pour cette application, mais les projets futurs de taille ERP tirent vers l'ORM, les migrations, les permissions et l'admin de Django, éprouvés depuis quinze ans avec un cycle LTS |
| cookiecutter-django | Squelette trop lourd pour un serveur de trois endpoints, il noyait le code applicatif |
| Celery, Redis | Aucune tâche de fond : la synchro Flex se fait à l'ouverture, la fenêtre de 365 jours le permet |
| Clé de sauvegarde dérivée du mot de passe | Le mot de passe transite par le serveur à la connexion, la clé ne serait plus hors de sa portée |
| Positions dérivées du ledger comme source de vérité | Transferts de titres et opérations sur titres rendent le calcul fragile ; Open Positions Flex est fiable |
| Turborepo dès le départ | Inutile avec trois paquets ; s'ajoute en dix minutes quand le besoin apparaît |
| Application fermée derrière la connexion | Décidé au sous-projet 3 : cohérent avec l'agent local (§2) ; supprime le mode « grâce hors ligne », son marqueur de session et ses tests ; les paliers 1 et 2 par relevés HTML restent utilisables sans compte |
| L'agent fait toute la synchro Flex en un appel | La boucle d'attente existerait en Python et en TS, pour une requête HTTP de plus d'une minute (sous-projet 19) |

---

## 14. Références

- [Flex Web Service](https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service/)
- [`ib_async`](https://github.com/ib-api-reloaded/ib_async)
- [`django-allauth` — Headless](https://docs.allauth.org/en/latest/headless/introduction.html) · [MFA](https://docs.allauth.org/en/latest/mfa/introduction.html)
- [Django Ninja — Throttling](https://django-ninja.dev/guides/throttling/)
- [Dexie](https://dexie.org/)
- [Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight)
