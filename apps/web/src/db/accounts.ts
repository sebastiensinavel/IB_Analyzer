import type { FlexRelayMode } from "@/flex/relay";
import { clearLastAccountId, getLastAccountId } from "@/lib/accountStorage";
import type { AccountRecord, AppDatabase } from "./schema";

/** "U1234567", paper "DU1234567". */
export const IB_ACCOUNT_ID_RE = /^[A-Z]{1,2}\d{6,9}$/;

export type AccountErrorCode = "label-empty" | "ib-account-id-invalid" | "slug-taken" | "tws-port-invalid";

export const TWS_PORT_MIN = 1;
export const TWS_PORT_MAX = 65535;

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
    this.name = "AccountError";
  }
}

export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createAccount(
  db: AppDatabase,
  input: { label: string; ibAccountId: string },
): Promise<AccountRecord> {
  const label = input.label.trim();
  const id = slugify(label);
  if (!id) throw new AccountError("label-empty");
  const ibAccountId = input.ibAccountId.trim().toUpperCase();
  if (!IB_ACCOUNT_ID_RE.test(ibAccountId)) throw new AccountError("ib-account-id-invalid");

  const record: AccountRecord = {
    id,
    label,
    ibAccountId,
    createdAt: new Date().toISOString(),
    warnedDroppedKinds: [],
  };
  await db.transaction("rw", db.accounts, async () => {
    if (await db.accounts.get(id)) throw new AccountError("slug-taken");
    await db.accounts.add(record);
  });
  return record;
}

/**
 * A blank field leaves whatever is stored untouched; erasing is `clearFlexCredentials`.
 *
 * An empty field used to mean "clear", which made the Sources form lose a stored token every
 * time someone came back to fix only the query id: the token box is never prefilled — the
 * token is a secret and is never rendered — so it is empty by design on every visit.
 */
export async function setFlexCredentials(
  db: AppDatabase,
  accountId: string,
  input: { token?: string; queryId?: string },
): Promise<void> {
  const token = input.token?.trim();
  const queryId = input.queryId?.trim();
  const changes: Partial<AccountRecord> = {};
  if (token) changes.flexToken = token;
  if (queryId) changes.flexQueryId = queryId;
  if (Object.keys(changes).length === 0) return;
  await db.accounts.update(accountId, changes);
}

/** The only way to remove stored Flex credentials: never a side effect of saving the form. */
export async function clearFlexCredentials(db: AppDatabase, accountId: string): Promise<void> {
  await db.accounts.update(accountId, { flexToken: undefined, flexQueryId: undefined });
}

/** Saved on its own, the moment it changes: it is not part of the credentials form. */
export async function setFlexRelay(db: AppDatabase, accountId: string, relay: FlexRelayMode): Promise<void> {
  await db.accounts.update(accountId, { flexRelay: relay });
}

/** `null` clears the port, which is the one way to stop calling the agent for this account. */
export async function setTwsPort(db: AppDatabase, accountId: string, port: number | null): Promise<void> {
  if (port !== null && (!Number.isInteger(port) || port < TWS_PORT_MIN || port > TWS_PORT_MAX)) {
    throw new AccountError("tws-port-invalid");
  }
  // Clearing the port also clears a stale failure badge: without a port the agent is never
  // called again, so a `lastAgentSyncStatus` left over from before would sit on Positions,
  // Dashboard and History forever ("TWS injoignable" with no TWS even configured any more).
  await db.accounts.update(accountId, port === null ? { twsPort: undefined, lastAgentSyncStatus: undefined } : { twsPort: port });
}

export async function deleteAccount(db: AppDatabase, id: string): Promise<void> {
  // Seven tables: Dexie's varargs overloads stop at five, so the list goes in as an array.
  await db.transaction(
    "rw",
    [db.accounts, db.transactions, db.imports, db.snapshots, db.statements, db.contracts, db.cashPoints],
    async () => {
      await db.transactions.where("accountId").equals(id).delete();
      await db.imports.where("accountId").equals(id).delete();
      await db.snapshots.delete(id);
      await db.statements.where("accountId").equals(id).delete();
      await db.contracts.where("accountId").equals(id).delete();
      await db.cashPoints.where("accountId").equals(id).delete();
      await db.accounts.delete(id);
    },
  );
  if (getLastAccountId() === id) clearLastAccountId();
}
