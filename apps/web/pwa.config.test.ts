import { describe, expect, it } from "vitest";
import { SERVER_PREFIXES, pwaOptions } from "./pwa.config.ts";

const denylist = pwaOptions.workbox!.navigateFallbackDenylist!;
const denied = (path: string) => denylist.some((re) => re.test(path));

describe("pwaOptions", () => {
  it("n'envoie jamais une route du serveur sur index.html", () => {
    for (const path of ["/api/flex/send", "/_allauth/browser/v1/auth/session", "/static/admin/x.css", "/admin/", "/agent/index.json", "/api"]) {
      expect(denied(path), path).toBe(true);
    }
  });

  it("n'envoie jamais une capture de l'accueil sur index.html, même ouverte dans un onglet", () => {
    for (const path of ["/shots/dashboard.light.fr.webp", "/shots/", "/shots"]) {
      expect(denied(path), path).toBe(true);
    }
    expect(denied("/welcome"), "/welcome").toBe(false);
    expect(denied("/shotsx"), "/shotsx").toBe(false);
  });

  it("sert index.html à toute route du SPA, y compris hors compte", () => {
    for (const path of ["/", "/accounts", "/accounts/alpha/positions", "/accounts/alpha/journal/wheel", "/login", "/invitation/abc", "/apiary", "/agents"]) {
      expect(denied(path), path).toBe(false);
    }
  });

  it("couvre exactement les préfixes routés vers Django, la roue de l'agent et les captures", () => {
    expect([...SERVER_PREFIXES].sort()).toEqual(["/_allauth", "/admin", "/agent", "/api", "/shots", "/static"]);
  });

  it("ne pré-cache jamais la roue de l'agent et ne met rien en cache à l'exécution", () => {
    expect(pwaOptions.workbox!.globIgnores).toContain("agent/**");
    expect(pwaOptions.workbox?.globIgnores).toEqual(["agent/**", "shots/**"]);
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
