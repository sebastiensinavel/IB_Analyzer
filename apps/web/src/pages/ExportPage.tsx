import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { useDb } from "@/db/DbProvider";
import { loadExport } from "@/export/loadExport";
import { pineScript, watchlistText, type ExportLevelWords } from "@/lib/tradingview";

const COPIED_FEEDBACK_MS = 2000;
export const WATCHLIST_FILE_NAME = "ib-analyzer-tradingview.txt";

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) return null;
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? t("export.copied") : t("export.copy")}
    </Button>
  );
}

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = WATCHLIST_FILE_NAME;
  anchor.click();
  // Revoked in a later task: Firefox cancels a download whose URL is revoked in the same one.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Preview({ text, label }: { text: string; label: string }) {
  return (
    <pre aria-label={label} className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
      {text}
    </pre>
  );
}

/**
 * The TradingView export (sub-project 44): every account's held tickers as a watchlist file, and
 * a Pine Script indicator drawing their levels. A computed view of the base, never stored, and
 * nothing leaves the browser unless the user copies or downloads it.
 */
export function ExportPage() {
  const { t } = useTranslation();
  const db = useDb();
  const data = useLiveQuery(() => loadExport(db), [db]);
  const words: ExportLevelWords = useMemo(
    () => ({
      shares: t("charts.levels.shares"),
      shortPut: t("charts.levels.shortPut"),
      shortCall: t("charts.levels.shortCall"),
      condor: t("export.levels.condor"),
      alert: t("export.levels.alert"),
    }),
    [t],
  );
  const watchlist = data ? watchlistText(data.tickers) : "";
  const script = data ? pineScript(data.levels, words) : "";
  const scriptTickers = data ? new Set(data.levels.map((level) => level.ticker)).size : 0;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("export.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("export.watchlist.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data === undefined ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : data.tickers.size === 0 ? (
            <p className="text-sm text-muted-foreground">{t("export.watchlist.empty")}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("export.watchlist.how", { count: data.tickers.size })}</p>
              <Preview text={watchlist} label={t("export.watchlist.title")} />
              <div className="flex flex-wrap gap-2">
                <CopyButton text={watchlist} />
                <Button type="button" variant="outline" size="sm" onClick={() => download(watchlist)}>
                  <Download aria-hidden />
                  {t("export.download")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("export.script.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data === undefined ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : scriptTickers === 0 ? (
            <p className="text-sm text-muted-foreground">{t("export.script.empty")}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("export.script.how", { count: scriptTickers })}</p>
              <p className="text-sm text-muted-foreground">{t("export.script.frozen")}</p>
              <Preview text={script} label={t("export.script.title")} />
              <div className="flex flex-wrap gap-2">
                <CopyButton text={script} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
