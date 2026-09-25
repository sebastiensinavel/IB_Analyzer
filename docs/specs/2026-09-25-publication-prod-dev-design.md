# Sous-projet 32 — Publication : une prod et une dev sur le VPS

Statut : livré (2026-09-25), mise en ligne à la tâche 5 du plan.

Le sous-projet 3 a livré les images, la pile Compose et un Traefik dans `deploy/traefik/`,
mais le site n'a jamais répondu en HTTPS. Ce sous-projet le met en ligne, en **deux
instances** sur le même VPS :

- **la prod**, sur `<domaine-prod>`, démarrée automatiquement au boot ;
- **la dev**, sur `<domaine-dev>`, publique pour montrer une branche à des utilisateurs
  externes, que l'on démarre, arrête et remet à zéro d'une commande.

Aucun nom de domaine n'apparaît dans ce document ni dans aucun fichier versionné : les vrais
noms vivent dans les `.env` du VPS et dans `/srv/infra`, hors de ce dépôt.

---

**Amendement de la revue de branche (2026-09-25)** : l'instance se nomme par `IBA_INSTANCE`
(`prod`, `dev`) et la pile par `name: iba-${IBA_INSTANCE}`, jamais par `COMPOSE_PROJECT_NAME`,
que Compose remplit du nom du dossier quand il manque — une pile `prod` vide serait née à côté
d'`iba-prod`. Partout ci-dessous, lire `iba-${IBA_INSTANCE}` pour `${COMPOSE_PROJECT_NAME}`.
`/usr/local/bin/iba` est un lanceur installé (`deploy/iba-launcher`), pas un lien : `/srv/iba`
en 750 rendrait le lien illisible pour un autre compte. `db` porte une sonde `pg_isready` et
`api` l'attend, l'API une sonde rapprochée au démarrage.

## 1. Périmètre

**Critère de réussite :** sur le VPS, `<domaine-prod>` et `<domaine-dev>` répondent en HTTPS
avec un certificat valide, chacune sur sa propre base ; le site vitrine déjà servi par le VPS
répond comme avant, liste blanche comprise ; `/admin/` est introuvable depuis internet et
joignable par tunnel SSH ; après un redémarrage du VPS la prod répond et la dev est arrêtée ;
`iba dev reset` rend une dev vide, `iba prod reset` est refusé ; `pnpm check` et
`pnpm test:api` passent.

Dans le périmètre : la topologie (§2), la pile de l'application (§3), le script
d'exploitation (§4), le démarrage et les sauvegardes (§5), l'infrastructure partagée (§6), la
bascule depuis Caddy (§7), la documentation (§8), les tests (§9).

Hors périmètre : une copie des sauvegardes hors du VPS ; GoAccess, Prometheus ou tout
tableau de trafic (les journaux d'accès JSON de Traefik les rendent possibles, rien de plus) ;
un dépôt distant pour `/srv/infra` ; le déploiement automatique à la poussée d'une branche ;
retirer `seb` du groupe `docker`.

## 2. Topologie

```
Internet :80 / :443
   │
Traefik v3 (/srv/infra/traefik, utilisateur infra)
   │   réseau Docker externe partagé « traefik »
   ├── site vitrine            (/srv/infra/vitrine : nginx, dossier du site en lecture seule)
   ├── <domaine-prod>          (/srv/iba/prod, projet Compose iba-prod)
   └── <domaine-dev>           (/srv/iba/dev,  projet Compose iba-dev, X-Robots-Tag noindex)

127.0.0.1 seulement, par tunnel SSH :
   8201 → api de la prod (admin) · 8211 → api de la dev (admin) · 8080 → tableau de bord Traefik
```

**Un utilisateur par application, un pour l'infrastructure** : `iba` possède `/srv/iba` (les
deux clones, les `.env`, les sauvegardes), `infra` possède `/srv/infra`. Tous deux sont dans le
groupe `docker`, sans `sudo`. La séparation est organisationnelle : le groupe `docker` vaut
root, ce que la documentation dit en clair.

**Prod et dev sont distinctes par leur nom de projet Compose** : volumes (`iba-prod_pgdata`,
`iba-dev_pgdata`), réseau interne, PostgreSQL, secret Django, mots de passe, `.env`, tout est
propre à chaque instance. Seul le réseau Traefik est partagé, et la base n'y est jamais
branchée. Côté navigateur, les deux domaines sont deux origines : deux bases IndexedDB.

**La prod suit un tag** (`vAAAA.MM.JJ` posé sur `main`), **la dev une branche quelconque** :
`iba dev deploy <branche>` pour la montrer, merge et tag une fois validée, `iba prod deploy
<tag>` pour la livrer.

## 3. La pile de l'application

### 3.1 `docker-compose.yml`

- **Noms Traefik par instance.** Routeurs, services et middlewares sont préfixés par
  `${COMPOSE_PROJECT_NAME}` : `…routers.${COMPOSE_PROJECT_NAME}-web`, `-api`, et le
  middleware `-headers`. Deux piles derrière le même Traefik qui déclareraient `ibweb`
  se disputeraient le même routeur. `COMPOSE_PROJECT_NAME` vient du `.env` de l'instance,
  qui fixe aussi le nom de projet : une seule variable, jamais deux à tenir en phase.
  L'implémentation vérifie par `docker compose config` qu'elle est bien interpolée dans les
  labels.
- **`restart: ${RESTART_POLICY:-unless-stopped}`** sur `web`, `api` et `db`. La dev pose
  `no`.
- **`/admin` n'est plus routé.** La règle du routeur `api` garde `/api`, `/_allauth` et
  `/static` ; une requête publique sur `/admin/` tombe sur le SPA. Raison : la 2FA d'allauth ne
  protège pas le formulaire de connexion de l'admin Django, et c'est là que se créent les
  invitations.
- **`api` publié sur `127.0.0.1:${ADMIN_PORT}:8000`**, pour le tunnel SSH et rien d'autre.
  Jamais sans `127.0.0.1:`.
- **En-tête `X-Robots-Tag: ${ROBOTS_TAG}`** par un middleware `headers` appliqué aux deux
  routeurs. La dev pose `noindex`. La prod laisse la variable vide, et une valeur vide fait
  retirer l'en-tête par Traefik ; l'implémentation le vérifie par `curl` contre un Traefik
  réel, et si ce n'est pas le cas, se replie sur un middleware déclaré seulement quand la
  variable est posée (fichier Compose de surcharge pour la dev).
- **Rotation des journaux** : `logging` `json-file`, `max-size: 10m`, `max-file: 5` sur chaque
  service ; le pilote par défaut de Docker n'a aucune limite.

### 3.2 `.env.example`

Nouvelles variables, avec un commentaire qui donne la valeur prod et la valeur dev :
`COMPOSE_PROJECT_NAME` (`iba-prod` / `iba-dev`), `RESTART_POLICY` (`unless-stopped` / `no`),
`ADMIN_PORT` (`8201` / `8211`), `ROBOTS_TAG` (vide / `noindex`). `TRAEFIK_NETWORK` vaut
`traefik`.

`DJANGO_ALLOWED_HOSTS` devient `<domaine>,127.0.0.1,localhost` et
`DJANGO_CSRF_TRUSTED_ORIGINS` `https://<domaine>,http://localhost:<ADMIN_PORT>` : l'admin
par tunnel arrive avec `Host: localhost:8201` et `Origin: http://localhost:8201`. Les
cookies `Secure` restent : les navigateurs traitent `http://localhost` comme un contexte
sécurisé. Les cookies ne séparent pas les ports, donc une session admin sur la dev déconnecte
celle de la prod : gêne assumée, notée dans la documentation.

Les secrets sont générés sur le VPS, jamais copiés d'une instance à l'autre :
`secrets.token_urlsafe(50)` pour `DJANGO_SECRET_KEY`, `openssl rand -hex 32` pour
`POSTGRES_PASSWORD` (hexadécimal : sans danger dans `DATABASE_URL`). `DJANGO_DEBUG=0` sur les
deux instances : la dev est publique.

### 3.3 Aucun accès par défaut

Rien à coder, tout à préserver : l'application ne crée aucun utilisateur, l'inscription est
fermée (`is_open_for_signup`), `DJANGO_SECRET_KEY` absent refuse le démarrage. Le seul compte
est celui que `createsuperuser` crée en interactif, sur chaque instance, avec un mot de passe
choisi à ce moment.

## 4. Le script d'exploitation `deploy/iba`

Script bash, `set -euo pipefail`, lié en `/usr/local/bin/iba`, appelé `iba <prod|dev>
<commande>`. Il travaille dans `${IBA_HOME:-/srv/iba}/<instance>`, se relance sous le
propriétaire de ce dossier par `sudo -u` quand on l'appelle d'un autre compte, et refuse de
tourner si le `COMPOSE_PROJECT_NAME` du `.env` ne vaut pas `iba-<instance>`.

| Commande | Effet |
|---|---|
| `up` | `docker compose up -d --build`, puis `migrate` |
| `down` | `docker compose down` (volumes conservés) |
| `status` | `docker compose ps` et la révision git courante |
| `logs` | `docker compose logs -f --tail=200` |
| `migrate` | `docker compose run --rm api python manage.py migrate` |
| `deploy <ref>` | `git fetch --tags origin`, `git checkout --detach <ref>` (branche distante ou tag), en prod `backup` d'abord, puis construction, `up -d`, `migrate` |
| `backup` | `pg_dump` compressé dans `${IBA_HOME}/backups/<projet>-<horodatage>.sql.gz`, les 14 plus récents de ce projet gardés |
| `createsuperuser` | `createsuperuser` en interactif |
| `reset` | refusé si le projet ne finit pas par `-dev` ; demande de retaper le nom du projet ; `down -v`, `up -d --build`, `migrate`, `createsuperuser` |

Les migrations ne tournent jamais au démarrage des conteneurs (deux répliques les lanceraient
en concurrence, §3 de `deploiement-vps.md`) : elles passent toujours par ce script.

## 5. Démarrage au boot et sauvegardes

- **`deploy/systemd/iba-prod.service`** : `Type=oneshot`, `RemainAfterExit=yes`,
  `User=iba`, `WorkingDirectory=/srv/iba/prod`, `docker compose up -d` au démarrage,
  `docker compose stop` à l'arrêt, `After=`/`Requires=docker.service`. Avec
  `unless-stopped`, il garantit le redémarrage même après un `down` manuel. La dev n'a pas
  d'unité.
- **Sauvegarde nocturne** : une ligne de la crontab d'`iba`, `iba prod backup`, documentée,
  pas installée par un script. Elle ferme le point reporté « Aucune sauvegarde de
  PostgreSQL sur le VPS » pour la perte de données, pas pour la perte du VPS : la copie hors du
  serveur reste reportée.

## 6. L'infrastructure partagée, `/srv/infra`

Dépôt git **local** (`git init`, sans dépôt distant), propriété d'`infra`. Il porte des noms de
domaine, donc n'entre jamais dans ce dépôt ; ses fichiers sont préparés pendant
l'implémentation dans un dossier de travail, et la procédure les fait copier par
`sudo -u infra`.

- **`traefik/`** : `docker-compose.yml` repris de `deploy/traefik/`, sur la dernière version
  3.x constatée au moment de l'implémentation (ferme le point reporté sur `v3.3`) ; réseau
  `traefik` ; redirection HTTP vers HTTPS ; résolveur `letsencrypt` en défi HTTP ;
  `exposedbydefault=false` ; socket Docker en lecture seule ; **journaux d'accès JSON** sur
  la sortie standard, avec rotation ; **tableau de bord** activé et publié sur
  `127.0.0.1:8080` seulement ; `.env` (`ACME_EMAIL`) ; `restart: unless-stopped`.
- **`vitrine/`** : un conteneur `nginx:alpine` qui sert le dossier du site en lecture seule et
  reproduit la configuration Caddy actuelle : `/`, `/index.html`, `/img/*`, `/logo/*` servis,
  tout le reste en 404, compression gzip, et un routeur Traefik qui redirige le `www` vers le
  domaine nu en 301.
- **`systemd/`** : `infra-traefik.service` et `infra-vitrine.service`, `User=infra`, même
  modèle que `iba-prod.service`.
- **`README.md`** : ce qui vit là, qui en est propriétaire, comment une nouvelle application
  rejoint le réseau `traefik`.

Le contenu du site vitrine reste dans son dossier actuel, propriété de `seb`, qui l'édite :
`infra` décide comment il est servi, pas ce qu'il contient.

`deploy/traefik/` est **supprimé de ce dépôt** : l'arrivée du site vitrine est le deuxième
occupant qui déclenche le déménagement prévu.

## 7. La bascule depuis Caddy

Caddy sert aujourd'hui le site vitrine sur 80 et 443. Avant la bascule, la pile `vitrine` est
vérifiée à part, publiée sur un port `127.0.0.1` temporaire, contre la liste blanche : 200 sur
`/`, `/index.html`, une image ; 404 sur tout autre chemin. Puis, en quelques secondes de
coupure :

1. `sudo systemctl stop caddy`
2. démarrer `traefik` puis `vitrine` (par leurs unités systemd)
3. vérifier le site vitrine en HTTPS, certificat compris
4. `sudo systemctl disable caddy`

Retour arrière : arrêter les deux unités, `sudo systemctl start caddy`. Caddy n'est ni
désinstallé ni son Caddyfile modifié dans ce sous-projet.

## 8. Documentation

- `docs/deploiement-vps.md` réécrit dans l'ordre d'exécution : prérequis (DNS des deux
  domaines, utilisateurs `iba` et `infra`, clés de déploiement en lecture seule), infra et
  bascule, prod, dev, admin par tunnel (`ssh -L 8201:127.0.0.1:8201 …`), mises à jour et retour
  arrière (redéployer le tag précédent, restaurer une sauvegarde), l'agent local et ses deux
  origines dans `config.toml`.
- `CLAUDE.md` : section VPS (deux instances, Traefik dans `/srv/infra`, admin par tunnel,
  `deploy/iba`), ligne 32 du registre, mention de `deploy/traefik/` retirée.
- `docs/points-reportes.md` : retirer les points fermés (Traefik dans le dépôt, `v3.3`,
  sauvegarde PostgreSQL), ajouter ceux que ce sous-projet laisse (copie hors VPS, sessions
  admin prod/dev qui s'écrasent, `seb` dans le groupe `docker`).
- `docs/specs/2026-09-03-architecture-design.md` §12 : sous-projet 3 mis en ligne.

## 9. Tests

- **`apps/api/tests/test_deployment_config.py`** (pytest, dans `pnpm test:api`), étendu :
  chaque nom de routeur, service et middleware Traefik contient `${COMPOSE_PROJECT_NAME}` ;
  aucune règle de routeur ne mentionne `/admin` ; tout port publié commence par
  `127.0.0.1:` ; chaque service a `restart: ${RESTART_POLICY…}` et une rotation de journaux ;
  `.env.example` n'a que des emplacements pour les domaines et autorise `localhost` et
  `127.0.0.1`.
- **Un test pytest de `deploy/iba`**, sur un faux `docker` et un faux `git` placés en tête du
  `PATH` qui journalisent leurs appels, sans `sudo` (le propriétaire du dossier de test est
  l'utilisateur courant) : `reset` en prod échoue sans aucun appel à `docker` ; `reset` en dev
  sans le bon nom retapé échoue sans `down -v` ; `deploy` en prod appelle `pg_dump` avant
  `migrate` ; un `.env` dont le projet ne correspond pas à l'instance est refusé ; `backup`
  ne garde que les 14 plus récents.
- **Vérifications réelles sur le VPS**, consignées dans le plan : `docker compose config` avec
  un `.env` prod et un `.env` dev donne des noms Traefik disjoints ; `bash -n` et
  `shellcheck` (s'il est installé) sur `deploy/iba` ; la pile `vitrine` contre sa liste
  blanche avant bascule (§7) ; après bascule, les critères du §1, un par un.

`pnpm check` ne lance aucun test Python : il reste tel quel.
