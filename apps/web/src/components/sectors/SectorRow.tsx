import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { TableCell, TableRow } from "@ib/ui/table";
import { useDb } from "@/db/DbProvider";
import type { SectorRecord } from "@/db/schema";
import { deleteSector, parseScoreInput, updateSector, type SectorFields } from "@/db/sectors";
import { LABEL_TONE_CLASS } from "@/lib/journalTone";
import { cn } from "@/lib/utils";
import { EditableCell } from "./EditableCell";
import { CATEGORY_LIST_ID, STATUS_LIST_ID } from "./lists";

/** The stored-string form of what a score field would save: "" for null, a number's own text, or the raw text when unreadable. */
function normalizeScore(text: string): string {
  const score = parseScoreInput(text);
  if (score === "invalid") return text;
  return score === null ? "" : String(score);
}

/**
 * One stored row: the ticker is its key and stays read-only, every other stored field is edited in
 * place. `ongoing` says whether any account holds the ticker, `undefined` while the snapshots load.
 */
export function SectorRow({ record, ongoing }: { record: SectorRecord; ongoing: boolean | undefined }) {
  const { t } = useTranslation();
  const db = useDb();
  const label = (column: string) => `${t(`sectors.table.columns.${column}`)} ${record.ticker}`;

  const commitText = (field: "name" | "category" | "status") => (text: string) => {
    const patch: Partial<SectorFields> = {};
    patch[field] = text;
    return updateSector(db, record.ticker, patch);
  };

  async function commitScore(text: string) {
    const score = parseScoreInput(text);
    if (score === "invalid") return false;
    return updateSector(db, record.ticker, { score });
  }

  function handleDelete() {
    if (!window.confirm(t("sectors.table.deleteConfirm", { ticker: record.ticker }))) return;
    void deleteSector(db, record.ticker);
  }

  return (
    <TableRow data-testid="sector-row" data-ticker={record.ticker}>
      <TableCell className="font-mono">{record.ticker}</TableCell>
      <TableCell>
        <EditableCell value={record.name} aria-label={label("name")} onCommit={commitText("name")} normalize={(text) => text.trim()} />
      </TableCell>
      <TableCell>
        <EditableCell
          value={record.category}
          list={CATEGORY_LIST_ID}
          aria-label={label("category")}
          onCommit={commitText("category")}
          normalize={(text) => text.trim()}
        />
      </TableCell>
      <TableCell>
        <EditableCell
          value={record.score === null ? "" : String(record.score)}
          inputMode="decimal"
          className="w-20 text-right font-mono tabular-nums"
          placeholder="—"
          aria-label={label("score")}
          onCommit={commitScore}
          normalize={normalizeScore}
        />
      </TableCell>
      <TableCell>
        <EditableCell
          value={record.status}
          list={STATUS_LIST_ID}
          aria-label={label("status")}
          onCommit={commitText("status")}
          normalize={(text) => text.trim()}
        />
      </TableCell>
      <TableCell data-testid="sector-ongoing" className={cn("text-right font-mono tabular-nums", ongoing && LABEL_TONE_CLASS.open)}>
        {ongoing === undefined ? "" : ongoing ? "1" : "0"}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" aria-label={t("sectors.table.delete", { ticker: record.ticker })} onClick={handleDelete}>
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  );
}
