# ib-tws-agent

Agent local d'IB Options Analyzer 2 : lit TWS sur la machine de l'utilisateur, ne stocke rien,
ne répond qu'aux origines de son `config.toml`. Spec : `docs/specs/2026-09-06-agent-local-design.md`.

## Utilisateur

La page Aide du site donne les commandes exactes. En résumé :

    uv tool install <origine>/agent/<roue>
    ib-tws-agent init --origin <origine>
    ib-tws-agent

Réglages TWS : Enable ActiveX and Socket Clients, un port par compte, `127.0.0.1` dans Trusted
IPs, Read-Only API acceptée. Le port se renseigne ensuite dans Sources de données.

## Développeur

    pnpm test:agent                       # pytest sur un FakeIB, jamais un vrai TWS
    uv run --project apps/tws-agent ib-tws-agent init --origin http://localhost:5173
    uv run --project apps/tws-agent ib-tws-agent
    pnpm build:agent                      # roue + index.json dans apps/web/public/agent/

Deux endpoints : `GET /health` (gratuit) et `GET /snapshot?port=<port TWS>` (une connexion
TWS en `clientId 0`, refermée aussitôt). Données brutes, noms `ib_async` ; toute conversion
vit dans `packages/ib-parsers/src/agent.ts`.

La connexion est en `readonly=True` et `ReadOnlyIB` n'envoie pas `reqAutoOpenOrders` : sans
cela, `ib_async` demande à chaque connexion les ordres ouverts et terminés, que TWS refuse en
mode *Read-Only API* (erreur 321, signalée dans TWS à chaque synchro).

## Validation contre un vrai TWS

Impossible depuis la machine de développement. Sur une machine où TWS tourne avec l'API
activée :

    curl -i http://127.0.0.1:8100/health
    curl -i -H "Origin: <l'origine de votre config.toml>" "http://127.0.0.1:8100/snapshot?port=7502"
    curl -i -H "Origin: https://autre-site" http://127.0.0.1:8100/health    # sans Allow-Origin

`/snapshot` refuse toute requête dont l'`Origin` est absente ou non admise (403
`{"code": "origin-refused"}`), avant même de contacter TWS : contrairement à `/health`, il
peut ouvrir une connexion, et une page qui n'envoie aucune origine (un `<img>`, ou une page
même-origine par piratage DNS) ne doit jamais pouvoir la déclencher.

Puis dans l'application : port renseigné, badge « En direct », et le lendemain la ligne du
jour remplacée par sa jumelle Flex après la synchro du matin.
