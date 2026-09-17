import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Button, buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { cn } from "@ib/ui/lib/utils";
import { RadioGroup, RadioGroupItem } from "@ib/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { useSession } from "@/api/session";
import { useAgentPresence, useAgentSync, refreshPresence } from "@/agent/useAgentSync";
import { ImportReportCard } from "@/components/ImportReportCard";
import { AccountError, clearFlexCredentials, deleteAccount, setFlexCredentials, setFlexRelay, setTwsPort } from "@/db/accounts";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { clearDerived, type ClearDerivedReport } from "@/db/clearDerived";
import { useDb } from "@/db/DbProvider";
import { useAccount, useContractIdentities, useImports, useStatements } from "@/db/hooks";
import { importFiles, type ImportReport } from "@/db/importFile";
import { withImportLock } from "@/db/importLock";
import { countOrphanRows, deleteStatement, replayStatements, type ReplayReport } from "@/db/replayStatements";
import type { AccountRecord, StatementRecord } from "@/db/schema";
import { flexRelayMode, pickFlexRelay, type FlexRelayMode } from "@/flex/relay";
import { useFlexAutoSync } from "@/flex/useFlexAutoSync";
import { formatBytes, formatDateTime, formatPeriod } from "@/lib/format";

export function SourcesPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const db = useDb();
  const account = useAccount(accountId);
  const imports = useImports(accountId);
  const [reports, setReports] = useState<ImportReport[]>([]);
  const [importing, setImporting] = useState(false);
  const statements = useStatements(accountId);
  const [replayReport, setReplayReport] = useState<ReplayReport | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [purgeReport, setPurgeReport] = useState<ClearDerivedReport | "failed" | null>(null);
  const [purging, setPurging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [flexToken, setFlexToken] = useState("");
  const [flexQueryId, setFlexQueryId] = useState("");
  const [credentialsNotice, setCredentialsNotice] = useState<"saved" | "cleared" | null>(null);

  // The Flex Query form belongs to whichever account the route names, not to this component
  // instance: AppLayout renders <Outlet /> without a key on accountId, so switching accounts
  // (back/forward, a bookmark, a typed URL) keeps this instance mounted while :accountId
  // changes underneath it. Without this, a token typed for one account but not yet saved
  // would still be sitting in state when the user reaches a different account, and clicking
  // "Enregistrer" there would write it onto that other account's record.
  useEffect(() => {
    setFlexToken("");
    setFlexQueryId("");
    setCredentialsNotice(null);
    setReplayReport(null);
    setPurgeReport(null);
  }, [accountId]);

  if (!account) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // One import, one replay, one deletion or one purge at a time: they all write the same rows.
  const busy = importing || replaying || purging;

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    // Copied before the reset: emptying the input empties its file list too.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || !account) return;
    setImporting(true);
    setReplayReport(null);
    setPurgeReport(null);
    try {
      // One lock for the whole batch: no Flex sync or agent pass writes between two of its
      // files. `importFiles` never rejects, a failure becomes that file's report.
      setReports(await withImportLock(account.id, () => importFiles(db, account, files)));
    } finally {
      setImporting(false);
    }
  }

  /** Both the replay button and a deletion go through here: one rebuild, one report. */
  async function runReplay(rebuild: (account: AccountRecord) => Promise<ReplayReport>) {
    if (!account) return;
    setReplaying(true);
    setReports([]);
    setPurgeReport(null);
    try {
      setReplayReport(await withImportLock(account.id, () => rebuild(account)));
    } catch (e) {
      setReplayReport({ status: "error", fileName: "", issues: [{ severity: "error", code: "normalization", detail: e instanceof Error ? e.message : String(e) }] });
    } finally {
      setReplaying(false);
    }
  }

  /**
   * A rebuild tears the whole statement layer down. Rows that come from a statement no
   * longer kept — everything imported before the files were kept, typically — have nothing
   * to write them back, so the user is told how many and asked, exactly as for a deletion.
   */
  async function handleReplay() {
    if (!account) return;
    const orphans = await countOrphanRows(db, account);
    if (orphans > 0 && !window.confirm(t("sources.statements.replayConfirm", { count: orphans }))) return;
    await runReplay((current) => replayStatements(db, current));
  }

  function handleDeleteStatement(statement: StatementRecord) {
    if (!window.confirm(t("sources.statements.deleteConfirm", { period: formatPeriod(statement.period) }))) return;
    void runReplay((current) => deleteStatement(db, current, statement.id));
  }

  /**
   * Drops everything the imports derived — ledger, contracts, positions, import journal —
   * and keeps the files and the configuration, so the user recomputes from what is already
   * held instead of setting the account up again. The counts are read before the question:
   * a confirmation that names what disappears is the only warning there is.
   */
  async function handlePurge() {
    if (!account) return;
    const transactions = await db.transactions.where("accountId").equals(account.id).count();
    if (!window.confirm(t("sources.purge.confirm", { transactions, statements: statements?.length ?? 0 }))) return;
    setPurging(true);
    setReports([]);
    setReplayReport(null);
    try {
      setPurgeReport(await withImportLock(account.id, () => clearDerived(db, account)));
    } catch {
      setPurgeReport("failed");
    } finally {
      setPurging(false);
    }
  }

  async function handleSaveCredentials(event: FormEvent) {
    event.preventDefault();
    if (!account) return;
    // Blank means "leave the stored value alone" (db/accounts.ts). Both boxes are emptied
    // afterwards: a token has no business sitting in the DOM once it is stored.
    await setFlexCredentials(db, account.id, { token: flexToken, queryId: flexQueryId });
    setFlexToken("");
    setFlexQueryId("");
    setCredentialsNotice("saved");
  }

  async function handleClearCredentials() {
    if (!account) return;
    await clearFlexCredentials(db, account.id);
    setFlexToken("");
    setFlexQueryId("");
    setCredentialsNotice("cleared");
  }

  async function handleDelete() {
    if (!account) return;
    if (!window.confirm(t("sources.delete.confirm", { label: account.label }))) return;
    await deleteAccount(db, account.id);
    navigate("/accounts");
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.sources")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("sources.account.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("sources.account.label")}</dt>
            <dd>{account.label}</dd>
            <dt className="text-muted-foreground">{t("sources.account.ibAccountId")}</dt>
            <dd className="font-mono">{account.ibAccountId}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card data-testid="flex-query-card">
        <CardHeader>
          <CardTitle>{t("sources.flexQuery.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <form onSubmit={handleSaveCredentials} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t("sources.flexQuery.hint")}</p>
              {/* What is stored, never the token itself: the query id is not a secret and is
                  shown in full, the token only ever gets a yes or a no. Without this the form
                  looked identical whether a token was stored or not. */}
              <div className="text-sm text-muted-foreground">
                <p>{t(account.flexToken ? "sources.tokenStored" : "sources.tokenMissing")}</p>
                <p>
                  {account.flexQueryId
                    ? t("sources.queryIdStored", { queryId: account.flexQueryId })
                    : t("sources.queryIdMissing")}
                </p>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                {t("sources.flexToken")}
                <Input
                  type="password"
                  autoComplete="off"
                  value={flexToken}
                  onChange={(e) => {
                    setFlexToken(e.target.value);
                    setCredentialsNotice(null);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("sources.flexQueryId")}
                <Input
                  value={flexQueryId}
                  onChange={(e) => {
                    setFlexQueryId(e.target.value);
                    setCredentialsNotice(null);
                  }}
                />
              </label>
              <p className="-mt-1 text-xs text-muted-foreground">{t("sources.credentialsHint")}</p>
              <div className="flex flex-wrap items-center gap-3">
                {/* Disabled on an empty form rather than saving nothing and claiming success. */}
                <Button type="submit" disabled={flexToken.trim() === "" && flexQueryId.trim() === ""}>
                  {t("sources.saveCredentials")}
                </Button>
                {(account.flexToken || account.flexQueryId) && (
                  <Button type="button" variant="outline" onClick={() => void handleClearCredentials()}>
                    {t("sources.clearCredentials")}
                  </Button>
                )}
                {credentialsNotice && (
                  <p className="text-sm text-muted-foreground">
                    {t(credentialsNotice === "saved" ? "sources.credentialsSaved" : "sources.credentialsCleared")}
                  </p>
                )}
              </div>
            </form>
            <FlexRelayRadio account={account} />
          </div>
        </CardContent>
      </Card>

      <ContractIdentityCard accountId={account.id} />

      <SyncCard accountId={account.id} account={account} />

      <AgentCard account={account} />

      <Card>
        <CardHeader>
          <CardTitle>{t("sources.import.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("sources.import.hint")}</p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".xml,.htm,.html,text/xml,application/xml,text/html"
            aria-label={t("sources.import.button")}
            className="sr-only"
            disabled={busy}
            onChange={handleFiles}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>
              {t(importing ? "sources.import.importing" : "sources.import.button")}
            </Button>
            {/* Rebuilds the statement layer from the files kept below. Disabled with an
                empty store: there would be nothing to rebuild from. */}
            <Button
              variant="outline"
              onClick={() => void handleReplay()}
              disabled={busy || !statements || statements.length === 0}
            >
              {t(replaying ? "sources.statements.replaying" : "sources.statements.replay")}
            </Button>
            {/* Wipes what the imports derived, never the files or the settings. Always
                offered: a ledger left half-built by an old parser is exactly what one
                wants to throw away, whatever the statement store holds. */}
            <Button variant="destructive" onClick={() => void handlePurge()} disabled={busy}>
              {t(purging ? "sources.purge.purging" : "sources.purge.button")}
            </Button>
          </div>
          {reports.length > 1 && (
            <p data-testid="import-summary" className="text-sm">
              {t("sources.import.summary", {
                total: reports.length,
                imported: reports.filter((r) => r.status === "ok").length,
                failed: reports.filter((r) => r.status === "error").length,
              })}
            </p>
          )}
          {purgeReport && (
            <p data-testid="purge-report" className="text-sm">
              {purgeReport === "failed"
                ? t("sources.purge.failed")
                : t("sources.purge.done", { count: purgeReport.transactions, contracts: purgeReport.contracts })}
            </p>
          )}
          {replayReport && (
            <p data-testid="replay-report" className="text-sm">
              {replayReport.status === "ok"
                ? t("sources.statements.done", { count: replayReport.statements, imported: replayReport.imported })
                : replayReport.fileName
                  ? t("sources.statements.error", { fileName: replayReport.fileName })
                  : t("sources.statements.failed")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="statement-store">
        <CardHeader>
          <CardTitle>{t("sources.statements.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 overflow-x-auto">
          <p className="text-sm text-muted-foreground">{t("sources.statements.hint")}</p>
          {statements && statements.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("sources.statements.empty")}</p>
          )}
          {statements && statements.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sources.statements.columns.period")}</TableHead>
                  <TableHead>{t("sources.statements.columns.file")}</TableHead>
                  <TableHead className="text-right">{t("sources.statements.columns.size")}</TableHead>
                  <TableHead>{t("sources.statements.columns.imported")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {statements.map((statement) => (
                  <TableRow key={statement.id}>
                    <TableCell className="font-mono">{formatPeriod(statement.period)}</TableCell>
                    <TableCell className="max-w-xs truncate" title={statement.fileName}>{statement.fileName}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatBytes(statement.bytes)}</TableCell>
                    <TableCell>{formatDateTime(statement.importedAt)}</TableCell>
                    <TableCell className="text-right">
                      {/* Named with its period: every row's button would read alike otherwise. */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        aria-label={`${t("sources.statements.delete")} ${formatPeriod(statement.period)}`}
                        onClick={() => handleDeleteStatement(statement)}
                      >
                        {t("sources.statements.delete")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {reports.map((report, index) => (
        <ImportReportCard key={`${index}:${report.fileName}`} report={report} />
      ))}

      <Card data-testid="import-history">
        <CardHeader>
          <CardTitle>{t("sources.history.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {imports && imports.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("sources.history.empty")}</p>
          )}
          {imports && imports.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sources.history.columns.date")}</TableHead>
                  <TableHead>{t("sources.history.columns.source")}</TableHead>
                  <TableHead>{t("sources.history.columns.file")}</TableHead>
                  <TableHead>{t("sources.history.columns.period")}</TableHead>
                  <TableHead className="text-right">{t("sources.history.columns.rows")}</TableHead>
                  <TableHead className="text-right">{t("sources.history.columns.warnings")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{formatDateTime(record.at)}</TableCell>
                    <TableCell>{t(`sources.report.sources.${record.source}`)}</TableCell>
                    <TableCell className="max-w-xs truncate" title={record.fileName}>{record.fileName}</TableCell>
                    <TableCell className="font-mono">{formatPeriod(record.period)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {record.imported}
                      {record.positions != null && ` + ${t("sources.history.positions", { count: record.positions })}`}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{record.issues.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sources.delete.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("sources.delete.hint")}</p>
          <div>
            <Button variant="destructive" onClick={handleDelete}>
              {t("sources.delete.button")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const FLEX_RELAY_OPTIONS: { value: FlexRelayMode; label: string; hint: string }[] = [
  { value: "agent", label: "sources.flexRelay.agent", hint: "sources.flexRelay.agentHint" },
  { value: "agent-and-server", label: "sources.flexRelay.agentAndServer", hint: "sources.flexRelay.agentAndServerHint" },
];

/**
 * Saved on change, on its own: it is not a credential, and the credentials form only ever
 * writes what is typed. Reads the stored account, so it follows the route's account by itself.
 */
function FlexRelayRadio({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const db = useDb();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t("sources.flexRelay.legend")}</legend>
      <RadioGroup
        value={flexRelayMode(account)}
        onValueChange={(value) => {
          if (value === "agent" || value === "agent-and-server") void setFlexRelay(db, account.id, value);
        }}
        className="flex flex-col gap-3"
      >
        {FLEX_RELAY_OPTIONS.map((option) => {
          const id = `flex-relay-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem value={option.value} id={id} aria-describedby={`${id}-hint`} className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <label htmlFor={id} className="text-sm">
                  {t(option.label)}
                </label>
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                  {t(option.hint)}
                </p>
              </div>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

/**
 * What the ticker-identity resolution could not settle, in plain words: never an error,
 * because none of it is one — a missing conid or an unpaired corporate action is information
 * the user can act on (Contract Information needs a fresh statement, Conid/Security ID need a
 * Flex Query change), not a failure of this import.
 */
function ContractIdentityCard({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const contracts = useContractIdentities(accountId);
  const journals = useAccountJournals();
  const aliases = contracts?.reduce((sum, contract) => sum + contract.aliases.length, 0) ?? 0;
  const issues = journals.status === "ready" ? journals.identityIssues : [];

  return (
    <Card data-testid="contracts-card">
      <CardHeader>
        <CardTitle>{t("sources.contracts.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {contracts && (
          <p className="text-sm">
            {contracts.length === 0
              ? t("sources.contracts.empty")
              : t("sources.contracts.known", { count: contracts.length, contracts: contracts.length, aliases })}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {issues.map((issue, i) => (
              <li key={`${issue.code}:${issue.ticker}:${i}`}>{issue.detail}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("sources.contracts.flexHint")}</p>
        <p className="text-xs text-muted-foreground">{t("sources.contracts.statementHint")}</p>
      </CardContent>
    </Card>
  );
}

/** How often the Sources page looks again for an agent it found absent. */
export const AGENT_REPROBE_MS = 10_000;

/**
 * None of these eight states is an error: they are explanations. Sub-project 19 lets the local
 * agent relay Flex calls, so the agent is looked for first, before the session or the account's
 * credentials are even considered — a visitor with the agent running never needs to hear about
 * signing in. The session only matters in "agent local et serveur" mode, and only once the agent
 * is confirmed absent: in "agent local seulement" mode it never counts at all (spec sous-projet
 * 19 §5.2). The eight states: agent presence still unknown; agent absent in agent-only mode;
 * agent absent, mode allows the server, but no session and the server itself unreachable; same,
 * but no session at all (needs the agent or an account); a relay is available but credentials are
 * missing; a relay is available and the last attempt failed; a relay is available and it never
 * ran; a relay is available and the last attempt succeeded. The button itself is a manual,
 * deliberate sync: it ignores staleness (`useFlexAutoSync`'s `run()` does too), unlike the
 * automatic trigger in `AppLayout`.
 */
function SyncCard({ accountId, account }: { accountId: string; account: AccountRecord }) {
  const { t } = useTranslation();
  const session = useSession();
  const presence = useAgentPresence();
  const sync = useFlexAutoSync(accountId);
  const hasCredentials = Boolean(account.flexToken && account.flexQueryId);
  const status = account.lastFlexSyncStatus;
  const failed = status !== undefined && !status.ok;

  // Nobody may have probed yet (no TWS port, so no agent polling): this card needs to know.
  useEffect(() => {
    if (presence.status === "unknown") void refreshPresence();
  }, [presence.status]);

  // An absent agent may be started while this page is open, and nothing else looks again
  // without a TWS port: re-probe on a short cadence, and at once when the tab comes back into
  // view or regains focus — never while it is hidden. The flip to "present" re-runs
  // `useFlexAutoSync`'s auto-trigger through its presence dependency.
  useEffect(() => {
    if (presence.status !== "absent") return;
    const probe = () => {
      if (document.visibilityState === "visible") void refreshPresence();
    };
    const timer = setInterval(probe, AGENT_REPROBE_MS);
    window.addEventListener("focus", probe);
    document.addEventListener("visibilitychange", probe);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", probe);
      document.removeEventListener("visibilitychange", probe);
    };
  }, [presence.status]);

  const choice = pickFlexRelay(flexRelayMode(account), presence.status === "present", session.status);
  const via = status?.relay ? t(`sync.via.${status.relay}`) : null;

  let message: ReactNode;
  let showSignIn = false;
  let showInstall = false;
  let canRun = false;

  if (presence.status === "unknown") {
    message = t("sync.agentUnknown");
  } else if (choice.relay === null && choice.reason === "agent-absent") {
    message = t("sync.needsAgent");
    showInstall = true;
  } else if (choice.relay === null && choice.reason === "session-loading") {
    message = t("common.loading");
  } else if (choice.relay === null && choice.reason === "needs-agent-or-account") {
    message = t("sync.needsAgentOrAccount");
    showSignIn = true;
  } else if (choice.relay === null && choice.reason === "server-unreachable") {
    message = t("sync.serverUnreachable");
  } else if (!hasCredentials) {
    message = t("sync.needsCredentials");
  } else if (failed) {
    message = via ? t("sync.lastFailedVia", { code: status.code, relay: via }) : t("sync.lastFailed", { code: status.code });
    canRun = true;
  } else {
    const date = account.lastFlexSyncAt ? formatDateTime(account.lastFlexSyncAt) : "—";
    message = via ? t("sync.lastSyncVia", { date, relay: via }) : t("sync.lastSync", { date });
    canRun = true;
  }

  return (
    <Card data-testid="sync-card">
      <CardHeader>
        <CardTitle>{t("sync.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          {/* Muted even when `failed`: a past attempt's outcome is one of the explanations this
              card gives, not an error — `text-destructive` would read as an alarm, which the
              button staying active right next to it already contradicts. */}
          <p className="text-sm text-muted-foreground">{message}</p>
          {showSignIn && (
            <Link to="/login" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("auth.signIn")}
            </Link>
          )}
          {showInstall && (
            <Link to="/help" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("agent.helpLink")}
            </Link>
          )}
        </div>
        <div>
          <Button onClick={() => void sync.run()} disabled={!canRun || sync.state === "running"}>
            {t(sync.state === "running" ? "sync.running" : "sync.run")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Like SyncCard: explanations, never errors. The agent is optional (spec fondateur §2 and §8);
 * absent, or without a port, the card says what would make live data appear, and the button
 * stays disabled instead of failing.
 */
function AgentCard({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const db = useDb();
  const { presence, state, run } = useAgentSync(account.id);
  const [port, setPort] = useState(account.twsPort?.toString() ?? "");
  const [notice, setNotice] = useState<"saved" | "invalid" | null>(null);
  // `useState`'s initializer above already seeds `port`/`notice` correctly for the account
  // this instance first mounts with; this ref only lets the effect below tell that initial
  // mount apart from a later, genuine account switch.
  const mountedAccountId = useRef(account.id);

  // The form follows the route's account, not this component instance (see the Flex form
  // above): AppLayout keeps this instance mounted while :accountId changes underneath it.
  // Skipped on the very first render, not just to avoid a redundant no-op write: effects
  // commit asynchronously, and in tests (whose scripted keystrokes run far faster than a human
  // ever could) that pending mount-time commit could still land after a `type()` right after
  // mount, silently overwriting it back to `account.twsPort`. Also guards, on every later
  // commit, against this same effect's own write (via `setTwsPort`) echoing back through the
  // live-queried `account` prop with the same twsPort and re-firing on that echo, which would
  // wipe the "saved"/"invalid" notice right after showing it.
  useEffect(() => {
    if (mountedAccountId.current === account.id) return;
    mountedAccountId.current = account.id;
    setPort(account.twsPort?.toString() ?? "");
    setNotice(null);
  }, [account.id, account.twsPort]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const trimmed = port.trim();
    try {
      await setTwsPort(db, account.id, trimmed === "" ? null : Number(trimmed));
      setNotice("saved");
    } catch (e) {
      if (e instanceof AccountError && e.code === "tws-port-invalid") setNotice("invalid");
      else throw e;
    }
  }

  const status = account.lastAgentSyncStatus;
  const hasPort = account.twsPort !== undefined;
  let presenceLine: ReactNode;
  if (!hasPort) presenceLine = t("agent.portMissing");
  else if (presence.status === "unknown") presenceLine = t("agent.unknown");
  else if (presence.status === "absent") presenceLine = t("agent.absent");
  else presenceLine = t("agent.detected", { version: presence.version });

  let passLine: string;
  if (!status) passLine = t("agent.never");
  else if (status.ok) passLine = t("agent.lastSync", { date: account.lastAgentSyncAt ? formatDateTime(account.lastAgentSyncAt) : "—" });
  else passLine = t("agent.lastFailed", { reason: status.code ? t(`agent.errors.${status.code}`) : "—" });

  const canRun = hasPort && presence.status === "present";

  return (
    <Card data-testid="agent-card">
      <CardHeader>
        <CardTitle>{t("agent.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("agent.hint")}</p>
          <label className="flex flex-col gap-1 text-sm">
            {t("agent.port")}
            {/* type="text", not "number": a native number input rejects setSelectionRange
                (used by "select all" and by userEvent.clear in tests) and its min/max would
                silently block the submit event for an out-of-range value instead of letting
                the app show its own message below. `setTwsPort` is the one place that
                validates the range. */}
            <Input
              type="text"
              inputMode="numeric"
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
                setNotice(null);
              }}
              className="max-w-40"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">{t("agent.savePort")}</Button>
            {notice === "saved" && <p className="text-sm text-muted-foreground">{t("agent.portSaved")}</p>}
            {notice === "invalid" && <p className="text-sm text-destructive">{t("agent.portInvalid")}</p>}
          </div>
        </form>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{presenceLine}</p>
          {hasPort && presence.status === "absent" && (
            <Link to="/help" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("agent.helpLink")}
            </Link>
          )}
        </div>
        {hasPort && <p className="text-sm text-muted-foreground">{passLine}</p>}
        <div>
          <Button onClick={() => void run()} disabled={!canRun || state === "running"}>
            {t(state === "running" ? "agent.refreshing" : "agent.refresh")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
