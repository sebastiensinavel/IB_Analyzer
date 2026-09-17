# Déploiement sur le VPS

Aucun nom de domaine n'apparaît dans ce dépôt : `<domaine>` est à remplacer par le vôtre,
dans le `.env` du VPS uniquement. Le sous-domaine porte des **tirets**, jamais
d'underscore : un underscore n'est pas valide dans un nom d'hôte et Let's Encrypt
refuserait d'émettre le certificat.

## 0. Prérequis

- Un enregistrement DNS `A` (et `AAAA` s'il y a une IPv6) pour `<domaine>` pointant sur
  le VPS.
- ufw : `deny incoming`, ports 80, 443 et 2002 ouverts.
- Docker et Docker Compose installés.
- Le dépôt cloné sur le VPS, à jour :

      git clone <url-du-dépôt> ib-analyzer2
      cd ib-analyzer2

  Les commandes qui suivent partent de la racine du dépôt ainsi clonée.

## 1. Traefik, une seule fois pour tout le VPS

    cd deploy/traefik
    cp .env.example .env        # ACME_EMAIL, TRAEFIK_NETWORK
    docker compose up -d
    docker network ls | grep "$(grep '^TRAEFIK_NETWORK=' .env | cut -d= -f2)"

**Vérifier le certificat avant d'aller plus loin** : le premier `docker compose up` de
l'application doit trouver un Traefik capable d'émettre, sinon on débogue deux choses à la
fois.

## 2. La pile de l'application

    cd ../..                    # retour à la racine du dépôt
    cp .env.example .env        # tout renseigner, TRAEFIK_NETWORK inclus
    docker compose build
    docker compose up -d

`DJANGO_ALLOWED_HOSTS` doit garder le `,127.0.0.1` du modèle en plus du domaine : la sonde
de santé du service `api` appelle `http://127.0.0.1:8000/api/health` depuis l'intérieur du
conteneur. Sans lui, Django répond 400 et le conteneur reste `unhealthy` indéfiniment.

## 3. Migrer, une commande explicite

Les migrations **ne tournent pas au démarrage du conteneur** : deux répliques les
lanceraient en concurrence.

    docker compose run --rm api python manage.py migrate

Cette commande crée aussi la table du cache utilisée par le throttling du proxy Flex
(`core/migrations/0003_cache_table.py`) : une table `django_cache` après coup est normale,
pas un signe d'erreur.

## 4. Le super-utilisateur

    docker compose run --rm api python manage.py createsuperuser

## 5. La première invitation

Ouvrir `https://<domaine>/admin/`, se connecter, créer une `Invitation` avec l'email de
l'invité. La fiche affiche le lien : le transmettre soi-même. **Aucun email n'est envoyé.**

## 6. Vérifier

    docker compose ps                     # api : `healthy`, jamais `unhealthy`
    curl -I https://<domaine>/            # 200, certificat valide
    curl -s https://<domaine>/api/health  # {"status":"ok"}

Puis, dans un navigateur : ouvrir le lien d'invitation, choisir un mot de passe, se
retrouver connecté.

## Mettre à jour

    git pull
    docker compose build
    docker compose up -d
    docker compose run --rm api python manage.py migrate
