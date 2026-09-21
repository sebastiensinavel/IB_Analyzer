import { useEffect } from "react";
import { useDb } from "../DbProvider";
import { pushBackup } from "./sync";
import { BACKUP_DEBOUNCE_MS, installBackupTrigger } from "./trigger";

/**
 * Mounted once, beside the router: a deposit follows the writes that count, wherever in the
 * app they happen. Rendered nothing — it is a subscription, not a view.
 */
export function BackupSync() {
  const db = useDb();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const uninstall = installBackupTrigger(db, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void pushBackup(db), BACKUP_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      uninstall();
    };
  }, [db]);
  return null;
}
