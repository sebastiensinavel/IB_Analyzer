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
    // Le bundle principal pèse ~2,2 Mio, au-dessus des 2 Mio par défaut : un fichier ignoré
    // serait absent serveur coupé, et le build échoue plutôt que de le taire.
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    navigateFallback: "index.html",
    navigateFallbackDenylist: SERVER_PREFIXES.map((p) => new RegExp(`^${escape(p)}(/|$)`)),
    // Première installation : l'onglet passe sous contrôle sans rechargement. Une mise à jour,
    // elle, n'est activée que par le SKIP_WAITING du bandeau.
    clientsClaim: true,
    cleanupOutdatedCaches: true,
  },
};
