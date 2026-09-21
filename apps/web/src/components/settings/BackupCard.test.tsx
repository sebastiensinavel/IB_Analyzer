import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useSession } from "@/api/session";
import { createAccount } from "@/db/accounts";
import { AppDatabase, db } from "@/db/schema";
import { DbProvider } from "@/db/DbProvider";
import { enableBackup, readBackupState } from "@/db/backup/state";
import { pushBackup } from "@/db/backup/sync";
import { encodePayload, encryptBlob, generateBackupKey, gzip, toRecoveryCode } from "@/db/backup/crypto";
import { buildPayload } from "@/db/backup/payload";
import { formatDateTime } from "@/lib/format";
import { bytesOf } from "@/test/bytes";
import { BackupCard } from "./BackupCard";

// `useSession` is mocked rather than wrapped in a real `SessionProvider`: the card's server
// buttons must react to every one of the three idle states (`authenticated`, `anonymous`,
// `unreachable`), and a mock lets each test pick the one it needs without a live fetch.
vi.mock("@/api/session", () => ({ useSession: vi.fn() }));

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <DbProvider>
        <BackupCard />
      </DbProvider>
    </I18nextProvider>,
  );
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
});

describe("BackupCard", () => {
  it("part désactivée et le dit", async () => {
    renderCard();
    expect(await screen.findByText(i18n.t("settings.backupDisabled"))).toBeInTheDocument();
  });

  it("montre le code de récupération une seule fois à l'activation", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));

    await waitFor(async () => expect((await readBackupState(db))?.enabled).toBe(true));
    expect(screen.getByText(i18n.t("settings.backupRecoveryHint"))).toBeInTheDocument();
  });

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
  });

  it("restaurer nomme la date de ce qui va être écrasé, et remplace au lieu de fusionner", async () => {
    // Seed a server-side backup: enable, write a marker account, push it through the real
    // pipeline so the deposited bytes are genuinely readable back by this card's own key.
    const state = await enableBackup(db);
    await createAccount(db, { label: "OnServer", ibAccountId: "U1112223" });
    let deposited = new Uint8Array();
    const updatedAt = "2026-09-21T10:00:00Z";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if ((init as RequestInit | undefined)?.method === "POST") {
        deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
        return new Response(JSON.stringify({ present: true, updatedAt, bytes: deposited.byteLength }), { status: 200 });
      }
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify({ present: true, updatedAt, bytes: deposited.byteLength }), { status: 200 });
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
  });

  it("restaurer n'écrit rien si l'utilisateur refuse la confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await createAccount(db, { label: "Untouched", ibAccountId: "U5556667" });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["untouched"]);
  });

  it("demande le code de récupération sur un appareil sans clé locale, jamais sur l'appareil habituel", async () => {
    // A server backup encrypted by a key this browser has never seen: the "new device" case.
    const foreignKey = generateBackupKey();
    const seed = new AppDatabase(`test-${crypto.randomUUID()}`);
    await createAccount(seed, { label: "FromAnotherDevice", ibAccountId: "U4445556" });
    const payload = await buildPayload(seed);
    const blob = await encryptBlob(foreignKey, await gzip(encodePayload(payload)));
    const updatedAt = "2026-09-21T09:00:00Z";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify({ present: true, updatedAt, bytes: blob.byteLength }), { status: 200 });
      }
      return new Response(blob as BodyInit, { status: 200 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(toRecoveryCode(foreignKey));
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupRestore") }));

    await waitFor(async () => {
      const ids = (await db.accounts.toArray()).map((a) => a.id);
      expect(ids).toEqual(["fromanotherdevice"]);
    });
    expect(promptSpy).toHaveBeenCalledWith(i18n.t("settings.backupRecoveryPrompt"));
    expect(bytesOf((await readBackupState(db))!.key)).toEqual(bytesOf(foreignKey));
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

  it("exporter construit un blob téléchargeable, même sans compte", async () => {
    vi.mocked(useSession).mockReturnValue({ status: "anonymous" });
    await createAccount(db, { label: "ForExport", ibAccountId: "U6667778" });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupExport") }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
