# Sous-projet 40 — L'application s'ouvre serveur coupé, et s'installe : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Cocher chaque case dans le même commit que la tâche** (CLAUDE.md, Workflow).

**Goal:** Un navigateur qui a déjà ouvert le site l'ouvre encore serveur arrêté ou en 502 ; une nouvelle version s'annonce par un bandeau qui fait recharger tous les onglets ; l'application est installable.

**Architecture:** `vite-plugin-pwa` (Workbox, `generateSW`, `registerType: "prompt"`) pré-cache le build et sert `index.html` à toute navigation du SPA ; aucune réponse de serveur n'est mise en cache. Le code applicatif qui parle au Service Worker vit dans `apps/web/src/pwa/` ; un filet `versionchange` Dexie vit dans `apps/web/src/db/`. Un suite Playwright à part (`apps/web/e2e-offline/`) teste un vrai build servi par un petit serveur Node qu'elle pilote (servir, 502, arrêt).

**Tech Stack:** Vite 8, vite-plugin-pwa 1.3 (peer : `workbox-window` 7.4), React 19, react-i18next, Dexie 4, Vitest + fake-indexeddb, Playwright 1.62.

**Spec:** `docs/specs/2026-09-29-hors-ligne-installable-design.md` — à lire avant toute tâche.

## Global Constraints

- Aucun changement de Django, de Traefik, de l'agent ni de `deploy/iba`.
- Aucune réponse du serveur ni de l'agent dans un cache du Service Worker : pas de `runtimeCaching`.
- Préfixes exclus du repli de navigation, une seule liste : `/api`, `/_allauth`, `/static`, `/admin`, `/agent`.
- `agent/**` jamais pré-caché.
- Service Worker désactivé en `pnpm dev` (`devOptions.enabled: false`).
- Seul `apps/web/src/pwa/` importe `virtual:pwa-register/react`.
- `UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000`, une seule définition, dans `apps/web/src/pwa/updates.ts`.
- Manifeste : `name` « IB Options Analyzer », `short_name` « IB Analyzer », `start_url` `/`, `scope` `/`, `display` `standalone`, `theme_color` `#0e9f90`, `background_color` `#f3f5f8`.
- Aucun port codé en dur dans l'outillage (CLAUDE.md, Outillage) : le serveur de la suite e2e-offline écoute sur le port 0.
- Tous les textes visibles dans `apps/web/src/i18n/{fr,en}.json`.
- Tests `apps/web` : filtrer par `npx vitest run <motif>` depuis `apps/web`. `pnpm check` une seule fois, à la fin (tâche 6).
- Arbitrage d'affichage tranché ici, à ne pas rouvrir : le bandeau est une carte fixe en bas, centrée, `max-w-md`, marge latérale 1rem, au-dessus de tout (`z-50`), `role="status"`, texte à gauche, bouton `Recharger` (variante par défaut) à droite, bas décalé de `env(safe-area-inset-bottom)`.

## Review Focus

1. **Première installation** : l'onglet qui installe le premier Service Worker ne doit pas recharger (le `clientsClaim` déclenche pourtant `controllerchange`). Test en tâche 3.
2. **Vérification horaire hors ligne ou serveur coupé** : `registration.update()` rejette ; aucune promesse rejetée non gérée, aucun bandeau. Test en tâche 3.
3. **Route profonde et routes hors compte** (`/login`, `/invitation/<jeton>`) rechargées serveur coupé : `index.html` du cache, jamais la page d'erreur du navigateur. Test en tâche 5.
4. **Maj+Recharger dans un onglet pendant qu'un autre tourne sur l'ancien code** : l'ancien onglet reçoit `versionchange` et recharge au lieu de rester sur une base fermée. Test en tâche 4.
5. **Double rechargement** : l'onglet du clic ne doit pas recharger deux fois (la bibliothèque et notre écouteur). Vérification en tâche 3.

---

## Fichiers

- Create `apps/web/scripts/render-icons.mjs` — rend les PNG depuis `public/favicon.svg` (tâche 1).
- Create `apps/web/public/pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`, `apple-touch-icon.png` (tâche 1).
- Create `apps/web/pwa.config.ts` (+ `pwa.config.test.ts`) — les options du plugin (tâche 2).
- Modify `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/tsconfig.app.json`, `apps/web/tsconfig.node.json`, `apps/web/index.html`, `apps/web/nginx.conf` (tâche 2).
- Create `apps/web/src/pwa/updates.ts` (+ `.test.ts`), `apps/web/src/pwa/UpdateBanner.tsx` (+ `.test.tsx`) (tâche 3).
- Modify `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/i18n/{fr,en}.json` (tâches 3, 4, 6).
- Create `apps/web/src/db/reloadOnVersionChange.ts` (+ `.test.ts`) (tâche 4).
- Create `apps/web/e2e-offline/server.ts`, `global-setup.ts`, `offline.spec.ts`, `apps/web/playwright.offline.config.ts` (tâche 5).
- Modify `apps/web/src/pages/HelpPage.tsx` (+ test), `CLAUDE.md`, `docs/deploiement-vps.md`, la spec (tâche 6).

---

### Task 1: Les icônes de l'application

**Files:**
- Create: `apps/web/scripts/render-icons.mjs`
- Create: `apps/web/public/pwa-192x192.png`, `apps/web/public/pwa-512x512.png`, `apps/web/public/pwa-maskable-512x512.png`, `apps/web/public/apple-touch-icon.png`

**Interfaces:**
- Produces: les quatre fichiers PNG ci-dessus, à la racine du site ; la tâche 2 les déclare dans le manifeste et `index.html`.

Le script n'est pas testé unitairement (il ne tourne ni dans `pnpm build` ni dans `pnpm check`) : sa vérification est de regarder les quatre PNG produits.

- [x] **Step 1: Écrire le script**

`favicon.svg` fait 28×28, un carré arrondi (`rx="8"`) en dégradé et un chemin « IB ». Le script lit le SVG, fabrique trois variantes et les rend avec Playwright (Chromium, `colorScheme: "light"` : les couleurs claires du favicon) :

```js
// apps/web/scripts/render-icons.mjs
// Les icônes de l'application installée (sous-projet 40), rendues depuis public/favicon.svg
// en thème clair. À relancer à la main quand le logo change : `node scripts/render-icons.mjs`
// depuis apps/web. Ni `pnpm build` ni `pnpm check` ne l'exécutent ; les PNG sont versionnés.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
const favicon = await readFile(join(publicDir, "favicon.svg"), "utf8");

// Plein cadre : le carré sans ses coins arrondis. Android découpe l'icône « maskable » dans
// sa propre forme, iOS arrondit l'apple-touch-icon lui-même — un coin transparent y
// deviendrait noir.
const fullBleed = favicon.replace('rx="8" ', "");
// Maskable : le texte réduit à 70 % autour du centre, dans la zone sûre (cercle de 80 %).
const maskable = fullBleed.replace('<path class="text"', '<path class="text" transform="translate(14 14) scale(0.7) translate(-14 -14)"');

const icons = [
  { file: "pwa-192x192.png", svg: favicon, size: 192 },
  { file: "pwa-512x512.png", svg: favicon, size: 512 },
  { file: "pwa-maskable-512x512.png", svg: maskable, size: 512 },
  { file: "apple-touch-icon.png", svg: fullBleed, size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { file, svg, size } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, colorScheme: "light" });
    const sized = svg.replace('width="28" height="28"', `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await writeFile(join(publicDir, file), await page.screenshot({ omitBackground: true }));
    await page.close();
  }
} finally {
  await browser.close();
}
```

Si l'un des `replace` ne trouve pas sa cible (le favicon a changé), le script doit échouer plutôt que produire une icône fausse : vérifier chaque remplacement (`if (result === source) throw new Error(...)`).

- [x] **Step 2: Rendre les icônes**

Run: `cd apps/web && node scripts/render-icons.mjs`
Expected: quatre PNG dans `apps/web/public/`. Si Chromium manque : `npx playwright install chromium`.

- [x] **Step 3: Vérifier**

Ouvrir les quatre PNG avec l'outil Read : logo teal lisible, « IB » blanc ; 192/512 avec coins arrondis transparents ; maskable et apple-touch plein cadre, texte plus petit sur la maskable.

- [x] **Step 4: Commit**

```bash
git add apps/web/scripts/render-icons.mjs apps/web/public/*.png docs/plans/2026-09-29-hors-ligne-installable.md
git commit -m "PWA : icônes de l'application installée, rendues depuis le favicon"
```

---

### Task 2: Le plugin, le manifeste, nginx

**Files:**
- Create: `apps/web/pwa.config.ts`, `apps/web/pwa.config.test.ts`
- Modify: `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/tsconfig.app.json`, `apps/web/tsconfig.node.json`, `apps/web/index.html`, `apps/web/nginx.conf`

**Interfaces:**
- Consumes: les PNG de la tâche 1.
- Produces: `export const pwaOptions: Partial<VitePWAOptions>` et `export const SERVER_PREFIXES: readonly string[]` dans `apps/web/pwa.config.ts` ; le module virtuel `virtual:pwa-register/react` disponible au typage (types `vite-plugin-pwa/react`) ; un build qui écrit `dist/sw.js` et `dist/manifest.webmanifest`.

- [x] **Step 1: Installer**

Run: `pnpm --filter web add -D vite-plugin-pwa@^1.3.0 workbox-window@^7.4.1`

- [x] **Step 2: Écrire le test qui échoue**

```ts
// apps/web/pwa.config.test.ts
import { describe, expect, it } from "vitest";
import { SERVER_PREFIXES, pwaOptions } from "./pwa.config";

const denylist = pwaOptions.workbox!.navigateFallbackDenylist!;
const denied = (path: string) => denylist.some((re) => re.test(path));

describe("pwaOptions", () => {
  it("n'envoie jamais une route du serveur sur index.html", () => {
    for (const path of ["/api/flex/send", "/_allauth/browser/v1/auth/session", "/static/admin/x.css", "/admin/", "/agent/index.json", "/api"]) {
      expect(denied(path), path).toBe(true);
    }
  });

  it("sert index.html à toute route du SPA, y compris hors compte", () => {
    for (const path of ["/", "/accounts", "/accounts/alpha/positions", "/accounts/alpha/journal/wheel", "/login", "/invitation/abc", "/apiary", "/agents"]) {
      expect(denied(path), path).toBe(false);
    }
  });

  it("couvre exactement les préfixes routés vers Django et la roue de l'agent", () => {
    expect([...SERVER_PREFIXES].sort()).toEqual(["/_allauth", "/admin", "/agent", "/api", "/static"]);
  });

  it("ne pré-cache jamais la roue de l'agent et ne met rien en cache à l'exécution", () => {
    expect(pwaOptions.workbox!.globIgnores).toContain("agent/**");
    expect(pwaOptions.workbox!.runtimeCaching).toBeUndefined();
  });

  it("attend le clic du bandeau et reste éteint en développement", () => {
    expect(pwaOptions.registerType).toBe("prompt");
    expect(pwaOptions.devOptions?.enabled).toBe(false);
    expect(pwaOptions.workbox!.clientsClaim).toBe(true);
    expect(pwaOptions.workbox!.skipWaiting).toBeFalsy();
  });

  it("déclare le manifeste de la spec", () => {
    expect(pwaOptions.manifest).toMatchObject({
      name: "IB Options Analyzer",
      short_name: "IB Analyzer",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#0e9f90",
      background_color: "#f3f5f8",
    });
  });
});
```

Note : `/apiary` et `/agents` ne sont pas des routes, mais prouvent que la règle porte sur un segment entier (`^/api(/|$)`), pas un début de chaîne.

- [x] **Step 3: Vérifier l'échec**

Run: `cd apps/web && npx vitest run pwa.config`
Expected: FAIL, module `./pwa.config` introuvable.

- [x] **Step 4: Écrire `pwa.config.ts`**

```ts
// apps/web/pwa.config.ts
import type { VitePWAOptions } from "vite-plugin-pwa";

/**
 * Chemins qui n'appartiennent pas au SPA (sous-projet 40) : Traefik envoie les trois premiers
 * à Django (`docker-compose.yml`, routeur `api`), `/admin` ne se joint que par tunnel SSH, et
 * nginx sert `/agent/` (la roue de l'agent). Le Service Worker ne leur substitue jamais
 * `index.html` : serveur coupé, leur appel échoue comme avant, et l'application le gère déjà.
 */
export const SERVER_PREFIXES = ["/api", "/_allauth", "/static", "/admin", "/agent"] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const pwaOptions: Partial<VitePWAOptions> = {
  // Une nouvelle version attend le clic du bandeau (`src/pwa/UpdateBanner.tsx`).
  registerType: "prompt",
  // L'enregistrement passe par `useRegisterSW` (src/pwa/), jamais par un script injecté.
  injectRegister: false,
  devOptions: { enabled: false },
  includeAssets: ["favicon.svg", "apple-touch-icon.png"],
  manifest: {
    name: "IB Options Analyzer",
    short_name: "IB Analyzer",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#0e9f90",
    background_color: "#f3f5f8",
    icons: [
      { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{html,js,css,svg,png,woff2,webmanifest}"],
    // `pnpm build:agent` écrit la roue dans public/agent/, que le build recopie : jamais en cache.
    globIgnores: ["agent/**"],
    navigateFallback: "index.html",
    navigateFallbackDenylist: SERVER_PREFIXES.map((p) => new RegExp(`^${escape(p)}(/|$)`)),
    // Première installation : l'onglet passe sous contrôle sans rechargement. Une mise à jour,
    // elle, n'est activée que par le SKIP_WAITING du bandeau.
    clientsClaim: true,
    cleanupOutdatedCaches: true,
  },
};
```

Vérifier que la taille du plus gros chunk ne dépasse pas `maximumFileSizeToCacheInBytes` (2 Mio par défaut) : si le build avertit qu'un fichier est ignoré, relever la limite dans `workbox` (par ex. `5 * 1024 * 1024`) et le commenter — un chunk ignoré serait absent serveur coupé.

- [x] **Step 5: Brancher le plugin**

`apps/web/vite.config.ts` :

```ts
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.config";
// …
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
```

`apps/web/tsconfig.node.json` : ajouter `"pwa.config.ts"` et `"pwa.config.test.ts"` à `include`.
`apps/web/tsconfig.app.json` : `"types": ["vite/client", "vite-plugin-pwa/react"]`.

`apps/web/index.html`, dans `<head>` après le favicon :

```html
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0e9f90" />
```

(Le plugin injecte lui-même le `<link rel="manifest">` au build.)

- [x] **Step 6: nginx**

`nginx:alpine` ne connaît pas l'extension `.webmanifest` (vérifié le 2026-09-29 : absente de `/etc/nginx/mime.types`) et la servirait en `application/octet-stream`. Ajouter avant `location /` :

```nginx
    # The install manifest (sub-project 40): nginx:alpine's mime.types lacks the extension.
    # `sw.js` itself falls under `location /` below: never cached, or a broken service worker
    # could never be replaced.
    location = /manifest.webmanifest {
        default_type application/manifest+json;
        add_header Cache-Control "no-cache";
    }
```

- [x] **Step 7: Tests et build**

Run: `cd apps/web && npx vitest run pwa.config`
Expected: PASS.

Run: `pnpm --filter web build && ls apps/web/dist/sw.js apps/web/dist/manifest.webmanifest && grep -c "agent/" apps/web/dist/sw.js; grep -o 'rel="manifest"[^>]*' apps/web/dist/index.html`
Expected: les deux fichiers existent ; `0` occurrence de `agent/` dans la liste de pré-cache de `sw.js` ; le lien du manifeste dans `index.html`. Le build ne doit signaler aucun fichier ignoré pour sa taille.

Si Docker est disponible : `docker run --rm -v $PWD/apps/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t` → `syntax is ok`.

- [x] **Step 8: Commit**

```bash
git add apps/web/pwa.config.ts apps/web/pwa.config.test.ts apps/web/vite.config.ts apps/web/package.json pnpm-lock.yaml apps/web/tsconfig.app.json apps/web/tsconfig.node.json apps/web/index.html apps/web/nginx.conf docs/plans/2026-09-29-hors-ligne-installable.md
git commit -m "PWA : Service Worker pré-caché, manifeste, routes du serveur exclues"
```

---

### Task 3: La mise à jour et son bandeau

**Files:**
- Create: `apps/web/src/pwa/updates.ts`, `apps/web/src/pwa/updates.test.ts`
- Create: `apps/web/src/pwa/UpdateBanner.tsx`, `apps/web/src/pwa/UpdateBanner.test.tsx`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `virtual:pwa-register/react` (tâche 2) — `useRegisterSW(options): { needRefresh: [boolean, Dispatch<SetStateAction<boolean>>], offlineReady: [...], updateServiceWorker: (reloadPage?: boolean) => Promise<void> }`, `options.onRegisteredSW(swUrl: string, registration: ServiceWorkerRegistration | undefined)`.
- Produces:
  - `export const UPDATE_CHECK_INTERVAL_MS: number`
  - `export function reloadOnControllerChange(container: Pick<ServiceWorkerContainer, "controller" | "addEventListener" | "removeEventListener"> | undefined, reload: () => void): () => void` — renvoie le désabonnement.
  - `export function scheduleUpdateChecks(registration: Pick<ServiceWorkerRegistration, "update">, isOnline: () => boolean, intervalMs?: number): () => void` — renvoie l'arrêt.
  - `export function UpdateBanner(): JSX.Element | null`
  - clés i18n `pwa.updateAvailable`, `pwa.reload`.

- [x] **Step 1: Tests qui échouent — `updates.test.ts`**

```ts
// apps/web/src/pwa/updates.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, reloadOnControllerChange, scheduleUpdateChecks } from "./updates";

function fakeContainer(controller: object | null) {
  const target = new EventTarget();
  return Object.assign(target, { controller }) as unknown as ServiceWorkerContainer;
}

describe("reloadOnControllerChange", () => {
  it("recharge un onglet qui avait déjà un contrôleur : une mise à jour a pris la main", () => {
    const container = fakeContainer({});
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne recharge pas l'onglet de la première installation", () => {
    const container = fakeContainer(null);
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("ne recharge qu'une fois, même sur deux événements", () => {
    const container = fakeContainer({});
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien sans Service Worker dans le navigateur", () => {
    expect(() => reloadOnControllerChange(undefined, vi.fn())()).not.toThrow();
  });
});

describe("scheduleUpdateChecks", () => {
  afterEach(() => vi.useRealTimers());

  it("vérifie toutes les heures", () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(undefined);
    const stop = scheduleUpdateChecks({ update }, () => true);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("ne vérifie pas hors ligne", () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(undefined);
    scheduleUpdateChecks({ update }, () => false);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).not.toHaveBeenCalled();
  });

  it("avale l'échec d'une vérification, serveur coupé", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const update = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    scheduleUpdateChecks({ update }, () => true);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await Promise.resolve();
    process.off("unhandledRejection", unhandled);
    expect(update).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/pwa/updates`
Expected: FAIL, module introuvable.

- [x] **Step 3: Écrire `updates.ts`**

```ts
// apps/web/src/pwa/updates.ts
/** Une nouvelle version publiée est cherchée au chargement, puis à cet intervalle. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Recharge l'onglet quand une nouvelle version du Service Worker en prend le contrôle — dans
 * chaque onglet, pas seulement celui du clic sur « Recharger » : un vieil onglet chercherait
 * des fichiers `assets/*` qui n'existent plus et parlerait à une base au schéma plus récent.
 * Un onglet sans contrôleur au démarrage est celui de la première installation
 * (`clientsClaim`) : il ne recharge pas.
 */
export function reloadOnControllerChange(
  container: Pick<ServiceWorkerContainer, "controller" | "addEventListener" | "removeEventListener"> | undefined,
  reload: () => void,
): () => void {
  if (!container) return () => {};
  const hadController = container.controller !== null;
  let reloading = false;
  const onChange = () => {
    if (!hadController || reloading) return;
    reloading = true;
    reload();
  };
  container.addEventListener("controllerchange", onChange);
  return () => container.removeEventListener("controllerchange", onChange);
}

/** Cherche une nouvelle version toutes les heures, sauf hors ligne ; un échec est silencieux. */
export function scheduleUpdateChecks(
  registration: Pick<ServiceWorkerRegistration, "update">,
  isOnline: () => boolean,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): () => void {
  const id = setInterval(() => {
    if (!isOnline()) return;
    registration.update().catch(() => {
      // Serveur en maintenance : on réessaiera à l'heure suivante.
    });
  }, intervalMs);
  return () => clearInterval(id);
}
```

- [x] **Step 4: Vérifier**

Run: `cd apps/web && npx vitest run src/pwa/updates`
Expected: PASS.

- [x] **Step 5: Tests qui échouent — `UpdateBanner.test.tsx`**

Le Service Worker n'existe pas dans jsdom : `virtual:pwa-register/react` est la seule doublure du sous-projet (spec §8). `vi.mock` du module virtuel ; si Vitest ne résout pas le module virtuel pour le moquer, ajouter dans `vite.config.ts`, bloc `test`, `alias: { "virtual:pwa-register/react": "<chemin>/src/pwa/testing/registerStub.ts" }` avec un stub qui exporte `useRegisterSW` — et le mock du test le remplace de la même façon.

```tsx
// apps/web/src/pwa/UpdateBanner.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS } from "./updates";

const state = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn(async () => {}),
  options: undefined as undefined | { onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void },
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: typeof state.options) => {
    state.options = options;
    return {
      needRefresh: [state.needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: state.updateServiceWorker,
    };
  },
}));

const { UpdateBanner } = await import("./UpdateBanner");

describe("UpdateBanner", () => {
  beforeEach(() => {
    state.needRefresh = false;
    state.updateServiceWorker.mockClear();
    state.options = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it("ne montre rien tant qu'aucune version n'attend", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("annonce la version en attente et l'active au clic", async () => {
    state.needRefresh = true;
    render(<UpdateBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Nouvelle version disponible");
    await userEvent.click(screen.getByRole("button", { name: "Recharger" }));
    expect(state.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it("programme la vérification horaire une fois le Service Worker enregistré", () => {
    vi.useFakeTimers();
    render(<UpdateBanner />);
    const update = vi.fn().mockResolvedValue(undefined);
    state.options!.onRegisteredSW!("/sw.js", { update } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("ne programme rien sans enregistrement", () => {
    render(<UpdateBanner />);
    expect(() => state.options!.onRegisteredSW!("/sw.js", undefined)).not.toThrow();
  });
});
```

- [x] **Step 6: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/pwa/UpdateBanner`
Expected: FAIL, module `./UpdateBanner` introuvable.

- [x] **Step 7: Écrire le bandeau et les textes**

`fr.json`, nouvelle clé de premier niveau `"pwa": { "updateAvailable": "Nouvelle version disponible", "reload": "Recharger" }` ; `en.json` : `"pwa": { "updateAvailable": "New version available", "reload": "Reload" }`.

```tsx
// apps/web/src/pwa/UpdateBanner.tsx
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";
import { scheduleUpdateChecks } from "./updates";

/**
 * Annonce une version publiée depuis le chargement (sous-projet 40). Le clic l'active ; chaque
 * onglet recharge alors par `reloadOnControllerChange` (main.tsx). Posé hors du routeur, il
 * paraît sur toutes les routes, avec ou sans compte.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) scheduleUpdateChecks(registration, () => navigator.onLine);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <span>{t("pwa.updateAvailable")}</span>
      <Button size="sm" onClick={() => void updateServiceWorker(false)}>
        {t("pwa.reload")}
      </Button>
    </div>
  );
}
```

Vérifier le chemin réel de `Button` (`grep -rn "export.*Button" apps/web/src/components/ui packages/ui/src | head`) et l'importer comme le font les pages existantes.

**Double rechargement (Review Focus 5)** : lire `node_modules/vite-plugin-pwa/dist/client/build/register.js` (ou l'équivalent sous `dist/`). Si `updateServiceWorker(false)` recharge malgré tout l'onglet sur l'événement `controlling` de workbox-window, notre `reloadOnControllerChange` recharge aussi ; les deux appellent `location.reload()` dans la même tâche, ce qui ne produit qu'une navigation. Consigner ce qui a été constaté en un commentaire d'une ligne au-dessus de l'appel `updateServiceWorker`.

- [x] **Step 8: Brancher**

`apps/web/src/main.tsx`, avant `createRoot` :

```ts
import { reloadOnControllerChange } from "@/pwa/updates";
// …
// Une nouvelle version du Service Worker a pris la main (bandeau « Recharger », sous-projet
// 40) : chaque onglet recharge, pas seulement celui du clic.
reloadOnControllerChange(navigator.serviceWorker, () => window.location.reload());
```

`apps/web/src/App.tsx` : `<UpdateBanner />` juste après `<RouterProvider router={router} />`, dans `DbProvider` (il n'en dépend pas, mais doit être sous `I18nextProvider`).

Vérifier que `App.test.tsx` passe toujours : s'il échoue sur le module virtuel, y ajouter le même `vi.mock` que ci-dessus avec `needRefresh: false`.

- [x] **Step 9: Vérifier**

Run: `cd apps/web && npx vitest run src/pwa src/App`
Expected: PASS.

- [x] **Step 10: Commit**

```bash
git add apps/web/src/pwa apps/web/src/main.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json apps/web/vite.config.ts docs/plans/2026-09-29-hors-ligne-installable.md
git commit -m "PWA : bandeau de mise à jour, tous les onglets rechargent ensemble"
```

---

### Task 4: Le filet `versionchange` de Dexie

**Files:**
- Create: `apps/web/src/db/reloadOnVersionChange.ts`, `apps/web/src/db/reloadOnVersionChange.test.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `db` et `AppDatabase` de `apps/web/src/db/schema.ts`.
- Produces: `export function reloadOnVersionChange(database: Dexie, reload: () => void): void`.

- [x] **Step 1: Test qui échoue**

```ts
// apps/web/src/db/reloadOnVersionChange.test.ts
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { AppDatabase } from "./schema";
import { reloadOnVersionChange } from "./reloadOnVersionChange";

describe("reloadOnVersionChange", () => {
  it("recharge l'onglet dont une autre connexion monte le schéma, et ne la bloque pas", async () => {
    const name = "reload-on-versionchange";
    const old = new AppDatabase(name);
    await old.open();
    const reload = vi.fn();
    reloadOnVersionChange(old, reload);

    const newer = new Dexie(name);
    newer.version(old.verno + 1).stores({});
    await newer.open(); // se bloquerait si l'ancienne connexion restait ouverte

    expect(reload).toHaveBeenCalledTimes(1);
    expect(old.isOpen()).toBe(false);
    newer.close();
    await Dexie.delete(name);
  });

  it("ne recharge pas sur une simple ouverture au même schéma", async () => {
    const name = "reload-on-versionchange-same";
    const a = new AppDatabase(name);
    await a.open();
    const reload = vi.fn();
    reloadOnVersionChange(a, reload);
    const b = new AppDatabase(name);
    await b.open();
    expect(reload).not.toHaveBeenCalled();
    a.close();
    b.close();
    await Dexie.delete(name);
  });
});
```

Note : `newer.version(...).stores({})` n'efface aucune table dans Dexie 4 (une table absente d'une version postérieure n'est supprimée que si déclarée `null`). Si Dexie proteste, recopier les `stores` de la dernière version d'`AppDatabase`.

- [x] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run src/db/reloadOnVersionChange`
Expected: FAIL, module introuvable.

- [x] **Step 3: Implémenter**

```ts
// apps/web/src/db/reloadOnVersionChange.ts
import type Dexie from "dexie";

/**
 * Un autre onglet ouvre la base à un schéma plus récent (sous-projet 40) : c'est ce code-ci qui
 * est dépassé. Normalement tous les onglets changent de version ensemble (bandeau
 * « Recharger »), mais Maj+Recharger contourne le Service Worker. On ferme la connexion — sans
 * quoi la mise à niveau de l'autre onglet resterait bloquée — et on recharge.
 */
export function reloadOnVersionChange(database: Dexie, reload: () => void): void {
  database.on("versionchange", () => {
    database.close();
    reload();
    return false;
  });
}
```

`apps/web/src/main.tsx`, à côté de `reloadOnControllerChange` :

```ts
import { db } from "@/db/schema";
import { reloadOnVersionChange } from "@/db/reloadOnVersionChange";
// …
reloadOnVersionChange(db, () => window.location.reload());
```

- [x] **Step 4: Vérifier**

Run: `cd apps/web && npx vitest run src/db`
Expected: PASS, y compris `schema.test.ts` (qui ouvre des bases en versions successives sur d'autres noms).

- [x] **Step 5: Commit**

```bash
git add apps/web/src/db/reloadOnVersionChange.ts apps/web/src/db/reloadOnVersionChange.test.ts apps/web/src/main.tsx docs/plans/2026-09-29-hors-ligne-installable.md
git commit -m "PWA : un onglet dépassé par un schéma plus récent recharge"
```

---

### Task 5: La suite Playwright « serveur coupé »

**Files:**
- Create: `apps/web/e2e-offline/server.ts`, `apps/web/e2e-offline/global-setup.ts`, `apps/web/e2e-offline/offline.spec.ts`, `apps/web/playwright.offline.config.ts`
- Modify: `apps/web/package.json` (script `e2e:offline`), `apps/web/tsconfig.node.json` (include), `.gitignore` si besoin (`apps/web/e2e-offline/.dist/`)

**Interfaces:**
- Consumes: un build de production (tâches 2 à 4).
- Produces: `pnpm --filter web e2e:offline`.

Pourquoi un serveur maison plutôt que `vite preview` : le test doit pouvoir le faire répondre 502, l'arrêter, et publier une seconde version, ce que `vite preview` ne sait pas faire. Il reproduit `nginx.conf` : `assets/` immuables, tout le reste `no-cache`, un fichier absent donne `index.html`, `/api/*` répond du JSON et compte ses appels. Il écoute sur le port 0 : aucun port en dur, aucune collision avec les instances de dev.

- [x] **Step 1: Le serveur**

```ts
// apps/web/e2e-offline/server.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { AddressInfo } from "node:net";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export interface StaticServer {
  url: string;
  /** Publie un autre build : la « nouvelle version » d'un déploiement. */
  setRoot(dir: string): void;
  /** `502` : Traefik devant un conteneur arrêté. */
  setMode(mode: "serve" | "502"): void;
  apiHits(): number;
  /** Serveur éteint : plus rien n'écoute. */
  stop(): Promise<void>;
}

export async function startServer(root: string): Promise<StaticServer> {
  let current = root;
  let mode: "serve" | "502" = "serve";
  let hits = 0;
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (mode === "502") {
      res.writeHead(502, { "Content-Type": "text/plain" }).end("Bad Gateway");
      return;
    }
    if (path === "/api" || path.startsWith("/api/")) {
      hits += 1;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" }).end(JSON.stringify({ hits }));
      return;
    }
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    const file = join(current, safe === "/" ? "index.html" : safe);
    const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": cache }).end(body);
    } catch {
      const body = await readFile(join(current, "index.html"));
      res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" }).end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    setRoot: (dir) => void (current = dir),
    setMode: (m) => void (mode = m),
    apiHits: () => hits,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
```

- [x] **Step 2: Le build de la suite**

`global-setup.ts` construit une fois l'application (`vite build --outDir e2e-offline/.dist/a`, sans `tsc -b`, depuis `apps/web`) puis dérive la version « b » : copie de `a` où `sw.js` reçoit une ligne `// e2e: version b` en fin de fichier. Un Service Worker qui diffère d'un octet est une mise à jour pour le navigateur ; c'est tout ce que le test du bandeau vérifie.

```ts
// apps/web/e2e-offline/global-setup.ts
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DIST = join(dirname(fileURLToPath(import.meta.url)), ".dist");

export default function globalSetup() {
  const web = join(DIST, "../..");
  rmSync(DIST, { recursive: true, force: true });
  execFileSync("npx", ["vite", "build", "--outDir", join(DIST, "a"), "--emptyOutDir"], { cwd: web, stdio: "inherit" });
  cpSync(join(DIST, "a"), join(DIST, "b"), { recursive: true });
  appendFileSync(join(DIST, "b", "sw.js"), "\n// e2e: version b\n");
}
```

Ajouter `apps/web/e2e-offline/.dist/` au `.gitignore` racine.

`apps/web/playwright.offline.config.ts` :

```ts
import { defineConfig } from "@playwright/test";

/**
 * Le Service Worker contre un vrai build de production (sous-projet 40). À part des e2e
 * existants, qui tournent sur `pnpm dev` et Django : ici ni Vite en mode dev, ni Django. Chaque
 * test démarre son propre serveur (e2e-offline/server.ts) sur un port libre, donc une origine
 * neuve et un Service Worker neuf. Pas dans `pnpm check`.
 */
export default defineConfig({
  testDir: "./e2e-offline",
  globalSetup: "./e2e-offline/global-setup.ts",
  workers: 1,
  timeout: 60_000,
  use: { browserName: "chromium" },
});
```

`apps/web/package.json` : `"e2e:offline": "playwright test -c playwright.offline.config.ts"`. `tsconfig.node.json` : ajouter `"playwright.offline.config.ts"` et `"e2e-offline/**/*.ts"` à `include` (vérifier comment `e2e/` est typé aujourd'hui et faire de même si c'est ailleurs).

- [x] **Step 3: Les tests**

```ts
// apps/web/e2e-offline/offline.spec.ts
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { DIST } from "./global-setup";
import { startServer, type StaticServer } from "./server";

let server: StaticServer;
test.beforeEach(async () => {
  server = await startServer(join(DIST, "a"));
});
test.afterEach(async () => {
  await server.stop().catch(() => {});
});

async function waitForControl(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function createAccount(page: Page) {
  await page.goto(`${server.url}/accounts`);
  await waitForControl(page);
  await page.getByLabel("Nom").fill("Alpha");
  await page.getByLabel("Identifiant de compte IB").fill("U1234567");
  await page.getByRole("button", { name: "Ajouter ce compte" }).click();
  await page.waitForURL(/\/accounts\/alpha\/sources$/);
}
```

Les libellés du formulaire sont ceux d'`AccountsPage.test.tsx` en français : vérifier que le navigateur de test est en français (`use: { locale: "fr-FR" }` dans la config si la langue suit le navigateur) ou lire la langue par défaut dans `src/i18n/index.ts` et adapter.

Cas à écrire, chacun un `test(...)` :

1. **Serveur arrêté, route profonde** — `createAccount(page)` ; `await server.stop()` ; `page.goto(`${server.url}/accounts/alpha/history`)` ; attendre le nom du compte « Alpha » dans la coquille et le titre de la page Historique. Puis `page.goto(`${server.url}/login`)` et `/invitation/abc` : la page de l'application s'affiche (un élément propre à chacune), jamais une page d'erreur du navigateur.
2. **502** — `createAccount(page)` ; `server.setMode("502")` ; `page.reload()` ; la page Sources du compte s'affiche.
3. **`/api` jamais en cache** — `createAccount(page)` ; `const first = await page.evaluate(() => fetch("/api/ping").then((r) => r.json()))` ; `await server.stop()` ; `await expect(page.evaluate(() => fetch("/api/ping").then((r) => r.json()))).rejects.toThrow()` ; et `page.goto(`${server.url}/api/ping`)` rejette (ERR_CONNECTION_REFUSED), jamais `index.html`.
4. **Bandeau et deux onglets** — dans un même `context`, deux pages sur `${server.url}/accounts`, toutes deux contrôlées (la seconde : recharger une fois si `controller` est nul) ; marquer chacune `window.__e2eMark = 1` ; `server.setRoot(join(DIST, "b"))` ; déclencher la vérification dans la première : `page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r!.update()))` ; attendre `getByRole("status")` « Nouvelle version disponible » dans les deux pages ; cliquer « Recharger » dans la première ; attendre dans **chacune** que `window.__e2eMark` soit `undefined` (rechargée) et que le bandeau ait disparu.
5. **Première installation sans rechargement** — page neuve sur `${server.url}/accounts`, `window.__e2eMark = 1` posé aussitôt après `domcontentloaded` ; attendre `waitForControl` ; `__e2eMark` vaut toujours 1.

- [x] **Step 4: Lancer**

Run: `pnpm --filter web e2e:offline`
Expected: 5 tests PASS. Un échec du cas 4 sur l'apparition du bandeau dans la seconde page : vérifier que `useRegisterSW` écoute bien l'état `waiting` d'une mise à jour trouvée par un autre onglet (workbox-window `waiting` avec `isExternal`) ; sinon, déclencher `update()` aussi dans la seconde page — le test doit prouver que les **deux** onglets rechargent après **un** clic, pas que les deux trouvent la mise à jour seuls.

- [x] **Step 5: Commit**

```bash
git add apps/web/e2e-offline apps/web/playwright.offline.config.ts apps/web/package.json apps/web/tsconfig.node.json .gitignore docs/plans/2026-09-29-hors-ligne-installable.md
git commit -m "PWA : suite Playwright serveur coupé, 502, mise à jour sur deux onglets"
```

---

### Task 6: L'Aide, la documentation, la vérification

**Files:**
- Modify: `apps/web/src/pages/HelpPage.tsx`, `apps/web/src/pages/HelpPage.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Modify: `CLAUDE.md`, `docs/deploiement-vps.md`, `docs/specs/2026-09-29-hors-ligne-installable-design.md`

- [x] **Step 1: Test qui échoue**

Dans `HelpPage.test.tsx`, suivant le style des tests existants du fichier :

```tsx
it("explique l'installation et l'ouverture serveur en maintenance", () => {
  renderHelp(); // l'aide de rendu existante du fichier
  expect(screen.getByRole("heading", { name: "Installer l'application, travailler serveur coupé" })).toBeInTheDocument();
  expect(screen.getByText(/s'ouvre encore quand le serveur est en maintenance/)).toBeInTheDocument();
  expect(screen.getByText(/Sur l'écran d'accueil/)).toBeInTheDocument();
});
```

Run: `cd apps/web && npx vitest run src/pages/HelpPage` → FAIL.

- [x] **Step 2: La section**

`fr.json`, sous `help` :

```json
"offline": {
  "title": "Installer l'application, travailler serveur coupé",
  "items": [
    "L'application s'installe par le menu du navigateur : « Installer l'application » dans Chrome et Edge, Partager → « Sur l'écran d'accueil » dans Safari sur iPhone. Elle s'ouvre alors dans sa propre fenêtre et retrouve les mêmes données que l'onglet.",
    "Un navigateur qui a déjà ouvert le site l'ouvre encore quand le serveur est en maintenance : vos données sont dans ce navigateur. Seules la synchro Flex relayée par le serveur et la sauvegarde attendent son retour.",
    "Quand une nouvelle version est publiée, un bandeau propose de recharger ; tous les onglets passent ensemble à la nouvelle version."
  ]
}
```

`en.json` :

```json
"offline": {
  "title": "Install the app, work with the server down",
  "items": [
    "Install the app from the browser menu: \"Install app\" in Chrome and Edge, Share → \"Add to Home Screen\" in Safari on iPhone. It then opens in its own window and sees the same data as the tab.",
    "A browser that has opened the site before still opens it while the server is under maintenance: your data lives in this browser. Only the Flex sync relayed by the server and the backup wait for it to come back.",
    "When a new version is published, a banner offers to reload; every tab switches to the new version together."
  ]
}
```

`HelpPage.tsx` : une `<Section title={t("help.offline.title")}>` avec une liste des `items` (même rendu que `help.app.tiers`), placée **après** la section `help.app` et avant les modes. Si le test d'Aide vérifie l'ordre ou le nombre des sections, l'adapter.

Run: `cd apps/web && npx vitest run src/pages/HelpPage` → PASS.

- [x] **Step 3: Documentation**

- `CLAUDE.md`, section « Règles qui mordent », après la règle « Paramètres et Aide s'atteignent sans aucun compte » :

  > - **Le Service Worker ne met en cache que l'enveloppe de l'application** (sous-projet 40) : `vite-plugin-pwa`, `generateSW`, options dans `apps/web/pwa.config.ts` seul. Tout le build est pré-caché sauf `agent/**`, toute navigation reçoit `index.html` sauf `SERVER_PREFIXES` (`/api`, `/_allauth`, `/static`, `/admin`, `/agent`), et **aucun `runtimeCaching`** : aucune réponse du serveur ni de l'agent ne passe par un cache. Une nouvelle version attend le clic du bandeau (`src/pwa/UpdateBanner.tsx`), puis chaque onglet recharge (`reloadOnControllerChange`, `main.tsx`), jamais celui de la première installation ; un onglet dépassé par un schéma Dexie plus récent recharge (`db/reloadOnVersionChange.ts`). Seul `src/pwa/` importe `virtual:pwa-register`. Désactivé en `pnpm dev` ; `pnpm --filter web e2e:offline` le teste contre un vrai build. `sw.js` n'est jamais mis en cache par nginx : c'est ce qui permet de remplacer un Service Worker cassé.

- `CLAUDE.md`, registre : ajouter `| 40 | L'application s'ouvre serveur coupé, et s'installe | fait (<date>) |`.
- `CLAUDE.md`, Outillage : une phrase sur `pnpm --filter web e2e:offline` (build de production, serveur Node sur port libre, sans Django) et sur `apps/web/scripts/render-icons.mjs`.
- `docs/deploiement-vps.md` : une courte section « Service Worker » — une maintenance n'empêche pas les navigateurs déjà venus d'ouvrir l'application ; un Service Worker cassé se remplace en déployant une version corrigée (`sw.js` en `no-cache`) ; en dernier recours, publier une version avec `selfDestroying: true` dans `pwa.config.ts`, qui désinstalle le Service Worker chez chaque visiteur à sa visite suivante.
- La spec : statut « implémenté (<date>) » ; §5, remplacer « fond `#0e9f90` plein cadre » par « le dégradé du logo plein cadre » (ce que fait le script de la tâche 1).

- [x] **Step 4: Vérification complète**

Run: `pnpm check`
Expected: lint, typage, build, tous les tests verts.

Run: `pnpm --filter web e2e:offline`
Expected: 5 PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/pages/HelpPage.tsx apps/web/src/pages/HelpPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json CLAUDE.md docs/deploiement-vps.md docs/specs/2026-09-29-hors-ligne-installable-design.md docs/plans/2026-09-29-hors-ligne-installable.md
git commit -m "PWA : l'Aide explique l'installation et le serveur coupé ; règles et exploitation"
```

- [ ] **Step 6: Instance de relecture**

Run: `pnpm dev:start` dans le worktree, puis donner les deux URL à Seb. Rappel pour lui : en `pnpm dev`, le Service Worker est éteint ; pour l'essayer à la main, `pnpm --filter web build && npx vite preview` depuis `apps/web` du worktree (port affiché par Vite), puis arrêter `vite preview` et recharger.
