import { useTranslation } from "react-i18next";
import { XIcon } from "lucide-react";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { criterionSummary } from "@/lib/criterionSummary";
import { activeCriteria, type ColumnSpec, type TableView } from "@/lib/tableView";

export interface ActiveFiltersProps<Row> {
  specs: readonly ColumnSpec<Row>[];
  view: TableView;
  columnLabel: (key: string) => string;
  onClearColumn: (key: string) => void;
  onClearAll: () => void;
}

/** One pill per filtered column above a table, and a way to clear them all. Nothing when unfiltered. */
export function ActiveFilters<Row>({ specs, view, columnLabel, onClearColumn, onClearAll }: ActiveFiltersProps<Row>) {
  const { t } = useTranslation();
  const active = activeCriteria(specs, view);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map(({ spec, criterion }) => {
        const column = columnLabel(spec.key);
        return (
          <Badge key={spec.key} variant="secondary" className="gap-1 pr-0.5">
            <span>{t("tableFilter.pill", { column, summary: criterionSummary(spec, criterion, "—") })}</span>
            <button
              type="button"
              aria-label={t("tableFilter.clearColumn", { column })}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
              onClick={() => onClearColumn(spec.key)}
            >
              <XIcon aria-hidden="true" className="size-3" />
            </button>
          </Badge>
        );
      })}
      <Button size="xs" variant="ghost" onClick={onClearAll}>
        {t("tableFilter.clearAll")}
      </Button>
    </div>
  );
}
