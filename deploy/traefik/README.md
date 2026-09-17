# Traefik — infrastructure du VPS

**Ceci n'appartient pas à l'application.** C'est le reverse proxy unique de tout le VPS :
une seule instance, un réseau Docker externe partagé, une pile Compose par application
derrière lui.

Il vit dans ce dépôt parce que IB Analyzer est la première application déployée sur ce
VPS. **Il déménagera dans son propre dépôt à l'arrivée de la deuxième.**

## Démarrage

    cp .env.example .env      # renseigner ACME_EMAIL et TRAEFIK_NETWORK
    docker compose up -d

`TRAEFIK_NETWORK` est le nom du réseau que les applications déclarent en `external`.
Le relever ici est la source de vérité : ne jamais le deviner ailleurs.

## Ce qui est délibéré

- Tableau de bord désactivé : rien à exposer, rien à protéger.
- `exposedbydefault=false` : un conteneur n'est routé que s'il porte `traefik.enable=true`.
- Redirection systématique de `web` vers `websecure`.
- ufw laisse entrer 80, 443 et 2002 (SSH) seulement.
