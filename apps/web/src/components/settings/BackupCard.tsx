import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Separator } from "@ib/ui/separator";
import { useSession } from "@/api/session";
import { deleteBackup, fetchBackupStatus, type BackupFailure } from "@/api/backup";
import { useDb } from "@/db/DbProvider";
import {
  adoptBackupKey,
  clearBackupRecord,
  disableBackup,
  enableBackup,
  readBackupState,
  rewrapBackupKey,
} from "@/db/backup/state";
import { pullBackup, pushBackup, type BackupOpener } from "@/db/backup/sync";
import { backupFileName, exportToBlob, importFromFile } from "@/db/backup/file";
import {
  BackupKeyError,
  BackupPackageError,
  decodePayload,
  gunzip,
  MIN_PASSPHRASE_LENGTH,
} from "@/db/backup/crypto";
import { BackupSchemaError } from "@/db/backup/payload";
import { formatBytes, formatDateTime } from "@/lib/format";

/** Ce que le formulaire en ligne demande : choisir une phrase, en changer, ou en donner une
 *  pour ouvrir la sauvegarde du serveur — seul mode à ne rien faire confirmer. */
type FormMode = "enable" | "restore" | "change";

/**
 * The two file buttons never look at `useSession`: exporting and importing a local file is
 * the promise that founded this sub-project — every part of the app works without ever
 * creating a server account, backup included (spec §6). Only the four buttons that actually
 * talk to Django are gated on `status === "authenticated"`, exactly like the Flex sync card.
 */
export function BackupCard() {
  const { t } = useTranslation();
  const session = useSession();
  const db = useDb();
  const state = useLiveQuery(() => readBackupState(db), [db]);
  const authenticated = session.status === "authenticated";
  const enabled = state?.enabled === true;

  // Le formulaire en ligne, ouvert par le bouton qui en a besoin. `null` tant que rien ne
  // le demande : il prend la place qu'occupait l'encadré du code de récupération.
  const [form, setForm] = useState<{ mode: FormMode; passphrase: string; confirm: string } | null>(null);
  // Always a failure: no code path ever sets a success message, so there is nothing left to
  // distinguish with `{ ok }`. Success shows in the state line itself (the new "Dernier
  // dépôt", the code disappearing, …), never here.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const downloadAnchor = useRef<HTMLAnchorElement>(null);

  function failureMessage(kind: BackupFailure): string {
    switch (kind) {
      case "unreachable":
        return t("auth.serverUnreachable");
      case "anonymous":
        return t("settings.backupSignedOutHint");
      case "csrf":
        return t("settings.backupCsrfExpired");
      case "too-large":
        return t("settings.backupTooLarge");
      case "missing":
        return t("settings.backupMissing");
      case "failed":
        return t("settings.actionFailed");
    }
  }

  /**
   * The two ways of overwriting this browser — the server restore and the local file — fail on
   * the same things, so they read the same exception. A wrong passphrase, a package this
   * version cannot read and a package from a newer schema each have a cause the user can act
   * on; anything else does not.
   *
   * `BackupPackageError` gets its own sentence rather than sharing the passphrase one: telling
   * someone to retype their phrase in front of a corrupt package sends them round in circles
   * over something the phrase has nothing to do with.
   */
  function restoreFailureMessage(error: unknown): string {
    if (error instanceof BackupKeyError) return t("settings.backupInvalidPassphrase");
    if (error instanceof BackupPackageError) return t("settings.backupUnreadablePackage");
    if (error instanceof BackupSchemaError) return t("settings.backupTooNew");
    return t("settings.actionFailed");
  }

  /** Ouvrir un formulaire efface le message de l'essai précédent : le laisser sous des
   *  champs vides le ferait lire comme un verdict sur ce qui n'a pas encore été tapé. */
  function openForm(mode: FormMode) {
    setError(null);
    setForm({ mode, passphrase: "", confirm: "" });
  }

  /** La validation vit ici et pas dans `state.ts` : c'est une règle d'interface, et le moteur
   *  n'a pas à connaître de texte visible. */
  function passphraseProblem(mode: FormMode, passphrase: string, confirm: string): string | null {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) return t("settings.backupPassphraseTooShort");
    if (mode !== "restore" && passphrase !== confirm) return t("settings.backupPassphraseMismatch");
    return null;
  }

  async function handleSubmitForm() {
    if (!form) return;
    const problem = passphraseProblem(form.mode, form.passphrase, form.confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (form.mode === "enable") await enableBackup(db, form.passphrase);
      else if (form.mode === "change") await rewrapBackupKey(db, form.passphrase);
      else await runRestore({ passphrase: form.passphrase });
      setForm(null);
    } catch (error) {
      setError(restoreFailureMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      await disableBackup(db);
    } catch {
      setError(t("settings.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleBackupNow() {
    setBusy(true);
    setError(null);
    try {
      const result = await pushBackup(db);
      if (result && !result.ok) setError(failureMessage(result.kind));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Le navigateur habituel détient la clé : rien ne lui est demandé (spec §5), et lui
   * réclamer sa phrase serait trois secondes d'Argon2id pour une propriété de sécurité
   * qu'il a déjà. Un navigateur neuf n'a que la phrase, et le formulaire s'ouvre avant
   * toute question au serveur.
   */
  async function handleRestore() {
    setBusy(true);
    setError(null);
    try {
      const current = await readBackupState(db);
      if (!current) {
        openForm("restore");
        return;
      }
      await runRestore({ key: current.key });
    } catch (error) {
      setError(restoreFailureMessage(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The confirmation names the date of what is about to overwrite this browser (spec §7):
   * the server's own `updatedAt`, fetched fresh rather than read from this device's last
   * known deposit, which a brand new device — the very case the passphrase exists for — has
   * none of.
   *
   * A failed status probe reports through `failureMessage` and stops there: falling back to
   * "—" and carrying on to the confirmation in silence would make this the only one of the
   * card's four network calls that could fail without telling the user anything. Continuing
   * anyway would also be pointless — `pullBackup` needs the same route `fetchBackupStatus`
   * just failed on, and would fail the same way.
   *
   * La clé et l'enveloppe ne sont adoptées qu'une fois la restauration réussie. Les écrire
   * d'abord armerait ce navigateur d'une clé qui peut n'être pas la bonne, et la prochaine
   * écriture déclenchante rechiffrerait toute la base sous elle, remplaçant l'unique copie
   * du serveur par un blob que plus personne n'ouvre.
   *
   * Ne rattrape rien : ses deux appelants le font, `handleSubmitForm` par son `catch` et
   * `handleRestore` par le sien.
   */
  async function runRestore(opener: BackupOpener) {
    setBusy(true);
    setError(null);
    try {
      const status = await fetchBackupStatus();
      if (!status.ok) {
        setError(failureMessage(status.kind));
        return;
      }
      // Nothing deposited: the confirmation would offer to replace this browser with a backup
      // that does not exist, naming its date as "—". There is nothing to restore, and saying so
      // is the whole answer.
      if (!status.value.present) {
        setError(failureMessage("missing"));
        return;
      }
      const date = status.value.updatedAt ? formatDateTime(status.value.updatedAt) : "—";
      if (!window.confirm(t("settings.backupRestoreConfirm", { date }))) return;

      const result = await pullBackup(db, opener);
      if (!result.ok) {
        setError(failureMessage(result.kind));
        return;
      }
      if (!("key" in opener)) await adoptBackupKey(db, result.value.key, result.value.wrap);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Restoring and importing overwrite this browser's own copy, recomposable from the
   * statements and a resync; a confirmation names the date of what replaces it (spec §7).
   * Deleting destroys the server's only copy — no version, no trash — so it gets the same
   * friction, without a date: there is nothing on this device precise enough to name, only
   * the fact that a deposit exists.
   */
  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      if (!window.confirm(t("settings.backupDeleteConfirm"))) return;
      const result = await deleteBackup();
      if (!result.ok) {
        setError(failureMessage(result.kind));
        return;
      }
      // The blob this browser last recorded a deposit of no longer exists: showing "Dernier
      // dépôt le …" for it past this point would be showing a date for nothing.
      await clearBackupRecord(db);
    } catch {
      setError(t("settings.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportToBlob(db);
      const url = URL.createObjectURL(blob);
      const anchor = downloadAnchor.current;
      if (anchor) {
        anchor.href = url;
        anchor.download = backupFileName(new Date());
        anchor.click();
      }
      // Revoked in a later task, never in the one that clicked: Firefox cancels a download
      // whose object URL is revoked in the same task, and this is the only way to back up for
      // whoever never creates a server account.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError(t("settings.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Both the local import and the server restore share `backupRestoreConfirm`: the file's
   * own `createdAt` — peeked before `importFromFile` re-reads the same File for the real
   * import — plays the role the server's `updatedAt` plays for a restore.
   */
  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const payload = decodePayload(await gunzip(bytes));
      if (!window.confirm(t("settings.backupRestoreConfirm", { date: formatDateTime(payload.createdAt) }))) return;
      await importFromFile(db, file);
    } catch (error) {
      setError(restoreFailureMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const serverDisabled = !authenticated || busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.backup")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!enabled && <p className="text-sm text-muted-foreground">{t("settings.backupDisabled")}</p>}
        {enabled && (
          <p className="text-sm text-muted-foreground">
            {state?.lastBackupAt === null || state?.lastBackupAt === undefined
              ? t("settings.backupNever")
              : t("settings.backupLast", {
                  date: formatDateTime(state.lastBackupAt),
                  size: state.lastBackupBytes === null ? "—" : formatBytes(state.lastBackupBytes),
                })}
          </p>
        )}
        {/* An automatic deposit fires from a timer with nobody watching it: its failure has to
            be told here, or the line above would keep naming an old deposit as if it were the
            current one. Kept out of the `error` alert below, which belongs to the button the
            user has just pressed; this one outlives the render that produced it. */}
        {enabled && state?.lastBackupError != null && (
          <p className="text-sm text-destructive">
            {t("settings.backupLastError", { reason: failureMessage(state.lastBackupError) })}
          </p>
        )}
        {/* "Connectez-vous" is an instruction; it is only true of someone who could. A server
            that does not answer leaves nobody to sign in to, so `unreachable` says that instead
            — the same distinction `failureMessage` already makes for a failed call. */}
        {!authenticated && (
          <p className="text-xs text-muted-foreground">
            {session.status === "unreachable" ? t("auth.serverUnreachable") : t("settings.backupSignedOutHint")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!enabled ? (
            <Button size="sm" onClick={() => openForm("enable")} disabled={serverDisabled}>
              {t("settings.backupEnable")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void handleDisable()} disabled={serverDisabled}>
              {t("settings.backupDisable")}
            </Button>
          )}
          {enabled && (
            <Button size="sm" variant="outline" onClick={() => void handleBackupNow()} disabled={serverDisabled}>
              {t("settings.backupNow")}
            </Button>
          )}
          {/* `rewrapBackupKey` refuse une ligne absente, jamais une ligne désactivée : il n'y a
              pas de phrase à changer tant qu'aucune clé n'est enveloppée, et la garde est ici. */}
          {enabled && (
            <Button size="sm" variant="outline" onClick={() => openForm("change")} disabled={serverDisabled}>
              {t("settings.backupChangePassphrase")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void handleRestore()} disabled={serverDisabled}>
            {t("settings.backupRestore")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void handleDelete()} disabled={serverDisabled}>
            {t("settings.backupDelete")}
          </Button>
        </div>

        {/* En ligne, jamais en boîte de dialogue : `packages/ui` n'a pas de `dialog.tsx`, et
            `window.prompt` ne sait ni masquer la saisie, ni en demander deux. Le `htmlFor` des
            deux libellés est ce qui les rend lisibles — pour un lecteur d'écran comme pour un
            test. */}
        {form && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <label className="text-xs text-muted-foreground" htmlFor="backup-passphrase">
              {form.mode === "restore" ? t("settings.backupPassphrasePrompt") : t("settings.backupPassphrase")}
            </label>
            <Input
              id="backup-passphrase"
              type="password"
              autoComplete="new-password"
              value={form.passphrase}
              onChange={(event) => setForm({ ...form, passphrase: event.target.value })}
            />
            {/* Restaurer n'est pas choisir : la phrase existe déjà, et la faire confirmer
                n'apprendrait rien que le blob du serveur ne dise mieux. */}
            {form.mode !== "restore" && (
              <>
                <label className="text-xs text-muted-foreground" htmlFor="backup-passphrase-confirm">
                  {t("settings.backupPassphraseConfirm")}
                </label>
                <Input
                  id="backup-passphrase-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                />
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("settings.backupPassphraseHint")}</p>
            {form.mode === "change" && (
              <p className="text-xs text-muted-foreground">{t("settings.backupChangePending")}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void handleSubmitForm()} disabled={busy}>
                {busy ? t("settings.backupDeriving") : t("settings.backupConfirm")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setForm(null)} disabled={busy}>
                {t("settings.backupCancel")}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Separator />

        <p className="text-xs text-muted-foreground">{t("settings.backupFileHint")}</p>
        <a ref={downloadAnchor} className="sr-only" aria-hidden="true" download={backupFileName(new Date())} />
        <input
          ref={fileInput}
          type="file"
          accept=".gz,application/gzip"
          aria-label={t("settings.backupImport")}
          className="sr-only"
          disabled={busy}
          onChange={(event) => void handleImportFile(event)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleExport()} disabled={busy}>
            {t("settings.backupExport")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
            {t("settings.backupImport")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
