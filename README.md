# IB Options Analyzer 2

Analyse de portefeuilles Interactive Brokers (actions + options) dans le navigateur.
Le serveur ne stocke aucune donnée de portefeuille. Architecture : `docs/specs/2026-09-03-architecture-design.md`.

## Démarrer

```bash
corepack enable --install-directory ~/.local/bin   # une fois, donne pnpm sans sudo
pnpm install
pnpm dev            # http://127.0.0.1:5173, application seule, sans serveur
pnpm check          # lint, typecheck, tests de tout l'espace de travail (jamais de Python)
```

Sans rien d'autre, l'application fonctionne déjà aux paliers 1 et 2 (Flex et relevés HTML,
sans compte). Le serveur n'est nécessaire que pour se connecter et déclencher le proxy Flex :

```bash
docker compose -f docker-compose.dev.yml up -d db        # PostgreSQL de développement
uv run --project apps/api python apps/api/manage.py migrate
uv run --project apps/api python apps/api/manage.py runserver
pnpm test:api       # tests Python, depuis la racine ; demande le PostgreSQL ci-dessus
pnpm gen:api        # régénère apps/web/src/api/schema.d.ts après un changement d'API
```

`pnpm dev` proxifie alors `/api` et `/_allauth` vers `apps/api` (voir `apps/web/vite.config.ts`).
Détail du serveur dans `apps/api/README.md`. Déploiement sur le VPS : `docs/deploiement-vps.md`.

## Utiliser sans serveur (palier 2)

1. Ouvrir l'application, créer un compte avec son libellé et son identifiant IB.
2. Sources de données : importer la réponse XML d'une Flex Query (Activity, Last 365 Days,
   sections Trades, Cash Transactions, Corporate Actions, Open Positions, Cash Report) et,
   pour l'historique antérieur, des relevés d'activité exportés en HTML depuis le Client
   Portal. Si une de ces sections n'est pas cochée dans la configuration de la Flex Query côté
   Client Portal, l'import le signale. La même page permet aussi d'importer sa table
   sectorielle personnelle au format CSV.
3. Historique : toutes les transactions, filtres, soldes cumulés USD et EUR.
4. Positions et Dashboard : couverture de chaque option courte, cash requis contre
   disponible, positions non couvertes.

Les données restent dans IndexedDB du navigateur. Rien ne quitte la machine.

## Structure

`apps/web` (SPA), `apps/api` (serveur Django : utilisateurs, invitations, proxy Flex — jamais
de donnée de portefeuille), `packages/ledger` (modèle et calculs), `packages/ib-parsers`
(Flex XML, relevé HTML), `packages/coverage` (moteur de couverture), `packages/ui`
(composants shadcn),
`deploy/traefik` (infrastructure partagée du VPS, pas de l'application). Détail dans
`CLAUDE.md`.
