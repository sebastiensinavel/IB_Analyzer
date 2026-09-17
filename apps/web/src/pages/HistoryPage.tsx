import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { TRANSACTION_KINDS, anchoredBalances, matchesFilter, type TransactionKind } from "@ib/ledger";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import { HistoryTable } from "@/components/history/HistoryTable";
import { useCashPoints, useLedger } from "@/db/hooks";
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { activePreset, periodPresets, yearsOf, type PeriodPreset } from "@/lib/periodPresets";

const SEARCH_DEBOUNCE_MS = 300;

export function HistoryPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const titleId = useId();
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  const [searchInput, setSearchInput] = useState("");
  const [symbol, setSymbol] = useState("");
  // null means "every kind" — the history is a cash-flow view by default.
  const [kind, setKind] = useState<TransactionKind | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setSymbol(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Balances run over the whole ledger, oldest first, anchored on the cash points; the table
  // shows newest first.
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );
  const rows = useMemo(() => (anchored ? [...anchored.rows].reverse() : undefined), [anchored]);
  const filtered = useMemo(
    () =>
      rows?.filter((row) =>
        matchesFilter(row.transaction, {
          symbol: symbol || undefined,
          kind,
          from: startDate || undefined,
          to: endDate || undefined,
        }),
      ),
    [rows, symbol, kind, startDate, endDate],
  );

  // Read once per render, not inside the memo below: a value read inside a memo's factory but
  // missing from its dependencies goes stale, here freezing "today" at the render that first
  // built the presets.
  const today = new Date().toISOString().slice(0, 10);
  // Years come from the whole ledger, never from the filtered rows: a preset does not vanish
  // because a filter emptied its year.
  const presets = useMemo(
    () => periodPresets(yearsOf(ledger?.map((transaction) => transaction.when) ?? []), today),
    [ledger, today],
  );

  if (!filtered) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // A new filter or account remounts the table, whose fresh scroll container starts at its top;
  // a row arriving live keeps the same key and leaves the reader where they are.
  const filterKey = JSON.stringify([accountId, symbol, kind, startDate, endDate]);
  const activeId = activePreset(presets, startDate, endDate);
  const presetLabel = (preset: PeriodPreset) =>
    preset.id === "all" || preset.id === "last30Days" || preset.id === "last12Months"
      ? t(`history.presets.${preset.id}`)
      : preset.id.slice("year:".length);

  return (
    // 3rem is AppLayout's title bar (h-12): changing one means changing the other, there is no
    // shared variable between them.
    <div className="flex h-[calc(100svh-3rem)] flex-col gap-4 p-4 md:p-6">
      <h1 id={titleId} className="font-heading text-lg font-semibold tracking-tight">
        {t("nav.history")}
      </h1>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("history.filterPlaceholder")}
          aria-label={t("history.filterPlaceholder")}
          className="max-w-xs"
        />
        <Select value={kind} onValueChange={(next: TransactionKind | null) => setKind(next)}>
          <SelectTrigger className="w-52" aria-label={t("history.kindFilter")}>
            <SelectValue>
              {(value: TransactionKind | null) => (value ? t(`history.kinds.${value}`) : t("history.allKinds"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>{t("history.allKinds")}</SelectItem>
            {TRANSACTION_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`history.kinds.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          aria-label={t("history.startDate")}
          className="w-auto"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          aria-label={t("history.endDate")}
          className="w-auto"
        />
      </div>

      <div role="group" aria-label={t("history.presets.label")} className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <Button
            key={preset.id}
            size="xs"
            variant={preset.id === activeId ? "default" : "outline"}
            aria-pressed={preset.id === activeId}
            onClick={() => {
              setStartDate(preset.from);
              setEndDate(preset.to);
            }}
          >
            {presetLabel(preset)}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("history.noResults")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="min-h-0 flex-1 py-0">
          <CardContent className="flex min-h-0 flex-1 px-0">
            <HistoryTable key={filterKey} rows={filtered} labelledBy={titleId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
