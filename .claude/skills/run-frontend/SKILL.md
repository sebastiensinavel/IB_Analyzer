---
name: run-frontend
description: Run, launch, drive and screenshot the IB Analyzer 2 web app (Vite + React + shadcn/base-ui) headlessly. Use when asked to start the frontend, check a UI change in the real app, take a screenshot of a page, or verify the sidebar/history/sources screens visually.
---

# Lancer et piloter le frontend

L'app est un SPA Vite + React servi sur `:5173` **depuis le checkout principal**. La
machine est un VPS **sans écran ni navigateur** : on la pilote avec Chromium headless via
`.claude/skills/run-frontend/driver.mjs`, qui démarre (ou réutilise) le serveur
de dev, navigue, et écrit des PNG.

Tous les chemins ci-dessous sont relatifs à la racine du checkout courant — racine du
dépôt ou worktree.

## Un port par checkout

`tools/dev-env/ports.mjs` décide des ports d'un checkout : `5173`/`8000` à la racine du
dépôt, `5173+N`/`8000+N` pour un worktree `.claude/worktrees/<nom>`, N étant le plus petit
numéro libre parmi les worktrees vivants (5174/8001 pour le premier, 5175/8002 pour le
second ; jamais 8100 qui est l'agent). Le numéro est gardé dans
`.git/worktrees/<nom>/dev-slot` toute la vie du worktree. Vite, Playwright,
le driver et `pnpm dev:api` lisent tous la même règle, et Vite refuse de glisser sur un
autre port (`strictPort`). Conséquence : Seb peut faire tourner l'app à la racine
pendant qu'un worktree vérifie sa propre branche, **sans jamais capturer la mauvaise
version du code**. IndexedDB étant par origine, chaque port a aussi sa propre base
navigateur — un worktree qui reprend un numéro reprend aussi la base navigateur de son
prédécesseur. Le driver affiche sa ligne `dev-env: worktree <nom> (slot 1) → web :5174, api
:8001, db ib_analyzer_dev_ports` en tête de run : la lire.

`pnpm dev:start` laisse Vite et Django tourner en arrière-plan sur ces ports (le driver
réutilise alors ce Vite), `pnpm dev:stop` arrête ce qui écoute dessus.

`WEB_PORT`, `API_PORT` et `DATABASE_URL` dans l'environnement priment sur la dérivation.

## Prérequis (une seule fois par machine)

```bash
pnpm install                                          # playwright est en devDependency de apps/web
pnpm --filter web exec playwright install chromium     # ~115 Mo dans ~/.cache/ms-playwright
```

Chromium a besoin de bibliothèques système (`libatk-1.0.so.0`, `libnss3`,
`libgbm`…). Pour savoir si elles manquent :

```bash
pnpm --filter web exec playwright install-deps --dry-run chromium
```

Si ça liste des paquets, il faut les installer en root
(`sudo pnpm --filter web exec playwright install-deps chromium`). **Demander à
Seb** plutôt que d'utiliser `sudo` soi-même : il préfère le faire à la main.

## Piloter l'app (chemin agent)

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history --seed
```

Sortie vérifiée :

```
dev server: started on http://127.0.0.1:5173
/accounts/alpha/history -> /tmp/ib-frontend-shots/accounts-alpha-history.png  (landed on /accounts/alpha/history)
```

Plusieurs routes d'un coup, et les options utiles :

```bash
node .claude/skills/run-frontend/driver.mjs \
  /accounts/alpha/history /accounts/alpha/sources /accounts \
  --seed --out=/tmp/shots
```

| Option | Effet |
|---|---|
| `--seed` | Amorce IndexedDB avec deux comptes de démo et un petit grand livre (`src/mocks/seed.ts`) — **aucun fichier requis** |
| `--dark` | Bascule le thème sombre via le bouton de l'app (voir Pièges) |
| `--out=<dir>` | Dossier des PNG (défaut `/tmp/ib-frontend-shots`) |
| `--port=<n>` | Port du serveur de dev (défaut : celui du checkout, voir « Un port par checkout ») |
| `--width=` / `--height=` | Viewport (défaut 1280×800) |
| `--keep` | Laisse le serveur de dev tourner après le run |
| `--empty` | Crée les deux comptes de démo sans aucune donnée (`seedAccounts`) : la première visite d'un utilisateur. Exclusif avec `--seed` |
| `--ib-account=<id>` | Après `--seed` ou `--empty`, remplace l'identifiant IB du compte de la première route, pour importer un vrai fichier |
| `--import=<fichier>` | Importe un Flex XML ou un relevé HTML sur Sources de données avant la capture ; se répète, dans l'ordre donné |
| `--sectors=<fichier>` | Importe un CSV sectoriel sur la page Secteur et Score avant la capture |
| `--agent` | Intercepte l'agent local (`127.0.0.1:8100`) avec `src/mocks/agent-snapshot.json` et pose un port TWS sur le compte de la première route : les pages passent « en direct » sans TWS ni agent |
| `--wait=<ms>` | Attend ce délai avant chaque capture, quelle que soit la page. Sans lui, une page qui porte un graphique ECharts (`[_echarts_instance_]`) attend 1 200 ms, le temps de son animation d'entrée (une seconde environ) : capturé plus tôt, un graphique montre ses courbes à mi-course. Une page sans graphique est capturée aussitôt |

## Positions et Dashboard

Les pages Positions et Dashboard lisent le snapshot semé par `--seed` sur `alpha`
(`src/mocks/positions.ts`) : une jambe nue, un condor, des puts cash-secured. Pour les
voir sur des données réelles :

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/beta/positions /accounts/beta/dashboard \
  --seed --ib-account=U1234567 --import=private/flex_<compte>_<date>.xml \
  --sectors=private/company.csv
```

Pour chaque route, le driver écrit `<route>.png` (page entière) **et**
`<route>-sidebar.png` (le menu latéral seul, pratique pour juger une
modification de navigation), affiche l'URL réellement atteinte — ce qui vérifie
les redirections — et les erreurs console. Il sort en code 1 si une route a
loggé la moindre erreur console : il n'y a pas de backend, donc toute erreur
est fatale, il n'y a plus d'erreurs d'API à excuser.

**Toujours ouvrir le PNG avec l'outil Read.** Une capture blanche = l'app n'a
pas démarré, et le driver ne le dira pas.

Le driver réutilise un serveur déjà en écoute sur le port au lieu d'en démarrer
un second, et ne le tue pas en fin de run. C'est sûr parce que le port est celui du
checkout : à la racine, c'est le serveur de Seb sur `:5173`, qui sert le même code ;
dans un worktree, c'est le serveur laissé par un `--keep` précédent du même worktree.

Sans Django sur le port API du checkout, le proxy Vite répond 502 sur `/api` et
`/_allauth` : le driver le note en une ligne (« api: no Django on :8022 … tolerated »)
et ne le compte pas comme une erreur, l'app n'exigeant jamais de connexion. Avec
Django en marche et personne de connecté, allauth répond 401 sur `/_allauth` : même
traitement, une ligne (« … answered 401 on /_allauth … nobody signed in ») et pas
d'erreur, c'est l'état anonyme normal. Toute autre erreur console reste fatale.

## Un seul fichier

Les trois scénarios du sous-projet 9, sur des comptes vides. L'identifiant IB se lit dans le
fichier et le relevé se désigne par un motif : ni l'un ni l'autre n'est écrit dans une commande
versionnée.

```bash
ALPHA=$(grep -o 'accountId="[^"]*"' private/flex_<compte>_<date>.xml | head -1 | cut -d'"' -f2)
LATEST=$(ls private/U*.htm | grep "$ALPHA" | sort | tail -1)
ROUTES="/accounts/alpha/dashboard /accounts/alpha/positions /accounts/alpha/history /accounts/alpha/journal/wheel /accounts/alpha/sources"
node .claude/skills/run-frontend/driver.mjs $ROUTES --empty --ib-account=$ALPHA --import=$LATEST --out=/tmp/ib-shots/html-seul
node .claude/skills/run-frontend/driver.mjs $ROUTES --empty --ib-account=$ALPHA --import=private/flex_<compte>_<date>.xml --out=/tmp/ib-shots/flex-seul
node .claude/skills/run-frontend/driver.mjs $ROUTES --empty --ib-account=$ALPHA --import=$LATEST --import=private/flex_<compte>_<date>.xml --out=/tmp/ib-shots/html-flex
```

## Agent local

Cette machine n'a ni TWS ni agent. `--agent` fait répondre Playwright à leur place :

    node .claude/skills/run-frontend/driver.mjs /accounts/alpha/positions /accounts/alpha/history /accounts/alpha/sources --seed --agent

La barre de titre montre le badge vert « En direct », Historique la vente d'option du jour, Sources de
données la carte Agent local avec « Agent détecté ». Sans `--agent`, aucun bouton Actualiser
n'apparaît : c'est le comportement voulu aux paliers 1 et 2.

## Chemin humain

```bash
pnpm --filter web exec vite    # http://localhost:5173, Ctrl-C pour arrêter
```

Sans intérêt depuis cette machine (aucun navigateur) ; utile seulement si Seb
regarde depuis son Mac via un tunnel SSH.

## Tests

```bash
pnpm --filter web test        # vitest
pnpm --filter web typecheck   # tsc -b, silencieux si OK
pnpm lint                     # oxlint sur le monorepo, un petit nombre d'avertissements préexistants attendus
```

## Pièges

- **Le thème ne suit pas `prefers-color-scheme`.** Lancer Playwright avec
  `colorScheme: "dark"` donne une capture *identique* à la version claire :
  l'app stocke son thème elle-même et pose la classe `dark` sur `<html>`. Il
  faut cliquer le bouton du pied de menu — c'est ce que fait `--dark`.
- **Le menu latéral est en mode `offcanvas`, pas en mode icône.** Le bouton de
  repli le fait disparaître entièrement ; il n'y a pas de rail d'icônes à
  vérifier.
- **IndexedDB est par origine.** `--seed` remplit `http://127.0.0.1:5173`, pas
  `localhost` : les deux sont des origines différentes pour un navigateur, donc
  toujours utiliser la même adresse d'un run à l'autre (le driver s'y tient).
- **Dans un worktree, `pnpm install` suffit.** Contrairement à `npm`/`node_modules`
  liés à la main, `pnpm` résout les paquets du monorepo depuis le store partagé :
  pas de lien symbolique à créer.

## Dépannage

| Symptôme | Cause / correctif |
|---|---|
| `error while loading shared libraries: libatk-1.0.so.0` | Libs système manquantes → `pnpm --filter web exec playwright install-deps --dry-run chromium`, puis demander à Seb de les installer |
| `Cannot find package 'playwright'` | `pnpm install` n'a pas tourné à la racine du dépôt — `playwright` est en devDependency de `apps/web` |
| `vite never came up on http://127.0.0.1:5173` | Le port est pris par autre chose que Vite → `--port=<autre>` (le port dérivé du worktree apparaît dans la ligne `dev-env:`) |
| Capture blanche ou route restée sur `/accounts` | Pas de compte en IndexedDB → ajouter `--seed`, ou route inexistante — vérifier l'URL atteinte affichée par le driver |
