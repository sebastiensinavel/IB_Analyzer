# Sous-projet 3 — Serveur Django, invitations, proxy Flex, VPS

> Spec validé en brainstorming le 4 septembre 2026. Décline le spec fondateur
> `2026-09-03-architecture-design.md` (§5, §7, §9, §10, §11, §12), qui reste la référence
> pour tout ce qui n'est pas précisé ici. Les sous-projets 1
> (`2026-09-03-socle-historique-design.md`) et 2 (`2026-09-03-couverture-positions-design.md`)
> fixent les conventions de `ledger`, `ib-parsers`, `coverage` et de la base Dexie que ce
> spec étend.

---

## 1. Périmètre

Livrer le serveur : un utilisateur invité crée son compte sur un site en HTTPS, s'y
connecte, saisit son jeton Flex, et l'application synchronise ses transactions et ses
positions toute seule à l'ouverture d'un compte.

**Dans le périmètre :**

- `apps/api` : Django mince, apps `core` (utilisateur, invitations) et `ib` (proxy Flex).
- `apps/web` : profil local par utilisateur, session, écrans de connexion et d'invitation,
  page `/settings` section « Compte », saisie du jeton Flex, synchro et son état.
- `packages/ib-parsers` : lecture des enveloppes de réponse du Flex Web Service.
- Frontière de types : `openapi.json` committé côté API, `schema.d.ts` généré côté web.
- `deploy/traefik/` : le Traefik unique du VPS, à installer.
- `docker-compose.yml`, `Dockerfile` de `web` et d'`api`, `docs/deploiement-vps.md`.
- Workspace uv à la racine.
- Mise à jour de `CLAUDE.md`, du spec fondateur et de `docs/points-reportes.md`.

**Hors périmètre :**

- Sauvegarde chiffrée, code de récupération, export/import JSON local (sous-projet 6).
- Paiement (§7.6).
- Agent local, page Aujourd'hui, bouton Actualiser (sous-projet 4).
- Envoi d'emails, réinitialisation de mot de passe en autonomie : l'administrateur recrée
  une invitation.
- Sauvegarde de PostgreSQL, intégration continue.

---

## 2. La décision structurante : le serveur est optionnel

**La connexion n'est jamais exigée pour utiliser l'application.** Elle est exigée pour
appeler le proxy Flex, et pour rien d'autre. Aucune route du SPA n'est protégée : un
utilisateur sans compte importe ses relevés HTML, consulte son historique, ses positions et
sa couverture exactement comme aujourd'hui.

Le serveur devient donc optionnel au même titre que l'agent local l'est déjà (spec
fondateur §2) : **son absence ne produit jamais une erreur, seulement des fonctionnalités en
moins.** Un serveur injoignable grise la synchro et n'affiche rien en travers de
l'application.

Ceci amende le §7.3 du spec fondateur, qui décrivait comment on obtient un compte sans
jamais dire que l'application était fermée derrière une porte. Le §7.3 reste vrai :
inscription fermée, invitation à usage unique, 2FA optionnelle. Seule la porte change.

Conséquence directe : il n'y a **pas de mode « grâce hors ligne »**, pas de marqueur de
session présumée, pas d'état intermédiaire à tester. L'application s'ouvre, toujours.

---

## 3. `apps/api` : structure

```
apps/api/
  pyproject.toml        projet uv, membre du workspace racine
  manage.py
  config/
    settings.py         ~120 lignes, secrets par variables d'environnement
    urls.py             /api (Ninja), /_allauth (headless), /admin
    wsgi.py
  core/                 socle réutilisable : User, Invitation, admin, api.py
  ib/                   spécifique IB : proxy Flex
  tests/
  Dockerfile
```

Django écrit à la main, pas de cookiecutter (§13). Pas de Redis, pas de Celery (§13).
PostgreSQL. `core` ne contient rien d'IB : c'est le socle que les projets suivants
reprendront tel quel (§5).

### 3.1 Modèle utilisateur

`core.User` hérite d'`AbstractBaseUser`, **dès le premier commit** : Django ne permet pas de
changer de modèle utilisateur après la première migration. L'email est l'identifiant de
connexion, il n'y a pas de `username`. Rôles par groupes Django, un seul rôle au départ.

### 3.2 Versions

CLAUDE.md fixe Python 3.14, et la Django LTS courante ne le supporte peut-être pas encore.
Règle : **on prend la Django LTS la plus récente et la version de Python qu'elle supporte**,
`apps/api` épinglant la sienne dans son `pyproject.toml` si elle diverge des autres projets
uv du dépôt. Le constat réel est fait à la première tâche du plan et écrit dans
`apps/api/README.md`.

### 3.3 Workspace uv

Un `pyproject.toml` à la racine déclare le workspace uv annoncé au §5, avec `apps/api` et
`tools/coverage-oracle` comme membres ; `apps/tws-agent` s'y ajoutera au sous-projet 4.

`pnpm check` **ne lance toujours pas de Python** : il reste `lint && typecheck && build &&
test`. Un script racine `pnpm test:api` appelle pytest, documenté dans le README comme une
commande à part, à passer avant tout merge touchant `apps/api`.

---

## 4. Authentification et invitations

### 4.1 `allauth` headless

`django-allauth` en mode headless, client navigateur, monté sous `/_allauth/browser/v1/`. Il
fournit session, connexion, déconnexion, changement de mot de passe et tout le parcours MFA.
La session est une session Django ordinaire par cookie ; l'origine étant unique (§7), le
cookie est `SameSite=Lax` et la protection CSRF reste active et non assouplie.

Les chemins exacts des endpoints headless sont ceux de la version d'`allauth` retenue, lus
dans sa documentation à l'implémentation, pas devinés.

### 4.2 Inscription fermée

L'adaptateur de compte rend `is_open_for_signup()` faux. L'endpoint d'inscription
d'`allauth` refuse donc systématiquement. **Le seul chemin d'entrée est l'invitation.**

### 4.3 `core.Invitation`

| Champ | Rôle |
|---|---|
| `token` | aléatoire cryptographique, urlsafe, unique |
| `email` | l'invité prévu ; l'utilisateur créé porte cet email |
| `created_by`, `created_at` | traçabilité |
| `expires_at` | par défaut 14 jours |
| `accepted_at`, `accepted_user` | usage unique : renseignés, le jeton est mort |

Créée depuis l'admin Django, qui **affiche le lien complet** en lecture seule sur la fiche.
L'administrateur le transmet lui-même : aucun SMTP n'est configuré, le backend email reste
celui de développement.

### 4.4 `POST /api/core/invitations/accept`

Corps `{token, password}`. Valide le jeton, applique les validateurs de mot de passe de
Django, crée l'utilisateur, marque l'invitation acceptée et ouvre la session.

**Un jeton inconnu, expiré ou déjà accepté rendent la même erreur indiscernable**, pour ne
rien divulguer sur l'existence d'une invitation. C'est le seul endpoint `core` de ce
sous-projet.

### 4.5 2FA

`allauth.mfa`, TOTP, **optionnelle par utilisateur**. Codes de secours affichés une seule
fois à l'activation. Un utilisateur sans 2FA se connecte normalement. L'activation, la
désactivation et la régénération des codes passent par les endpoints headless d'`allauth`,
depuis `/settings`.

---

## 5. `ib` : proxy Flex

### 5.1 Les deux endpoints

```
POST /api/ib/flex/send-request    {token, queryId}        → XML brut
POST /api/ib/flex/get-statement   {token, referenceCode}  → XML brut
```

Réservés aux utilisateurs connectés (`401` sinon).

**`POST` avec corps, jamais `GET` avec query string** : le jeton ne traverse aucune URL de
notre côté, donc aucun journal d'accès. Il part en query string vers IB — c'est leur
protocole — et ça s'arrête à la requête sortante.

### 5.2 Passe-plat intégral

Le corps de la réponse d'IB est renvoyé **tel quel, avec son type de contenu**, y compris
quand IB répond `Fail` avec un `ErrorCode`, ce qu'il fait en HTTP 200. Le serveur ne lit pas
ce XML, ne le parse pas, ne le journalise pas (§7.4). C'est `ib-parsers`, dans le navigateur,
qui en extrait le code de référence, le statut et les codes d'erreur.

Les seules réponses que le serveur fabrique lui-même :

| Code | Quand | Corps |
|---|---|---|
| `401` | pas de session | JSON, code d'erreur |
| `429` | throttle atteint | JSON + en-tête `Retry-After` |
| `502` | IB injoignable ou réponse illisible au niveau transport | JSON, code d'erreur |
| `504` | délai amont dépassé | JSON, code d'erreur |

Le corps amont n'est **jamais** réémis dans ces cas.

### 5.3 Throttling

Throttle Ninja par utilisateur, aligné sur les limites IB du §3.2 du spec fondateur :
**10 requêtes par minute et une par seconde**. Les deux bornes sont posées dans `ib`, une
seule fois, et testées.

### 5.4 Aucune journalisation du corps

La configuration de journalisation exclut les corps de requête et de réponse. Un test pytest
capture les journaux pendant un appel complet et **échoue si le jeton y apparaît**.

### 5.5 Santé

`GET /api/health` rend `200` sans toucher à la base au-delà d'un `SELECT 1` : sonde de
Compose et de Traefik.

---

## 6. Frontière de types

`openapi-typescript` (génération de types, aucun runtime) et `openapi-fetch` (~2 ko sur
`fetch`, générique sur ces types). Le client TS généré demandé au §7.2 du spec fondateur
est ce couple.

Chaîne de fraîcheur, sans jamais lancer Python depuis `pnpm check` :

1. `apps/api` committe `openapi.json`, exporté depuis Ninja. **Un test pytest échoue si le
   fichier committé diffère du schéma courant.**
2. `apps/web` committe `src/api/schema.d.ts`, généré depuis ce JSON par `pnpm gen:api`.
   **`pnpm check` régénère dans un fichier temporaire et échoue en cas d'écart.**

Ainsi une dérive Python → TS est un build rouge, et la règle « `pnpm check` ne lance jamais
de Python » tient : la comparaison est TS ↔ JSON, la comparaison JSON ↔ Django est du
ressort de pytest.

**Portée honnête de cette garantie.** Le passe-plat du §5.2 rend des chaînes XML opaques :
la génération ne type pas le contenu Flex. Sa valeur porte sur les corps de requête, les
formes d'erreur, l'endpoint d'invitation, et ce que les sous-projets 5 et 6 ajouteront.

Les endpoints d'`allauth` headless ne sont pas dans l'OpenAPI de Ninja. `allauth` publie sa
propre spécification OpenAPI pour le mode headless : **à vérifier à l'implémentation**. Si
elle est exploitable, elle passe dans le même générateur ; sinon ces appels s'écrivent à la
main dans un module dédié, `apps/web/src/api/allauth.ts`.

---

## 7. `apps/web` : le profil local

### 7.1 Le problème

`db` est aujourd'hui une instance de module créée une fois pour toutes
(`export const db = new AppDatabase()` dans `db/schema.ts`). Le nom de la base dépendant
désormais de la session, cette instance doit pouvoir être remplacée. **C'est la modification
la plus invasive du sous-projet côté navigateur.**

### 7.2 La règle

| Situation | Base |
|---|---|
| Personne n'est connecté | `ib-analyzer` — le profil par défaut |
| Utilisateur connecté | `ib-analyzer-<userId>` |

`userId` est l'identifiant serveur de l'utilisateur, stable et non devinable, rendu par
l'endpoint de session.

### 7.3 Adoption

À la **première** connexion d'un utilisateur pour lequel aucune base n'existe encore, le
profil par défaut est adopté : ses tables sont copiées dans `ib-analyzer-<userId>`, puis la
base source est supprimée. Rien n'est perdu pour l'utilisateur qui a commencé sans compte.

L'adoption n'a lieu **qu'une fois par utilisateur** : à la deuxième connexion, une base
existe déjà et le profil par défaut, s'il a été regarni entre-temps, reste intact et
distinct. La déconnexion ramène au profil par défaut.

### 7.4 La forme

Un `ProfileProvider` ouvre la bonne base au démarrage et à chaque changement de session, et
la fournit par contexte. `db/hooks.ts`, `importFile`, `sectors` et `accounts` la reçoivent
au lieu de l'importer. Les tests, qui sèment déjà une base `fake-indexeddb`, en profitent :
ils fournissent la leur par le même chemin.

---

## 8. `apps/web` : session et écrans

### 8.1 `useSession()`

Un hook sur l'endpoint de session d'`allauth`. **Trois états, jamais plus :**

| État | Effet |
|---|---|
| connecté | email affiché, synchro Flex disponible |
| non connecté | « Se connecter » affiché, synchro indisponible avec son motif |
| serveur injoignable | identique à « non connecté », plus une mention discrète |

Le troisième état n'est jamais une erreur affichée en travers de l'application (§2).

### 8.2 Écrans

| Route | Contenu |
|---|---|
| `/login` | email, mot de passe, puis l'étape du second facteur si l'utilisateur en a un |
| `/invitation/:token` | choix du mot de passe, erreurs de validation Django rendues lisibles |
| `/settings` | section « Compte » : email, changement de mot de passe, 2FA et codes de secours |

`/settings` naît ici. La sauvegarde chiffrée viendra s'y ajouter au sous-projet 6 ; langue et
thème restent dans la barre latérale, où ils fonctionnent déjà.

Dans le pied de la barre latérale, un élément affiche « Se connecter » ou l'email de
l'utilisateur connecté, avec la déconnexion.

Toutes les chaînes passent par `i18n/en.json` et `i18n/fr.json`, comme le reste.

---

## 9. `apps/web` : la synchro Flex

### 9.1 Schéma Dexie, version 3

`AccountRecord` gagne quatre champs :

```ts
/** Jeton Flex Web Service, saisi par l'utilisateur. Ne quitte le navigateur que vers le proxy. */
flexToken?: string;
/** Query id de la Flex Query du compte. */
flexQueryId?: string;
/** Horodatage ISO de la dernière synchro réussie. */
lastFlexSyncAt?: string;
/** Résultat de la dernière tentative, pour l'affichage de Sources de données. */
lastFlexSyncStatus?: { at: string; ok: boolean; code?: string };
```

### 9.2 `packages/ib-parsers` : les enveloppes

Deux fonctions pures, à côté de `parseFlexXml` :

- `parseFlexSendRequest(xml)` → `{ referenceCode }` ou `{ errorCode, errorMessage }`.
- `parseFlexStatementEnvelope(xml)` → `{ ready: true }` quand le corps est un relevé,
  `{ errorCode, errorMessage }` quand c'est une enveloppe d'erreur. Elle **ne parse pas le
  relevé** : elle dit seulement lequel des deux on tient.

Quand l'enveloppe est prête, le même XML part dans `parseFlexXml`, inchangé.

### 9.3 `flex/sync.ts`

L'orchestration, un seul module :

1. `send-request` ; sur erreur IB, arrêt avec le code.
2. `get-statement` en boucle, avec les attentes du §3.2 du spec fondateur : **5 s** sur
   `1009` et `1019`, **10 s** sur `1018`, plafond d'essais au-delà duquel on abandonne
   proprement.
3. Le XML de relevé part dans le `planImport`/`importFile` existant, source `flex`.
4. `lastFlexSyncAt` et `lastFlexSyncStatus` sont écrits dans tous les cas.

**Déclenchement :** à l'entrée sur un compte, si une session est ouverte, si le compte a un
jeton et un query id, et si la dernière synchro réussie a **plus de 12 heures**. Le seuil est
une constante nommée, dans `apps/web`. Plus un bouton « Synchroniser » sur Sources de
données, sans condition de péremption.

Sans session, sans jeton ou hors ligne : **aucune tentative**, et un message qui dit
pourquoi. Jamais une erreur.

### 9.4 La dette du sous-projet 2 se paie ici

`importFile` lit l'état existant hors de sa transaction
(`docs/points-reportes.md`, « À traiter au sous-projet 3 »). Avec une synchro de fond
capable de croiser un import manuel, c'est un vrai bug : les deux calculeraient leur plan sur
une vue périmée du ledger.

Correction en deux temps : **lecture de l'état dans la transaction**, et **verrou de flux
unique** qui sérialise les imports, quelle que soit leur origine.

### 9.5 Sources de données

La page gagne, par compte : la saisie du jeton (champ masqué) et du query id, l'état de la
dernière synchro, le bouton « Synchroniser », et le motif quand la synchro est indisponible.
Le jeton est stocké en IndexedDB et n'est envoyé qu'au proxy.

---

## 10. Déploiement

### 10.1 Topologie

Une seule origine, un seul sous-domaine. Traefik route par chemin :

```
Host(<domaine>) && PathPrefix(/api, /admin, /_allauth)  →  api
Host(<domaine>)                                          →  web
```

Trois services dans la pile de l'application :

| Service | Rôle |
|---|---|
| `web` | nginx alpine : le build Vite, repli SPA sur `index.html` |
| `api` | Django sous gunicorn, WhiteNoise pour les statiques de l'admin |
| `db` | PostgreSQL, sur le réseau interne uniquement, jamais exposé |

Traefik ne sert pas de fichiers statiques : d'où le conteneur `web`.

### 10.2 Traefik, infrastructure du VPS

Traefik n'est pas encore installé : ce sous-projet le pose. `deploy/traefik/` porte sa pile
Compose, le réseau Docker externe partagé qu'il crée, le résolveur ACME (défi HTTP-01 sur le
port 80), la redirection HTTP → HTTPS, le **tableau de bord désactivé**, et le volume
`acme.json` en permissions `600`.

Le README l'étiquette explicitement : **infrastructure du VPS, pas de cette application.**
Elle vit ici parce que ce dépôt est le premier occupant, et déménagera dans son propre dépôt
à l'arrivée d'une deuxième application.

### 10.3 Le nom de domaine n'est pas dans le dépôt

Aucun fichier versionné ne nomme le site. Le spec, les fichiers Compose et
`docs/deploiement-vps.md` parlent de `<domaine>` ; la valeur réelle vit dans le `.env` du
VPS, non versionné, dont les labels Traefik, `ALLOWED_HOSTS` et `CSRF_TRUSTED_ORIGINS` sont
interpolés.

Le sous-domaine devra porter des **tirets, jamais d'underscore** : l'underscore n'est pas
valide dans un nom d'hôte (RFC 1123) et les autorités de certification l'interdisent, donc
Let's Encrypt refuserait d'émettre et le site ne répondrait jamais en HTTPS.

### 10.4 Règles d'exploitation

- Secrets par variables d'environnement, `.env` sur le VPS, `.env.example` versionné.
- **Les migrations ne tournent pas au démarrage du conteneur** : c'est une commande
  explicite de la procédure, pour qu'aucune concurrence ne soit possible.
- ufw inchangé : `deny incoming`, seuls 80, 443 et 2002 ouverts.
- `docs/deploiement-vps.md` porte la procédure ordonnée : poser Traefik et vérifier son
  certificat, construire et pousser les images, poser le `.env`, démarrer la pile, migrer,
  créer le super-utilisateur, créer la première invitation, vérifier en HTTPS.

---

## 11. Paliers de livraison

Une seule branche, trois paliers vérifiables. Les cases du plan se cochent dans le worktree
au fur et à mesure.

| Palier | Critère d'acceptation |
|---|---|
| **A** | `apps/api` tourne en local : admin, invitation créée, compte créé par le lien, connexion, 2FA activable, `pnpm test:api` vert. Le SPA continue de fonctionner sans serveur. |
| **B** | Traefik posé sur le VPS avec un certificat valide ; la pile déployée ; le site répond en HTTPS ; une invitation créée dans l'admin permet de créer son compte et de se connecter depuis internet. |
| **C** | Jeton et query id saisis dans Sources de données ; synchro à l'ouverture d'un compte périmé ; bouton manuel ; l'historique et les positions se remplissent sans import de fichier. |

Le palier B se fait à deux, à la main, sur le VPS.

---

## 12. Tests

Règle inchangée : **un test doit échouer si le comportement change.**

### 12.1 pytest, `apps/api`

| Ce qui est vérifié |
|---|
| Invitation valide → compte créé et session ouverte |
| Invitation inconnue, expirée, déjà acceptée → **la même erreur indiscernable** |
| Les validateurs de mot de passe de Django s'appliquent |
| L'inscription `allauth` est bien fermée |
| Proxy sans session → `401` |
| Proxy au-delà de 10/min → `429` avec `Retry-After` ; au-delà de 1/s → `429` |
| Le corps XML d'IB ressort **octet pour octet**, `Fail` compris, IB stubbé |
| Délai amont → `504`, IB injoignable → `502`, sans réémettre de corps amont |
| **Le jeton n'apparaît dans aucun journal** capturé pendant un appel complet |
| `openapi.json` committé est à jour |

### 12.2 Vitest, `apps/web`

| Ce qui est vérifié |
|---|
| Les attentes 5 s / 10 s de la boucle Flex, en horloge simulée |
| Le plafond d'essais abandonne proprement et écrit `lastFlexSyncStatus` |
| La règle de péremption à 12 heures déclenche, ou non |
| Aucune tentative sans session, sans jeton, ou hors ligne |
| L'adoption de profil copie **toutes** les tables et supprime la source |
| Une deuxième connexion n'adopte pas une seconde fois |
| Les trois états de `useSession()` |
| Le verrou d'import unique sérialise synchro et import manuel |
| `schema.d.ts` committé est à jour (dans `pnpm check`) |

### 12.3 Playwright

Invitation → mot de passe → connexion → activation 2FA → déconnexion. Et une synchro
complète contre un proxy stubbé.

---

## 13. Décisions prises pendant le brainstorming

| Décision | Raison |
|---|---|
| **Le serveur est optionnel**, la connexion n'est exigée que pour le proxy | Cohérent avec l'agent local (§2) ; supprime le mode « grâce hors ligne », son marqueur de session et ses tests ; les paliers 1 et 2 par relevés HTML restent utilisables sans compte |
| Le code d'activation crée **un vrai compte**, pas une clé d'API | Les sous-projets 5 et 6 (sauvegarde chiffrée), et le §7.6 (paiement), ont besoin d'une identité durable et récupérable sur un autre appareil sans repasser par l'administrateur ; et une clé d'API n'a pas de second facteur |
| Invitation **transmise à la main**, aucun SMTP | Cercle d'invités restreint ; rien à configurer, aucun domaine à authentifier, rien à mocker en test |
| 2FA **optionnelle**, livrée maintenant | La lettre du §7.3 ; imposer la 2FA obligerait à construire un chemin de récupération crédible |
| **Une base IndexedDB par utilisateur**, avec adoption du profil par défaut | Seule option qui tient la promesse de confidentialité sur un poste partagé sans faire perdre les données de qui a commencé sans compte |
| **Même origine**, SPA servi par un conteneur nginx routé par Traefik | Cookie `SameSite=Lax`, ni CORS ni CSRF cross-site à assouplir ; et Traefik ne sert pas de fichiers statiques |
| Proxy **transparent**, boucle de reprise dans le navigateur | Lettre du §7.4 ; requêtes courtes, aucun délai Traefik ou gunicorn à négocier ; le jeton reste moins longtemps côté serveur ; la reprise se teste en Vitest |
| `openapi-typescript` + `openapi-fetch` | Un seul fichier de types committé, diff lisible en revue, zéro runtime généré ; `hey-api`/`orval` ne se rentabilisent pas à trois endpoints |
| Fraîcheur vérifiée en **deux maillons** (pytest JSON↔Django, `pnpm check` TS↔JSON) | Garde intacte la règle « `pnpm check` ne lance jamais de Python » |
| **Le nom de domaine n'entre pas dans le dépôt** | Demande de l'utilisateur ; il vit dans le `.env` du VPS |
| Traefik posé par ce sous-projet, dans `deploy/traefik/` | Il n'existe pas encore sur le VPS et notre application est la première ; étiqueté comme infrastructure partagée, déménageable |
| **Pas de CI** | `origin` est un dépôt local, aucune forge n'héberge le code : il n'y a aucun serveur pour l'exécuter. Reporté |
