# Déploiement sur le VPS

Aucun nom de domaine n'apparaît dans ce dépôt : `<domaine-prod>`, `<domaine-dev>`, `<vitrine>`
et `<vps>` sont à remplacer par les vôtres, dans les `.env` du VPS et dans `/srv/infra`
uniquement. Un sous-domaine porte des **tirets**, jamais d'underscore : un underscore n'est pas
valide dans un nom d'hôte et Let's Encrypt refuserait d'émettre le certificat.

Conception : `docs/specs/2026-09-25-publication-prod-dev-design.md`.

## 0. Vue d'ensemble

```
Internet :80 / :443
   │
Traefik (/srv/infra/traefik, utilisateur infra)
   │   réseau Docker partagé « traefik »
   ├── <vitrine>, www → <vitrine>  (/srv/infra/vitrine : nginx, dossier du site en lecture seule)
   ├── <domaine-prod>              (/srv/iba/prod, projet Compose iba-prod)
   └── <domaine-dev>               (/srv/iba/dev,  projet Compose iba-dev, X-Robots-Tag noindex)

127.0.0.1 seulement, par tunnel SSH :
   8201 → admin de la prod · 8211 → admin de la dev · 8080 → tableau de bord Traefik
```

- **`iba`** possède `/srv/iba` : les deux clones, leurs `.env`, les sauvegardes.
- **`infra`** possède `/srv/infra` : Traefik et le site vitrine, dans un dépôt git local, hors
  de ce dépôt parce qu'ils portent des noms de domaine.
- Tous deux sont dans le groupe `docker`, sans `sudo`. **Le groupe `docker` vaut root** : la
  séparation est organisationnelle, pas une frontière de sécurité.
- Prod et dev ne partagent que le réseau `traefik`. Volumes, base, secret Django, `.env` : tout
  est propre à chaque instance. Côté navigateur, les deux domaines sont deux origines, donc
  deux bases IndexedDB.

## 1. Prérequis

- DNS : un enregistrement `A` (et `AAAA` s'il y a une IPv6) vers le VPS pour `<domaine-prod>`
  et `<domaine-dev>`.

      dig +short <domaine-prod>
      dig +short <domaine-dev>

- ufw : `deny incoming`, ports 80, 443 et 2002 ouverts. Docker démarré au boot :

      sudo systemctl enable docker

- Les deux utilisateurs :

      sudo useradd --system --create-home --home-dir /srv/iba --shell /bin/bash iba
      sudo useradd --system --create-home --home-dir /srv/infra --shell /bin/bash infra
      sudo usermod -aG docker iba
      sudo usermod -aG docker infra
      sudo chmod 750 /srv/iba /srv/infra

- Les clones, sous `iba`, chacun avec sa **clé de déploiement GitHub en lecture seule** :

      sudo -iu iba
      ssh-keygen -t ed25519 -f ~/.ssh/iba-prod -N ""
      ssh-keygen -t ed25519 -f ~/.ssh/iba-dev -N ""
      # ~/.ssh/config : un alias d'hôte par clé
      #   Host github-iba-prod
      #     HostName github.com
      #     IdentityFile ~/.ssh/iba-prod
      #   Host github-iba-dev  (idem avec iba-dev)
      git clone git@github-iba-prod:<compte>/<dépôt>.git prod
      git clone git@github-iba-dev:<compte>/<dépôt>.git dev

## 2. L'infrastructure

Les fichiers ont été préparés dans `~seb/infra-staging` (sous-projet 32, tâche 3) : Traefik,
le site vitrine, leurs unités systemd.

    sudo cp -r ~seb/infra-staging/. /srv/infra/
    sudo chown -R infra:infra /srv/infra
    sudo -iu infra
    cd /srv/infra
    git init && git add -A && git commit -m "Infrastructure du VPS"   # .env est ignoré
    cp traefik/.env.example traefik/.env && chmod 600 traefik/.env      # ACME_EMAIL
    cat vitrine/.env                                                    # VITRINE_HOST, VITRINE_ROOT
    exit

    sudo cp /srv/infra/systemd/*.service /etc/systemd/system/
    sudo systemctl daemon-reload

`vitrine/.env` a été écrit à la préparation, depuis `/etc/caddy/Caddyfile`. Traefik est
épinglé sur une version précise (`traefik/docker-compose.yml`), jamais `v3` ni `latest`.

## 3. La bascule depuis Caddy

Caddy sert le site vitrine sur 80 et 443 : Traefik ne peut démarrer qu'une fois Caddy arrêté.

**Avant**, vérifier le site vitrine à part, sur un port temporaire, contre sa liste blanche :

    sudo -iu infra
    cd /srv/infra/vitrine
    docker compose -p vitrine-test -f docker-compose.yml -f docker-compose.test.yml up -d
    for p in / /index.html /logo/logo.svg /img/ /.git/HEAD /nope; do
      printf '%-16s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090$p)"
    done     # 200 200 200 404 404 404
    docker compose -p vitrine-test -f docker-compose.yml -f docker-compose.test.yml down
    exit

**La bascule**, quelques secondes de coupure :

    sudo systemctl stop caddy
    sudo systemctl enable --now infra-traefik infra-vitrine
    curl -sI https://<vitrine>/ | head -1                      # 200, certificat valide
    curl -sI https://www.<vitrine>/ | grep -iE '^HTTP|location' # 301 vers https://<vitrine>/
    curl -s -o /dev/null -w '%{http_code}\n' https://<vitrine>/.git/HEAD   # 404
    sudo systemctl disable caddy

Le premier certificat peut prendre quelques secondes : `docker logs traefik-traefik-1` sous
`infra` montre l'échange avec Let's Encrypt.

**Retour arrière** :

    sudo systemctl stop infra-vitrine infra-traefik
    sudo systemctl start caddy

Caddy n'est ni désinstallé ni son Caddyfile modifié.

## 4. La prod

    sudo -iu iba
    cd /srv/iba/prod
    cp .env.example .env && chmod 600 .env
    python3 -c 'import secrets; print(secrets.token_urlsafe(50))'   # DJANGO_SECRET_KEY
    openssl rand -hex 32                                           # POSTGRES_PASSWORD
    exit

Remplir `.env` avec les valeurs de la prod :

| Variable | prod | dev |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `iba-prod` | `iba-dev` |
| `RESTART_POLICY` | `unless-stopped` | `no` |
| `ADMIN_PORT` | `8201` | `8211` |
| `ROBOTS_TAG` | *(vide)* | `noindex` |
| `PUBLIC_HOST` | `<domaine-prod>` | `<domaine-dev>` |
| `PUBLIC_BASE_URL` | `https://<domaine-prod>` | `https://<domaine-dev>` |
| `DJANGO_ALLOWED_HOSTS` | `<domaine-prod>,127.0.0.1,localhost` | `<domaine-dev>,127.0.0.1,localhost` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://<domaine-prod>,http://localhost:8201` | `https://<domaine-dev>,http://localhost:8211` |
| `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD` | générés | **générés à nouveau** |
| `DJANGO_DEBUG` | `0` | `0` : la dev est publique |

`DJANGO_ALLOWED_HOSTS` garde `127.0.0.1` : la sonde de santé du service `api` appelle
`http://127.0.0.1:8000/api/health` depuis l'intérieur du conteneur. Sans lui, Django répond 400
et le conteneur reste `unhealthy` indéfiniment. `localhost` et l'origine
`http://localhost:<ADMIN_PORT>` servent l'admin par tunnel (§6).

Installer la commande `iba`, démarrer, créer l'administrateur :

    sudo ln -s /srv/iba/prod/deploy/iba /usr/local/bin/iba
    iba prod up                  # construit, démarre, migre
    iba prod createsuperuser     # votre email, un mot de passe long et unique

`iba` se relance de lui-même sous `iba` (par `sudo -u`) quand on l'appelle depuis un autre
compte. Les migrations **ne tournent jamais au démarrage d'un conteneur** — deux répliques les
lanceraient en concurrence — : elles passent toujours par `iba … migrate`, `up` ou `deploy`.
La première migration crée aussi la table du cache du throttling du proxy Flex
(`core/migrations/0003_cache_table.py`) : une table `django_cache` est normale.

Aucun accès par défaut : l'application ne crée aucun utilisateur, l'inscription est fermée
(invitation seulement), et un `DJANGO_SECRET_KEY` absent fait refuser le démarrage.

Démarrage au boot et sauvegarde nocturne :

    sudo cp /srv/iba/prod/deploy/systemd/iba-prod.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable iba-prod
    sudo crontab -u iba -e
    # 30 3 * * * /usr/local/bin/iba prod backup >/dev/null

Les sauvegardes (`pg_dump` compressé) vont dans `/srv/iba/backups`, 14 gardées par instance.
Elles restent sur le VPS : elles ne protègent pas de sa perte.

## 5. La dev

Même `.env` que la prod avec les valeurs de la colonne dev, et **de nouveaux secrets** :

    sudo -iu iba
    cd /srv/iba/dev && cp .env.example .env && chmod 600 .env   # remplir, colonne dev
    exit
    iba dev up
    iba dev createsuperuser

Au quotidien :

    iba dev deploy <branche>     # montrer une branche (ou un tag) : fetch, build, up, migrate
    iba dev down                 # arrêter ; les données restent
    iba dev up                   # redémarrer
    iba dev status               # conteneurs et révision déployée
    iba dev logs
    iba dev reset                # tout effacer : retaper « iba-dev » pour confirmer

`reset` vide la base de la dev (`down -v`), la reconstruit, migre et redemande un
administrateur. Il n'efface pas les données des testeurs : elles vivent dans leur navigateur,
dans l'IndexedDB de `<domaine-dev>` ; ils les suppriment depuis Paramètres. `iba prod reset`
est refusé.

La dev a `restart: no` et aucune unité systemd : après un redémarrage du VPS, elle reste
arrêtée jusqu'au prochain `iba dev up`.

## 6. L'admin par tunnel SSH

`/admin` n'est pas routé par Traefik — la 2FA ne protège pas le formulaire de connexion de
l'admin Django — : depuis internet, `/admin/` sert l'application. Depuis votre machine :

    ssh -p 2002 -L 8201:127.0.0.1:8201 -L 8211:127.0.0.1:8211 -L 8080:127.0.0.1:8080 <vps>

puis `http://localhost:8201/admin/` (prod), `http://localhost:8211/admin/` (dev),
`http://localhost:8080/` (tableau de bord Traefik, en lecture seule).

Les cookies ne séparent pas les ports : se connecter à l'admin de la dev déconnecte celui de
la prod, et inversement.

**Inviter quelqu'un** : dans l'admin, créer une `Invitation` avec son email. La fiche affiche
le lien : le transmettre soi-même. **Aucun email n'est envoyé.**

## 7. Livrer

    # sur le poste de développement, une fois la branche validée sur la dev
    git switch main && git merge <branche> && git push
    git tag vAAAA.MM.JJ && git push --tags

    # sur le VPS
    iba prod deploy vAAAA.MM.JJ

`deploy` en prod n'accepte qu'un tag. Il sauvegarde la base d'abord et s'arrête si la
sauvegarde échoue, puis extrait le tag, reconstruit, redémarre et migre.

**Retour arrière** : `iba prod deploy <tag précédent>`. Si une migration a changé le schéma,
restaurer aussi la sauvegarde prise juste avant :

    sudo -iu iba
    cd /srv/iba/prod
    docker compose stop api
    docker compose exec -T db psql -U ib -d postgres -c 'DROP DATABASE ib_analyzer' -c 'CREATE DATABASE ib_analyzer OWNER ib'
    gunzip -c /srv/iba/backups/iba-prod-<horodatage>.sql.gz | docker compose exec -T db psql -U ib ib_analyzer
    docker compose start api

## 8. L'agent local

`ib-tws-agent init --origin https://<domaine-prod>` n'écrit qu'une origine. Pour utiliser les
deux sites, ajouter la dev à la main dans `config.toml` (sous
`platformdirs.user_config_dir("ib-tws-agent")`), puis relancer l'agent :

    origins = ["https://<domaine-prod>", "https://<domaine-dev>"]

Un testeur externe n'a besoin que de l'origine de la dev.

## 9. Vérifier

    curl -sI https://<domaine-prod>/ | head -1                  # 200, certificat valide
    curl -s https://<domaine-prod>/api/health                   # {"status":"ok"}
    curl -sI https://<domaine-prod>/ | grep -i x-robots-tag     # rien
    curl -s https://<domaine-prod>/admin/ | grep -c '<div id="root"'   # 1 : le SPA, pas l'admin
    curl -sI https://<domaine-dev>/ | grep -i x-robots-tag      # X-Robots-Tag: noindex
    iba prod status                                             # api : healthy
    iba prod backup                                             # un fichier dans /srv/iba/backups

Puis `sudo reboot` : le site vitrine et la prod répondent, `iba dev status` montre la dev
arrêtée. Enfin, dans un navigateur : ouvrir un lien d'invitation, choisir un mot de passe, se
retrouver connecté.
