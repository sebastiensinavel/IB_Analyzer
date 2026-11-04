# Déploiement sur le VPS

Aucun nom de domaine n'apparaît dans ce dépôt : `<domaine-prod>`, `<domaine-dev>` et `<vps>`
sont à remplacer par les vôtres, dans les `.env` du VPS uniquement. Un sous-domaine porte des **tirets**, jamais d'underscore : un underscore n'est pas
valide dans un nom d'hôte et Let's Encrypt refuserait d'émettre le certificat.

Conception : `docs/specs/2026-09-25-publication-prod-dev-design.md`.

## 0. Vue d'ensemble

```
Internet :80 / :443
   │
Traefik partagé du VPS (/srv/infra, hors de ce dépôt)
   │   réseau Docker partagé « traefik »
   ├── <domaine-prod>   (/srv/iba/prod, projet Compose iba-prod)
   ├── <domaine-dev>    (/srv/iba/dev,  projet Compose iba-dev, X-Robots-Tag noindex)
   └── … les autres occupants du VPS, qui ne concernent pas ce dépôt

127.0.0.1 seulement, par tunnel SSH :
   8201 → admin de la prod · 8211 → admin de la dev
```

- **`iba`** possède `/srv/iba` : les deux clones, leurs `.env`, les sauvegardes. Il est dans le
  groupe `docker`, sans `sudo`. **Le groupe `docker` vaut root** : la séparation d'avec les
  autres utilisateurs du VPS est organisationnelle, pas une frontière de sécurité.
- **Le Traefik est un prérequis, pas une partie de ce dépôt.** Il est installé et exploité par
  le dépôt d'infrastructure privé du VPS (`~seb/IA/Infrastructure`, déployé dans `/srv/infra`).
  IB Analyzer n'en attend que le contrat : réseau Docker externe `traefik`, entrypoint
  `websecure` (80 redirigé vers 443), certresolver `letsencrypt`, et des noms de routeurs
  uniques sur tout le VPS.
- Prod et dev ne partagent que le réseau `traefik`. Volumes, base, secret Django, `.env` : tout
  est propre à chaque instance. Côté navigateur, les deux domaines sont deux origines, donc
  deux bases IndexedDB.

## 1. Prérequis

- DNS : un enregistrement `A` (et `AAAA` s'il y a une IPv6) vers le VPS pour `<domaine-prod>`
  et `<domaine-dev>`.

      dig +short <domaine-prod>
      dig +short <domaine-dev>

- Le Traefik du VPS démarré (`docker network inspect traefik` répond), ufw ouvert sur 80 et 443.

- L'utilisateur `iba` :

      sudo useradd --system --create-home --home-dir /srv/iba --shell /bin/bash iba
      sudo usermod -aG docker iba
      sudo chmod 750 /srv/iba

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

## 2. La prod

    sudo -iu iba
    cd /srv/iba/prod
    cp .env.example .env && chmod 600 .env
    python3 -c 'import secrets; print(secrets.token_urlsafe(50))'   # DJANGO_SECRET_KEY
    openssl rand -hex 32                                           # POSTGRES_PASSWORD
    exit

Remplir `.env` avec les valeurs de la prod :

| Variable | prod | dev |
|---|---|---|
| `IBA_INSTANCE` | `prod` | `dev` |
| `RESTART_POLICY` | `unless-stopped` | `no` |
| `ADMIN_PORT` | `8201` | `8211` |
| `ROBOTS_TAG` | *(vide)* | `noindex` |
| `PUBLIC_HOST` | `<domaine-prod>` | `<domaine-dev>` |
| `PUBLIC_BASE_URL` | `https://<domaine-prod>` | `https://<domaine-dev>` |
| `DJANGO_ALLOWED_HOSTS` | `<domaine-prod>,127.0.0.1,localhost` | `<domaine-dev>,127.0.0.1,localhost` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://<domaine-prod>,http://localhost:8201` | `https://<domaine-dev>,http://localhost:8211` |
| `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD` | générés | **générés à nouveau** |
| `DJANGO_DEBUG` | `0` | `0` : la dev est publique |

La pile s'appelle `iba-<IBA_INSTANCE>` (`name:` de `docker-compose.yml`). **Ne jamais poser
`COMPOSE_PROJECT_NAME`** : il écraserait ce nom, et `iba` refuse un `.env` qui le contient.

`DJANGO_ALLOWED_HOSTS` garde `127.0.0.1` : la sonde de santé du service `api` appelle
`http://127.0.0.1:8000/api/health` depuis l'intérieur du conteneur. Sans lui, Django répond 400
et le conteneur reste `unhealthy` indéfiniment. `localhost` et l'origine
`http://localhost:<ADMIN_PORT>` servent l'admin par tunnel (§4).

Installer la commande `iba`, démarrer, créer l'administrateur :

    sudo install -m 755 /srv/iba/prod/deploy/iba-launcher /usr/local/bin/iba
    iba prod up                  # construit, démarre, migre
    iba prod createsuperuser     # votre email, un mot de passe long et unique

`/srv/iba` est en 750 : un autre compte ne peut pas lire le script du clone. Le lanceur
installé en `/usr/local/bin/iba` passe donc la main à `iba` (`sudo -u iba`) et exécute
`/srv/iba/prod/deploy/iba` ; il ne change jamais, le script suit les déploiements de la prod. Les migrations **ne tournent jamais au démarrage d'un conteneur** — deux répliques les
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

## 3. La dev

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

## 4. L'admin par tunnel SSH

`/admin` n'est pas routé par Traefik — la 2FA ne protège pas le formulaire de connexion de
l'admin Django — : depuis internet, `/admin/` sert l'application. Depuis votre machine :

    ssh -p 2002 -L 8201:127.0.0.1:8201 -L 8211:127.0.0.1:8211 <vps>

puis `http://localhost:8201/admin/` (prod) et `http://localhost:8211/admin/` (dev).

Les cookies ne séparent pas les ports : se connecter à l'admin de la dev déconnecte celui de
la prod, et inversement.

**Inviter quelqu'un** : dans l'admin, créer une `Invitation` avec son email. La fiche affiche
le lien : le transmettre soi-même. **Aucun email n'est envoyé.**

## 5. Livrer

    # sur le poste de développement, une fois la branche validée sur la dev
    git switch main && git merge <branche> && git push
    git tag vAAAA.MM.JJ && git push --tags

    # sur le VPS
    iba prod deploy vAAAA.MM.JJ

`deploy` en prod n'accepte qu'un tag. Il sauvegarde la base d'abord et s'arrête si la
sauvegarde échoue, puis extrait le tag, reconstruit, redémarre et migre.

**Retour arrière** : `iba prod deploy <tag précédent>`. Si la livraison fautive a migré le
schéma, il faut aussi restaurer la base. **La bonne sauvegarde est celle que la livraison
fautive a prise avant de migrer** — son chemin s'affiche au début de `iba prod deploy`, et son
horodatage précède la livraison. Le `deploy` du retour arrière en prend une autre, du schéma
déjà migré : ce n'est pas celle-là.

    iba prod deploy <tag précédent>
    sudo -iu iba
    cd /srv/iba/prod
    ls -1 /srv/iba/backups/iba-prod-*.sql.gz          # repérer celle d'avant la livraison fautive
    docker compose stop api
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -U ib -d postgres \
      -c 'DROP DATABASE ib_analyzer' -c 'CREATE DATABASE ib_analyzer OWNER ib'
    gunzip -c /srv/iba/backups/iba-prod-<horodatage>.sql.gz \
      | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U ib ib_analyzer
    docker compose start api

`ON_ERROR_STOP` arrête la restauration à la première erreur au lieu de laisser une base à
moitié chargée.

## 6. L'agent local

Pour utiliser les deux sites, ajouter les deux origines, puis relancer l'agent :

    ib-tws-agent origin add https://<domaine-prod>
    ib-tws-agent origin add https://<domaine-dev>
    ib-tws-agent origin list                        # vérifier
    ib-tws-agent origin remove https://<domaine-dev>   # pour n'en garder qu'une

Un testeur externe n'a besoin que de l'origine de la dev.

## 7. Vérifier

    curl -sI https://<domaine-prod>/ | head -1                  # 200, certificat valide
    curl -s https://<domaine-prod>/api/health                   # {"status":"ok"}
    curl -sI https://<domaine-prod>/ | grep -i x-robots-tag     # rien
    curl -s https://<domaine-prod>/admin/ | grep -c '<div id="root"'   # 1 : le SPA, pas l'admin
    curl -sI https://<domaine-dev>/ | grep -i x-robots-tag      # X-Robots-Tag: noindex
    iba prod status                                             # api : healthy
    iba prod backup                                             # un fichier dans /srv/iba/backups

Puis `sudo reboot` : la prod répond, `iba dev status` montre la dev
arrêtée. Enfin, dans un navigateur : ouvrir un lien d'invitation, choisir un mot de passe, se
retrouver connecté.

## 8. Service Worker

Une maintenance n'empêche pas les navigateurs déjà venus d'ouvrir l'application : le Service
Worker leur sert l'enveloppe depuis son cache, et leurs données sont dans IndexedDB. Seules la
synchro Flex relayée par le serveur et la sauvegarde attendent son retour.

Une version cassée se corrige en déployant un correctif : `sw.js` est servi en `no-cache`, donc
chaque navigateur relit le fichier à sa visite. Avec `registerType: "prompt"` le nouveau worker
attend le clic du bandeau, mais **un rechargement (F5) l'applique d'office** : un script inline
d'`index.html`, hors du bundle, tourne même quand l'application plante au chargement de ses
modules ou au premier rendu et ne monte pas le bandeau. Un correctif publié, puis un F5, suffit
donc. Une simple navigation (nouvel onglet, application installée rouverte) ne l'applique pas.
Dernier recours, si c'est `sw.js` lui-même qui est cassé : publier une version avec
`selfDestroying: true` dans `apps/web/pwa.config.ts` (le Service Worker disparaît à la visite
suivante).
