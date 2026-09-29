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

/**
 * Reproduit `nginx.conf` (sous-projet 40) : `assets/` immuables, tout le reste `no-cache`, un
 * fichier absent donne `index.html`, `/api/*` répond du JSON et compte ses appels. Écoute sur
 * le port 0 : aucun port en dur, aucune collision avec les instances de dev.
 */
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
      if (path.startsWith("/assets/")) {
        // nginx : `location /assets/` n'a pas de try_files, un fichier absent est un 404.
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
        return;
      }
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
