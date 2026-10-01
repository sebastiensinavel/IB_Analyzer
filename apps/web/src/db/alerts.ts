import { directionFor, INITIAL_STATE, reactivate, type AlertAnchor, type AlertPatch, type AlertState, type ManualAlertDef } from "@ib/alerts";
import type { AlertStateRecord, AppDatabase } from "./schema";

type StatePatch = Partial<Omit<AlertState, "alertId">>;

export async function createManualAlert(
  db: AppDatabase,
  accountId: string,
  input: { ticker: string; price: number; direction: ManualAlertDef["direction"]; note?: string | null },
): Promise<string> {
  const id = `manual:${crypto.randomUUID()}`;
  await db.alerts.add({
    id,
    accountId,
    ticker: input.ticker,
    price: input.price,
    direction: input.direction,
    note: input.note ?? null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function updateManualAlert(
  db: AppDatabase,
  accountId: string,
  id: string,
  patch: Partial<Pick<ManualAlertDef, "price" | "direction" | "note">>,
): Promise<void> {
  await db.transaction("rw", db.alerts, async () => {
    const row = await db.alerts.get(id);
    if (row?.accountId !== accountId) return;
    await db.alerts.update(id, patch);
  });
}

/** Supprime l'alerte et son état, dans une transaction. */
export async function deleteManualAlert(db: AppDatabase, accountId: string, id: string): Promise<void> {
  await db.transaction("rw", [db.alerts, db.alertStates], async () => {
    const row = await db.alerts.get(id);
    if (row?.accountId === accountId) await db.alerts.delete(id);
    await db.alertStates.delete([accountId, id]);
  });
}

/**
 * Réactive une manuelle : son état revient à zéro et, le cours connu, elle se réarme du côté où
 * se trouve son seuil — sans quoi elle se déclencherait aussitôt (spec §3.5). Sans cours, la
 * direction reste celle qu'elle avait. Une seule transaction pour les deux écritures.
 */
export async function reactivateManualAlert(
  db: AppDatabase,
  accountId: string,
  id: string,
  currentPrice: number | null,
): Promise<void> {
  await db.transaction("rw", [db.alerts, db.alertStates], async () => {
    const { patch } = reactivate(id);
    await mergeState(db, accountId, id, patch);
    const row = await db.alerts.get(id);
    if (currentPrice === null || row?.accountId !== accountId) return;
    await db.alerts.update(id, { direction: directionFor(row.price, currentPrice) });
  });
}

/** Fusionne chaque patch dans l'état de son alerte, créé depuis `INITIAL_STATE` s'il manque. */
export async function patchAlertStates(db: AppDatabase, accountId: string, patches: readonly AlertPatch[]): Promise<void> {
  if (patches.length === 0) return;
  await db.transaction("rw", db.alertStates, async () => {
    for (const { alertId, patch } of patches) await mergeState(db, accountId, alertId, patch);
  });
}

/** Pose S₀ une seule fois : une ancre déjà écrite n'est jamais réécrite. */
export async function setAlertAnchor(db: AppDatabase, accountId: string, alertId: string, anchor: AlertAnchor): Promise<void> {
  await db.transaction("rw", db.alertStates, async () => {
    const current = await db.alertStates.get([accountId, alertId]);
    if (current?.anchor) return;
    await mergeState(db, accountId, alertId, { anchor });
  });
}

export async function setAlertOverride(db: AppDatabase, accountId: string, alertId: string, value: number | null): Promise<void> {
  await patchAlertStates(db, accountId, [{ alertId, patch: { override: value } }]);
}

export async function deleteAlertStates(db: AppDatabase, accountId: string, ids: readonly string[]): Promise<void> {
  await db.alertStates.bulkDelete(ids.map((id): [string, string] => [accountId, id]));
}

async function mergeState(db: AppDatabase, accountId: string, alertId: string, patch: StatePatch): Promise<void> {
  const current = await db.alertStates.get([accountId, alertId]);
  const next: AlertStateRecord = { ...INITIAL_STATE, ...current, ...patch, accountId, alertId };
  await db.alertStates.put(next);
}
