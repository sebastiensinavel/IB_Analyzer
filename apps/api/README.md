# apps/api

Serveur Django du sous-projet 3. Deux apps : `core` (socle réutilisable) et `ib`
(proxy Flex, spécifique IB). **Le serveur ne stocke aucune donnée de portefeuille**
— voir `docs/specs/2026-09-04-serveur-django-design.md`.

## Versions retenues

| Quoi | Version | Pourquoi |
|---|---|---|
| Django | 5.2 (LTS, patch 5.2.17 au constat) | LTS la plus récente (`4.2`, `5.2` sont les LTS ; `6.0`/`6.1` existent déjà mais ne sont pas LTS) |
| Python | 3.14 | Django 5.2 supporte jusqu'à 3.14 (classifiers PyPI), aligné sur le standard du dépôt (`uv, Python 3.14`) — pas besoin d'épingler `apps/api/.python-version` |

## Commandes

    docker compose -f docker-compose.dev.yml up -d db
    pnpm dev:api         # base créée si besoin, migrate, collectstatic, runserver sur le port du checkout
    pnpm test:api        # depuis la racine, aucune variable à poser

`pnpm dev:api` (`tools/dev-env/api.mjs`) est l'équivalent de la séquence manuelle :

    export DJANGO_SECRET_KEY=dev-local-not-for-production
    uv run --project apps/api python apps/api/manage.py migrate
    uv run --project apps/api python apps/api/manage.py collectstatic --noinput
    uv run --project apps/api python apps/api/manage.py runserver 127.0.0.1:8000

Le `collectstatic` n'est pas facultatif hors `DJANGO_DEBUG=1` : le stockage à manifeste de
WhiteNoise refuse tout fichier statique qu'il n'a pas collecté, et l'admin Django répond 500
(« Missing staticfiles manifest entry »). Il écrit dans `apps/api/staticfiles/`, ignoré par git.

à ceci près qu'il applique la règle **un port et une base par checkout** de
`tools/dev-env/ports.mjs` : à la racine du dépôt, `:8000` et `ib_analyzer` ; dans un
worktree `.claude/worktrees/<nom>`, `8000+N` où N est son numéro de worktree (8001 pour le
premier, voir `ports.mjs`) et la base
`ib_analyzer_<nom>` sur la même instance PostgreSQL, créée au premier lancement. Le proxy
Vite du même checkout vise ce port, et `pnpm test:api` passe par la même dérivation
(`DATABASE_URL`), donc sa base de test `--reuse-db` est `test_ib_analyzer_<nom>` : deux
checkouts avec des migrations différentes ne partagent jamais une base. `DATABASE_URL`
et `API_PORT` posés dans l'environnement priment.

`config/settings.py` refuse de démarrer hors `DJANGO_DEBUG=1` sur la clé de développement
committée : une variable oubliée dans le `.env` du VPS ferait tourner la production sur une
clé publiquement connue, donc des cookies de session et des jetons CSRF forgeables. En
local on tourne comme la production (`DJANGO_DEBUG` à 0, cookies `Secure` — que le
navigateur accepte sur `127.0.0.1` même en clair), d'où l'`export` ci-dessus. La suite
pytest n'en a pas besoin : `pytest.ini` pointe sur `config/test_settings.py`, qui pose sa
propre clé avant de réimporter les vrais réglages tels quels.

## `openapi.json`

`apps/api/openapi.json` est committé : c'est la moitié serveur de la garantie de types qui
se complète côté navigateur au sous-projet 3 (tâche 11). Sa fraîcheur est vérifiée par
`apps/api/tests/test_openapi_freshness.py`, jamais par `pnpm check` qui ne lance aucun
Python.

`ninja` (le paquet `django-ninja`) est dans `INSTALLED_APPS` uniquement pour que Django
découvre sa commande `export_openapi_schema` : il n'a ni modèle ni URL propre. Pour
régénérer le fichier après un changement de schéma :

    uv run --project apps/api python apps/api/manage.py export_openapi_schema \
      --api config.api.api --output apps/api/openapi.json --sorted --indent 2

Le test de fraîcheur recompare des dictionnaires Python obtenus après un aller-retour JSON
(`json.loads(json.dumps(..., sort_keys=True))` des deux côtés) : l'ordre des clés et
l'indentation du fichier committé n'ont donc aucune incidence sur le résultat du test.
`--sorted --indent 2` n'est là que pour un fichier committé lisible et à diff stable — pas
une exigence du test.

## `allauth` headless et OpenAPI (constat, tâche 12)

`django-allauth` embarque bien un schéma OpenAPI pour son mode headless
(`allauth/headless/spec/doc/openapi.yaml`, servi par `allauth.headless.spec.views` sur
`openapi.yaml` / `openapi.json` / `openapi.html`), mais deux raisons l'écartent comme second
schéma `openapi-typescript` pour `apps/web` :

1. Il n'est exposé que si `settings.HEADLESS["SERVE_SPECIFICATION"]` vaut `True` — la valeur
   par défaut du paquet est `False`, et `config/settings.py` ne la surcharge pas ici : le
   schéma n'est donc pas servi par le serveur tel qu'il tourne dans ce projet.
2. Même activé, ses chemins sont templatés `/_allauth/{client}/v1/...` avec `{client}` en
   paramètre de route commun aux clients `browser` et `app` — il ne décrit pas le client
   `browser` isolément, contrairement à ce qu'`apps/web/src/api/allauth.ts` consomme.

`apps/web/src/api/allauth.ts` est donc écrit à la main (spec §6, tâche 12), sur les chemins
relevés dans `apps/api/tests/test_allauth_wiring.py`. Pas besoin de réexaminer cette question
au sous-projet 6 : elle est tranchée par le code du paquet installé, pas par une option qu'on
aurait pu activer ici.
