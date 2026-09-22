import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useSession } from "@/api/session";
import { createAccount } from "@/db/accounts";
import { AppDatabase, db } from "@/db/schema";
import { DbProvider } from "@/db/DbProvider";
import { enableBackup, readBackupState, recordBackup } from "@/db/backup/state";
import { pushBackup } from "@/db/backup/sync";
import { encodePayload, encryptBlob, generateBackupKey, gzip, packBlob, wrapKey } from "@/db/backup/crypto";
import { buildPayload } from "@/db/backup/payload";
import { formatBytes, formatDateTime } from "@/lib/format";
import { bytesOf } from "@/test/bytes";
import { BackupCard } from "./BackupCard";

// `useSession` is mocked rather than wrapped in a real `SessionProvider`: the card's server
// buttons must react to every one of the three idle states (`authenticated`, `anonymous`,
// `unreachable`), and a mock lets each test pick the one it needs without a live fetch.
vi.mock("@/api/session", () => ({ useSession: vi.fn() }));

const PHRASE = "une phrase de passe";

// Argon2id coûte quelques secondes par dérivation (`crypto.ts`) : tout test qui active,
// change ou restaure par phrase en fait une ou deux, très au-delà des 5 000 ms par défaut
// de vitest et des 1 000 ms par défaut de `waitFor`.
const SLOW = { timeout: 30_000 };
const DERIVING = 15_000;

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <DbProvider>
        <BackupCard />
      </DbProvider>
    </I18nextProvider>,
  );
}

/** Remplit le formulaire en ligne : la phrase, puis sa confirmation — la même par défaut. */
async function fillPassphrase(passphrase: string, confirm = passphrase) {
  await userEvent.type(screen.getByLabelText(i18n.t("settings.backupPassphrase")), passphrase);
  await userEvent.type(screen.getByLabelText(i18n.t("settings.backupPassphraseConfirm")), confirm);
}

/**
 * Un dépôt venu d'un autre navigateur : chiffré par une clé que celui-ci n'a jamais vue, et
 * coiffé de l'en-tête que `pullBackup` lit avant d'ouvrir quoi que ce soit.
 */
async function foreignDeposit(
  key: Uint8Array<ArrayBuffer>,
  label: string,
  ibAccountId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const seed = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(seed, { label, ibAccountId });
  const body = await encryptBlob(key, await gzip(encodePayload(await buildPayload(seed))));
  return packBlob(await wrapKey(key, PHRASE), body);
}

function serveBlob(blob: Uint8Array, updatedAt = "2026-09-21T09:00:00Z") {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/status")) {
      return new Response(JSON.stringify({ present: true, updatedAt, bytes: blob.byteLength }), { status: 200 });
    }
    return new Response(blob as BodyInit, { status: 200 });
  });
}

beforeEach(async () => {
  vi.mocked(useSession).mockReturnValue({ status: "authenticated", user: { id: "9", email: "a@b.c" } });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ present: false, updatedAt: null, bytes: null }), { status: 200 }),
  );
  // The singleton the provider serves, not a second connection to the same database name
  // (see task-11-brief.md's own example, corrected before dispatch): two `AppDatabase`
  // instances open on "ib-analyzer" would race Dexie's writes against this component's.
  await db.backup.clear();
  await db.accounts.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  // `vi.restoreAllMocks()` does not touch `vi.stubGlobal` — a test that stubs `URL` (to spy
  // on `createObjectURL`) left a plain object standing in place of the real `URL` class for
  // every test after it, which broke jsdom's own cookie handling (`new URL(...)` inside
  // tough-cookie) the moment a later test's `deleteBackup()` read `document.cookie`.
  vi.unstubAllGlobals();
});

describe("BackupCard", () => {
  it("part désactivée et le dit", async () => {
    renderCard();
    expect(await screen.findByText(i18n.t("settings.backupDisabled"))).toBeInTheDocument();
  });

  it("demande la phrase deux fois à l'activation, et n'écrit rien avant", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));

    expect(screen.getByLabelText(i18n.t("settings.backupPassphrase"))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t("settings.backupPassphraseConfirm"))).toBeInTheDocument();
    expect(await db.backup.count()).toBe(0);
  });

  it("refuse une confirmation qui diffère", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));
    await fillPassphrase(PHRASE, "une autre phrase");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("settings.backupPassphraseMismatch"));
    expect(await db.backup.count()).toBe(0);
  });

  it("refuse une phrase de moins de douze caractères", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));
    await fillPassphrase("court");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("settings.backupPassphraseTooShort"));
    expect(await db.backup.count()).toBe(0);
  });

  // Un formulaire ouvert gèle les autres boutons de la carte. Sans cela, ouvrir « Activer »
  // puis cliquer « Restaurer » partait par le chemin de la clé locale sur une ligne que
  // `disableBackup` a laissée en place, et valider ensuite réenveloppait la clé pendant que le
  // serveur porte encore l'ancienne enveloppe — la situation même dont `backupChangePending`
  // est la promesse (spec §5), sans l'avertissement, qui ne se rend qu'en mode `change`.
  it("gèle les autres boutons de la carte tant qu'un formulaire est ouvert", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));

    expect(screen.getByRole("button", { name: i18n.t("settings.backupEnable") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupRestore") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupDelete") })).toBeDisabled();
    // Les siens, eux, lisent `busy` seul et restent utilisables ; l'export et l'import de
    // fichier aussi, qui n'ont jamais rien à voir avec le serveur.
    expect(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") })).toBeEnabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupCancel") })).toBeEnabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupExport") })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupCancel") }));
    expect(screen.getByRole("button", { name: i18n.t("settings.backupRestore") })).toBeEnabled();
  });

  // « Les deux phrases ne correspondent pas » survivrait aux deux champs dont elle parle,
  // sans plus rien à désigner : `openForm` efface à l'entrée, refermer doit effacer à la sortie.
  it("annuler emporte le message que le formulaire a produit", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));
    await fillPassphrase(PHRASE, "une autre phrase");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupCancel") }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t("settings.backupPassphrase"))).not.toBeInTheDocument();
  });

  // Le code de récupération a disparu : l'activation n'a plus rien à montrer une seule fois,
  // donc plus rien à perdre si l'utilisateur recharge la page juste après.
  it(
    "active et n'affiche plus aucun code de récupération",
    SLOW,
    async () => {
      renderCard();
      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));
      await fillPassphrase(PHRASE);
      await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

      await waitFor(async () => expect(await db.backup.count()).toBe(1), { timeout: DERIVING });
      expect(screen.queryByText(/code de récupération/i)).not.toBeInTheDocument();
      // Le formulaire se referme de lui-même : rien ne reste à faire une fois la clé enveloppée.
      expect(screen.queryByLabelText(i18n.t("settings.backupPassphrase"))).not.toBeInTheDocument();
    },
  );

  // `rewrapBackupKey` refuse une ligne absente, jamais une ligne désactivée : la garde est ici.
  it("ne propose de changer la phrase que lorsque la sauvegarde est active", async () => {
    renderCard();
    expect(await screen.findByText(i18n.t("settings.backupDisabled"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: i18n.t("settings.backupChangePassphrase") }),
    ).not.toBeInTheDocument();
  });

  // Changer de phrase réenveloppe quarante-huit octets ; la clé qui chiffre les vingt
  // mégaoctets ne bouge pas, sans quoi le blob déjà déposé deviendrait illisible.
  it(
    "change la phrase sans changer la clé",
    SLOW,
    async () => {
      const before = await enableBackup(db, "ancienne phrase");
      renderCard();

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupChangePassphrase") }));
      await fillPassphrase("nouvelle phrase longue");
      await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

      await waitFor(
        async () => {
          const row = await readBackupState(db);
          expect(bytesOf(row!.wrap.wrapped)).not.toEqual(bytesOf(before.wrap.wrapped));
        },
        { timeout: DERIVING },
      );
      expect(bytesOf((await readBackupState(db))!.key)).toEqual(bytesOf(before.key));
    },
  );

  it("propose l'export local même sans compte", async () => {
    renderCard();
    expect(await screen.findByRole("button", { name: i18n.t("settings.backupExport") })).toBeEnabled();
  });

  // The three tests above all mock an authenticated session, so none of them actually
  // exercises "sans compte" despite the third one's name. This one does: a genuinely
  // anonymous session must grey every server button while leaving the two file buttons alone.
  it("grise les boutons serveur hors connexion, jamais l'export ni l'import", async () => {
    vi.mocked(useSession).mockReturnValue({ status: "anonymous" });
    renderCard();

    expect(await screen.findByText(i18n.t("settings.backupSignedOutHint"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupEnable") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupRestore") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupDelete") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupExport") })).toBeEnabled();
    expect(screen.getByLabelText(i18n.t("settings.backupImport"))).toBeEnabled();
  });

  it("un serveur injoignable grise les boutons serveur comme une déconnexion, jamais l'export ni l'import", async () => {
    vi.mocked(useSession).mockReturnValue({ status: "unreachable" });
    renderCard();

    expect(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.backupExport") })).toBeEnabled();
    // Greying the buttons was all this test asserted; the sentence beside them told an
    // unreachable server's user to sign in, which is precisely what they cannot do.
    expect(screen.getByText(i18n.t("auth.serverUnreachable"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("settings.backupSignedOutHint"))).not.toBeInTheDocument();
  });

  it(
    "restaurer nomme la date de ce qui va être écrasé, et remplace au lieu de fusionner",
    SLOW,
    async () => {
      // Seed a server-side backup: enable, write a marker account, push it through the real
      // pipeline so the deposited bytes are genuinely readable back by this card's own key.
      const state = await enableBackup(db, PHRASE);
      await createAccount(db, { label: "OnServer", ibAccountId: "U1112223" });
      let deposited = new Uint8Array();
      const updatedAt = "2026-09-21T10:00:00Z";
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if ((init as RequestInit | undefined)?.method === "POST") {
          deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
          return new Response(JSON.stringify({ present: true, updatedAt, bytes: deposited.byteLength }), {
            status: 200,
          });
        }
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({ present: true, updatedAt, bytes: deposited.byteLength }), {
            status: 200,
          });
        }
        return new Response(deposited as BodyInit, { status: 200 });
      });
      await pushBackup(db);

      // Diverge locally after the deposit: this account exists only in this browser, never
      // reached the server. A restore must make it disappear, not keep it beside the server's.
      await createAccount(db, { label: "LocalOnly", ibAccountId: "U9998887" });

      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      renderCard();

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));

      await waitFor(async () => {
        const ids = (await db.accounts.toArray()).map((a) => a.id).sort();
        expect(ids).toEqual(["onserver"]);
      });
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(formatDateTime(updatedAt)));
      expect(state.enabled).toBe(true);
    },
  );

  it("restaurer n'écrit rien si l'utilisateur refuse la confirmation", async () => {
    // A backup really is deposited: without that, the card stops at "aucune sauvegarde" and
    // never reaches the confirmation this test is about.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 128 }), { status: 200 }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await createAccount(db, { label: "Untouched", ibAccountId: "U5556667" });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));
    await userEvent.type(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt")), PHRASE);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["untouched"]);
  });

  // `present: false` is the state of an account that has never deposited. Offering to replace
  // this browser "par la sauvegarde du —" proposes an overwrite by nothing at all.
  it("ne propose pas de restaurer quand le serveur ne porte aucune sauvegarde", async () => {
    await createAccount(db, { label: "Untouched", ibAccountId: "U5556667" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));
    await userEvent.type(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt")), PHRASE);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

    expect(await screen.findByText(i18n.t("settings.backupMissing"))).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["untouched"]);
  });

  // Le navigateur habituel détient la clé : la phrase ne lui sert à rien, et la lui demander
  // serait un rituel sans propriété de sécurité — trois secondes d'Argon2id pour rien.
  it(
    "ne demande rien pour restaurer sur un navigateur qui a la clé",
    SLOW,
    async () => {
      await enableBackup(db, PHRASE);
      renderCard();

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));

      // Le serveur ne porte rien (moquage par défaut) : la carte le dit, ce qui prouve
      // qu'elle est bien allée l'interroger sans passer par le formulaire.
      expect(await screen.findByText(i18n.t("settings.backupMissing"))).toBeInTheDocument();
      expect(screen.queryByLabelText(i18n.t("settings.backupPassphrasePrompt"))).not.toBeInTheDocument();
    },
  );

  it("demande la phrase pour restaurer sur un navigateur qui n'a pas la clé", async () => {
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));

    expect(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt"))).toBeInTheDocument();
    // Restaurer n'est pas choisir : la phrase existe déjà, et la confirmer n'apprend rien.
    expect(screen.queryByLabelText(i18n.t("settings.backupPassphraseConfirm"))).not.toBeInTheDocument();
  });

  it(
    "restaure par la phrase sur un navigateur neuf, et adopte alors la clé et son enveloppe",
    SLOW,
    async () => {
      const foreignKey = generateBackupKey();
      serveBlob(await foreignDeposit(foreignKey, "FromAnotherDevice", "U4445556"));
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderCard();

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));
      await userEvent.type(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt")), PHRASE);
      await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

      await waitFor(
        async () => expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["fromanotherdevice"]),
        { timeout: DERIVING },
      );
      const row = await readBackupState(db);
      expect(bytesOf(row!.key)).toEqual(bytesOf(foreignKey));
      // L'enveloppe suit la clé : sans elle, ce navigateur aurait une clé qu'aucune phrase
      // n'ouvre, et le prochain dépôt écraserait le serveur d'un en-tête impossible à rouvrir.
      expect(row!.wrap.salt).toHaveLength(16);
    },
  );

  // Adopter la clé avant que la restauration ait réussi armerait ce navigateur d'une clé qui
  // n'est peut-être pas la bonne : la prochaine écriture déclenchante rechiffrerait toute la
  // base sous elle et remplacerait l'unique copie du serveur par un blob que plus personne
  // n'ouvre. Un échec doit donc laisser la base exactement comme elle était — ici, sans clé.
  it(
    "une phrase erronée ne remplace jamais la clé en base",
    SLOW,
    async () => {
      serveBlob(await foreignDeposit(generateBackupKey(), "OnServer", "U4445556"));
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await createAccount(db, { label: "LocalOnly", ibAccountId: "U9998887" });
      renderCard();

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));
      await userEvent.type(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt")), "mauvaise phrase");
      await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

      expect(
        await screen.findByText(i18n.t("settings.backupInvalidPassphrase"), {}, { timeout: DERIVING }),
      ).toBeInTheDocument();
      expect(await readBackupState(db)).toBeNull();
      expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["localonly"]);
      // Le formulaire reste ouvert : la phrase est justement ce qui est en cause, et la
      // refermer obligerait à rouvrir tout le chemin pour corriger une faute de frappe.
      expect(screen.getByLabelText(i18n.t("settings.backupPassphrasePrompt"))).toBeInTheDocument();
    },
  );

  // Dire « cette phrase n'ouvre pas la sauvegarde » devant un paquet que cette version ne sait
  // pas lire enverrait l'utilisateur retaper en boucle une phrase qui n'est pas en cause.
  it("distingue un paquet illisible d'une phrase erronée", async () => {
    // Un blob du sous-projet 25 : aucun en-tête, donc aucune magie à reconnaître.
    serveBlob(await encryptBlob(generateBackupKey(), await gzip(encodePayload(await buildPayload(db)))));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));
    await userEvent.type(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt")), PHRASE);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

    expect(await screen.findByText(i18n.t("settings.backupUnreadablePackage"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("settings.backupInvalidPassphrase"))).not.toBeInTheDocument();
    // Ouvert comme pour une phrase erronée : les deux remontent par le même `catch`, et seul
    // le message les distingue.
    expect(screen.getByLabelText(i18n.t("settings.backupPassphrasePrompt"))).toBeInTheDocument();
  });

  it("importer un fichier local nomme sa date, remplace la base et ne parle jamais au serveur", async () => {
    const seed = new AppDatabase(`test-${crypto.randomUUID()}`);
    await createAccount(seed, { label: "FromFile", ibAccountId: "U2223334" });
    const payload = await buildPayload(seed);
    const bytes = await gzip(encodePayload(payload));
    const file = new File([bytes as BlobPart], "backup.json.gz", { type: "application/gzip" });

    await createAccount(db, { label: "LocalBeforeImport", ibAccountId: "U3334445" });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderCard();

    await userEvent.upload(screen.getByLabelText(i18n.t("settings.backupImport")), file);

    await waitFor(async () => {
      const ids = (await db.accounts.toArray()).map((a) => a.id).sort();
      expect(ids).toEqual(["fromfile"]);
    });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(formatDateTime(payload.createdAt)));
    // A local import never reaches the network (spec §6): it is the promise that lets
    // someone use the whole application without ever creating a server account.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // A package from a newer schema would write rows past every migration between the two
  // versions. It is refused by name rather than by the catch-all, because the user can act on
  // it: updating the page is what makes the package readable.
  it("refuse un fichier venu d'un schéma plus récent et le dit, sans toucher à la base", async () => {
    const seed = new AppDatabase(`test-${crypto.randomUUID()}`);
    await createAccount(seed, { label: "FromTheFuture", ibAccountId: "U2223334" });
    const payload = { ...(await buildPayload(seed)), dexie: db.verno + 1 };
    const file = new File([(await gzip(encodePayload(payload))) as BlobPart], "backup.json.gz");
    await createAccount(db, { label: "Untouched", ibAccountId: "U3334445" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();

    await userEvent.upload(screen.getByLabelText(i18n.t("settings.backupImport")), file);

    expect(await screen.findByText(i18n.t("settings.backupTooNew"))).toBeInTheDocument();
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["untouched"]);
  });

  it("exporter construit un blob téléchargeable, même sans compte", async () => {
    vi.mocked(useSession).mockReturnValue({ status: "anonymous" });
    await createAccount(db, { label: "ForExport", ibAccountId: "U6667778" });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupExport") }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    // Firefox cancels a download whose object URL is revoked in the task that clicked the
    // anchor, so the revocation waits for a later one. The task boundary itself is not what
    // jsdom lets a test see; that the URL is eventually released is.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url"));
  });

  it("exporter affiche un message si la construction du blob échoue, plutôt qu'un rejet non géré", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => {
        throw new Error("boom");
      },
      revokeObjectURL: vi.fn(),
    });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupExport") }));

    expect(await screen.findByText(i18n.t("settings.actionFailed"))).toBeInTheDocument();
  });

  // Deleting destroys the server's only copy of the backup, no version and no trash — unlike
  // Restore and Import, which only overwrite this browser's own copy, recomposable from the
  // statements and a resync. It gets the same confirmation friction as those two.
  it(
    "supprimer du serveur demande confirmation — sans date à nommer — et n'efface rien si l'utilisateur refuse",
    SLOW,
    async () => {
      await enableBackup(db, PHRASE);
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderCard();

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupDelete") }));

      expect(confirmSpy).toHaveBeenCalledWith(i18n.t("settings.backupDeleteConfirm"));
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  // A successful server-side deletion must clear this browser's own record of "last
  // deposit" too: the blob it names no longer exists, so leaving it standing would keep the
  // card showing a date for a backup that is gone, until the next deposit happened to
  // overwrite it.
  it(
    "supprimer du serveur réussi efface aussi le dernier dépôt connu de ce navigateur",
    SLOW,
    async () => {
      await enableBackup(db, PHRASE);
      await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const method = (init as RequestInit | undefined)?.method;
        if (method === "DELETE") return new Response(null, { status: 200 });
        return new Response(JSON.stringify({ present: false, updatedAt: null, bytes: null }), { status: 200 });
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderCard();

      expect(
        await screen.findByText(
          i18n.t("settings.backupLast", { date: formatDateTime("2026-09-21T10:00:00.000Z"), size: formatBytes(4096) }),
        ),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupDelete") }));

      await waitFor(async () => expect((await readBackupState(db))?.lastBackupAt).toBeNull());
      expect(await screen.findByText(i18n.t("settings.backupNever"))).toBeInTheDocument();
    },
  );

  // "Dernier dépôt le <date>" on its own reads as "tout va bien". An automatic deposit that
  // has been failing since fires from a timer nobody watches, so the card is the only place
  // that can say so — and it must, beside the date rather than instead of it.
  it(
    "dit qu'un dépôt a échoué, sans effacer la date du dernier qui a réussi",
    SLOW,
    async () => {
      await enableBackup(db, PHRASE);
      await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 413 }));
      await pushBackup(db);
      renderCard();

      expect(
        await screen.findByText(i18n.t("settings.backupLastError", { reason: i18n.t("settings.backupTooLarge") })),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          i18n.t("settings.backupLast", { date: formatDateTime("2026-09-21T10:00:00.000Z"), size: formatBytes(4096) }),
        ),
      ).toBeInTheDocument();
    },
  );

  // Of the card's four network calls, this was the only one whose failure showed nothing:
  // the date silently fell back to "—" and the confirmation carried on as if nothing had
  // gone wrong. A failed status probe must report like every other failure here.
  it("restaurer affiche un message si le statut serveur est injoignable, jamais un silence", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));
    await userEvent.type(await screen.findByLabelText(i18n.t("settings.backupPassphrasePrompt")), PHRASE);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backupConfirm") }));

    expect(await screen.findByText(i18n.t("auth.serverUnreachable"))).toBeInTheDocument();
    // Refermé : le message ne porte pas sur la phrase, donc la redemander serait un
    // contresens. Le message, lui, survit au formulaire qui l'a déclenché.
    expect(screen.queryByLabelText(i18n.t("settings.backupPassphrasePrompt"))).not.toBeInTheDocument();
  });
});
