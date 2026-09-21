import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Separator } from "@ib/ui/separator";
import { useSession } from "@/api/session";
import { deleteBackup, fetchBackupStatus, type BackupFailure } from "@/api/backup";
import { useDb } from "@/db/DbProvider";
import { adoptBackupKey, clearBackupRecord, disableBackup, enableBackup, readBackupState } from "@/db/backup/state";
import { pullBackup, pushBackup } from "@/db/backup/sync";
import { backupFileName, exportToBlob, importFromFile } from "@/db/backup/file";
import { BackupKeyError, decodePayload, fromRecoveryCode, gunzip, toRecoveryCode } from "@/db/backup/crypto";
import { formatBytes, formatDateTime } from "@/lib/format";

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

  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
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

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const row = await enableBackup(db);
      // Shown once, kept only in this component's own state: a reload or a navigation away
      // loses it for good, exactly as the warning below says it will.
      setRecoveryCode(toRecoveryCode(row.key));
    } catch {
      setError(t("settings.actionFailed"));
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
   * The confirmation names the date of what is about to overwrite this browser (spec §7):
   * the server's own `updatedAt`, fetched fresh rather than read from this device's last
   * known deposit, which a brand new device — the very case a recovery code exists for —
   * has none of. On the usual device the key is already on hand and nothing is prompted; on
   * a new one, once only, and kept from then on (spec §7).
   *
   * A failed status probe reports through `failureMessage` and stops there: falling back to
   * "—" and carrying on to the confirmation in silence would make this the only one of the
   * card's four network calls that could fail without telling the user anything. Continuing
   * anyway would also be pointless — `pullBackup` needs the same route `fetchBackupStatus`
   * just failed on, and would fail the same way.
   */
  async function handleRestore() {
    setBusy(true);
    setError(null);
    try {
      const status = await fetchBackupStatus();
      if (!status.ok) {
        setError(failureMessage(status.kind));
        return;
      }
      const date = status.value.updatedAt ? formatDateTime(status.value.updatedAt) : "—";
      if (!window.confirm(t("settings.backupRestoreConfirm", { date }))) return;

      const current = await readBackupState(db);
      let key = current?.key ?? null;
      // A key typed from a recovery code is adopted only once the pull has proved it opens the
      // server's blob. Writing it first would arm this browser with a key that may be a typo
      // away from the real one — a typo inside base64url's own alphabet still decodes to 32
      // valid bytes, so length alone lets nearly all of them through — and the next triggering
      // write would then re-encrypt the whole database under it and replace the server's only
      // copy of the backup, leaving it unreadable by anyone, recovery code included.
      let adopt = false;
      if (!key) {
        const code = window.prompt(t("settings.backupRecoveryPrompt"));
        if (!code) return;
        key = fromRecoveryCode(code);
        adopt = true;
      }

      const result = await pullBackup(db, key);
      if (!result.ok) {
        setError(failureMessage(result.kind));
        return;
      }
      if (adopt) await adoptBackupKey(db, key);
    } catch (error) {
      setError(error instanceof BackupKeyError ? t("settings.backupInvalidCode") : t("settings.actionFailed"));
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
      // dépôt le …" for it past this point would be showing a date for nothing (correction
      // round 1, point 1 — the bug the review caught).
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
      URL.revokeObjectURL(url);
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
    } catch {
      setError(t("settings.actionFailed"));
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
        {!authenticated && <p className="text-xs text-muted-foreground">{t("settings.backupSignedOutHint")}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {!enabled ? (
            <Button size="sm" onClick={() => void handleEnable()} disabled={serverDisabled}>
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
          <Button size="sm" variant="outline" onClick={() => void handleRestore()} disabled={serverDisabled}>
            {t("settings.backupRestore")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void handleDelete()} disabled={serverDisabled}>
            {t("settings.backupDelete")}
          </Button>
        </div>

        {recoveryCode && (
          <div className="flex flex-col gap-1 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("settings.backupRecoveryPrompt")}</p>
            <p className="break-all font-mono text-sm">{recoveryCode}</p>
            <p className="text-xs text-muted-foreground">{t("settings.backupRecoveryHint")}</p>
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
