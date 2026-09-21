import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteBackup, fetchBackupStatus, getBackup, putBackup } from "./backup";
import { bytesOf } from "../test/bytes";

describe("backup client", () => {
  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  describe("putBackup", () => {
    it("envoie les octets bruts, jamais du JSON", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 3 }), { status: 200 }),
      );

      const result = await putBackup(new Uint8Array([1, 2, 3]));

      expect(result).toEqual({ ok: true, value: { updatedAt: "2026-09-21T10:00:00Z", bytes: 3 } });
      const [, init] = fetchSpy.mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({ "content-type": "application/octet-stream" });
    });

    it("distingue le plafond dépassé d'un échec quelconque", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 413 }));
      expect(await putBackup(new Uint8Array([1]))).toEqual({ ok: false, kind: "too-large" });
    });

    it("un serveur injoignable n'est jamais une exception", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
      expect(await putBackup(new Uint8Array([1]))).toEqual({ ok: false, kind: "unreachable" });
    });

    // Not in the brief: the brief's own header-spreading order (`...headers, ...init`) lets
    // `init.headers` — set by `putBackup` for the raw-bytes content-type — clobber the whole
    // merged headers object and silently drop X-CSRFToken. Django would then answer every
    // POST/DELETE with a 403, and a test that only inspects the mocked Response (as the brief's
    // other tests do) would never notice: the request never really reaches a CSRF check here.
    // This is the one assertion that catches that class of bug, by reading what `call()` actually
    // built for a request that carries both concerns at once.
    it("porte le jeton CSRF ET le content-type sur un dépôt", async () => {
      document.cookie = "csrftoken=abc123";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 1 }), { status: 200 }),
      );

      await putBackup(new Uint8Array([1]));

      const [, init] = fetchSpy.mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({
        "content-type": "application/octet-stream",
        "X-CSRFToken": "abc123",
      });
    });

    // Ronde de correction 1 (critique) : un intermédiaire — proxy, portail captif, page
    // d'erreur d'infrastructure — peut répondre 200 avec un corps qui n'est pas du JSON.
    // `answer.json()` rejette alors ; cette exception ne doit jamais sortir de `putBackup`.
    it("un corps illisible sur un 200 ne sort jamais en exception", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      );
      await expect(putBackup(new Uint8Array([1]))).resolves.toEqual({ ok: false, kind: "failed" });
    });

    // Ronde de correction 1 (important) : un 200 sans les champs attendus n'est pas une
    // confirmation à demi — `updatedAt`/`bytes` ne doivent jamais être fabriqués depuis le
    // blob local (une date vide, une taille devinée). Django rend toujours ces champs
    // aujourd'hui ; le code doit dire la vérité si cela changeait.
    it("ne fabrique jamais updatedAt ni bytes quand le corps ne les porte pas", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ present: true }), { status: 200 }),
      );
      expect(await putBackup(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, kind: "failed" });
    });
  });

  describe("getBackup", () => {
    it("rend les octets tels quels", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([7, 8]), { status: 200 }));
      const result = await getBackup();
      expect(result.ok).toBe(true);
      expect(result.ok && bytesOf(result.value)).toEqual(bytesOf(new Uint8Array([7, 8])));
    });

    it("une sauvegarde absente n'est pas un échec", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
      expect(await getBackup()).toEqual({ ok: false, kind: "missing" });
    });

    // Ronde de correction 1 (critique) : une connexion coupée pendant le téléchargement d'une
    // sauvegarde de plusieurs mégaoctets fait rejeter `arrayBuffer()`. Cette exception ne doit
    // jamais sortir de `getBackup` — le serveur est optionnel, son indisponibilité sous toutes
    // ses formes (corps illisible compris) est un état que le client rend, jamais une exception
    // qui traverse l'application.
    it("un flux binaire interrompu ne sort jamais en exception", async () => {
      const brokenResponse = {
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.reject(new Error("stream aborted")),
      } as unknown as Response;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(brokenResponse);
      await expect(getBackup()).resolves.toEqual({ ok: false, kind: "failed" });
    });
  });

  describe("deleteBackup", () => {
    it("porte le jeton CSRF", async () => {
      document.cookie = "csrftoken=xyz789";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ present: false, updatedAt: null, bytes: null }), { status: 200 }),
      );

      const result = await deleteBackup();

      expect(result).toEqual({ ok: true, value: undefined });
      const [, init] = fetchSpy.mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({ "X-CSRFToken": "xyz789" });
    });
  });

  describe("fetchBackupStatus", () => {
    it("rend la présence, la date et la taille", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 42 }), { status: 200 }),
      );
      expect(await fetchBackupStatus()).toEqual({
        ok: true,
        value: { present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 42 },
      });
    });

    it("un serveur injoignable n'est jamais une exception", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
      expect(await fetchBackupStatus()).toEqual({ ok: false, kind: "unreachable" });
    });

    // django-ninja's SessionAuth raises 401 when `request.user.is_authenticated` is false
    // (ninja/operation.py's `AuthenticationError`, status 401) — this is the actual "not
    // signed in" case.
    it("une session anonyme se distingue d'un échec quelconque", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
      expect(await fetchBackupStatus()).toEqual({ ok: false, kind: "anonymous" });
    });

    // django-ninja's `APIKeyCookie._get_key` raises 403 on a failed CSRF check before
    // authentication even runs, so it can reach a user who is genuinely signed in — a stale
    // token after a long tab, say. Folding it into "anonymous" would tell that user to sign
    // in again when they already are; reloading the page is what actually fixes it, so the
    // two must stay distinct.
    it("un jeton CSRF refusé se distingue d'une session anonyme", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
      expect(await fetchBackupStatus()).toEqual({ ok: false, kind: "csrf" });
    });

    // Ronde de correction 1 (critique) : même garde qu'ailleurs, sur la route de statut.
    it("un corps illisible sur un 200 ne sort jamais en exception", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      );
      await expect(fetchBackupStatus()).resolves.toEqual({ ok: false, kind: "failed" });
    });
  });
});
