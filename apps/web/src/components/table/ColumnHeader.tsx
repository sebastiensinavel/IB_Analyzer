import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon, ArrowUpIcon, FunnelIcon } from "lucide-react";
import { Button } from "@ib/ui/button";
import { Checkbox } from "@ib/ui/checkbox";
import { Input } from "@ib/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ib/ui/popover";
import { TableHead } from "@ib/ui/table";
import { parseCriterion } from "@/lib/tableCriteria";
import { isActiveCriterion, type ColumnMeta, type Criterion, type Facet, type TableView } from "@/lib/tableView";
import { cn } from "@/lib/utils";

export interface ColumnHeaderProps {
  meta: ColumnMeta;
  label: string;
  view: TableView;
  /** Values offered by an enum column's filter. */
  facets?: readonly Facet[];
  numeric?: boolean;
  className?: string;
  title?: string;
  onSort: (additive: boolean) => void;
  onCriterion: (criterion: Criterion | null) => void;
}

/**
 * A sortable, filterable column header: the label sorts (shift adds a key), the funnel opens the
 * column's filter. Renders its own TableHead so aria-sort sits on the header cell.
 */
export function ColumnHeader({ meta, label, view, facets = [], numeric = false, className, title, onSort, onCriterion }: ColumnHeaderProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sortIndex = view.sort.findIndex((key) => key.column === meta.key);
  const sortKey = sortIndex >= 0 ? view.sort[sortIndex] : null;
  const criterion = view.criteria[meta.key];
  const active = isActiveCriterion(meta, criterion);
  const ariaSort = sortIndex === 0 && sortKey ? (sortKey.dir === "asc" ? "ascending" : "descending") : undefined;
  const Arrow = sortKey?.dir === "desc" ? ArrowDownIcon : ArrowUpIcon;

  return (
    <TableHead className={className} title={title} aria-sort={ariaSort}>
      <div className={cn("flex min-w-0 items-center gap-1", numeric && "justify-end")}>
        {meta.sortable ? (
          <button type="button" className="inline-flex min-w-0 items-center gap-0.5 hover:text-foreground" onClick={(event) => onSort(event.shiftKey)}>
            <span className="truncate">{label}</span>
            {sortKey && <Arrow aria-hidden="true" className="size-3.5 shrink-0" />}
            {sortKey && view.sort.length > 1 && (
              <span aria-label={t("tableFilter.sortOrder", { order: sortIndex + 1 })} className="text-[0.65rem] tabular-nums">
                {sortIndex + 1}
              </span>
            )}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={t("tableFilter.open", { column: label })}
                data-active={active}
                className={cn("shrink-0 rounded p-0.5 hover:bg-muted", active ? "text-primary" : "text-muted-foreground/60")}
              />
            }
          >
            <FunnelIcon aria-hidden="true" className={cn("size-3.5", active && "fill-current")} />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align={numeric ? "end" : "start"}>
            {meta.type === "enum" ? (
              <EnumFilter facets={facets} checked={Array.isArray(criterion) ? criterion : []} onCriterion={onCriterion} />
            ) : (
              <TextFilter
                type={meta.type}
                label={label}
                initial={typeof criterion === "string" ? criterion : ""}
                onCriterion={onCriterion}
                onDone={() => setOpen(false)}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
    </TableHead>
  );
}

function TextFilter({
  type,
  label,
  initial,
  onCriterion,
  onDone,
}: {
  type: "text" | "number" | "date";
  label: string;
  initial: string;
  onCriterion: (criterion: Criterion | null) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  // The draft may be invalid: it stays here, and only a valid criterion reaches the table.
  const [draft, setDraft] = useState(initial);
  const parsed = parseCriterion(draft, type);
  const change = (text: string) => {
    setDraft(text);
    const next = parseCriterion(text, type);
    if (next.ok) onCriterion(next.test === null ? null : text);
  };
  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        value={draft}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onDone();
        }}
        aria-label={t("tableFilter.input", { column: label })}
        aria-invalid={!parsed.ok}
        className="font-mono"
      />
      {parsed.ok ? (
        <p className="font-mono text-xs text-muted-foreground">{t(`tableFilter.help.${type}`)}</p>
      ) : (
        <p role="alert" className="text-xs text-destructive">
          {t(`tableFilter.errors.${parsed.error}`)}
        </p>
      )}
      <Button size="xs" variant="outline" className="self-end" onClick={() => change("")}>
        {t("tableFilter.clear")}
      </Button>
    </div>
  );
}

function EnumFilter({
  facets,
  checked,
  onCriterion,
}: {
  facets: readonly Facet[];
  checked: readonly (string | null)[];
  onCriterion: (criterion: Criterion | null) => void;
}) {
  const { t } = useTranslation();
  const toggle = (value: string | null, on: boolean) => {
    const next = on ? [...checked, value] : checked.filter((item) => item !== value);
    onCriterion(next.length === 0 ? null : next);
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {facets.map((facet) => {
          const text = facet.label ?? t("tableFilter.empty");
          return (
            <li key={facet.value ?? " null"}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={checked.includes(facet.value)} onCheckedChange={(on) => toggle(facet.value, on === true)} aria-label={text} />
                <span className="truncate">{text}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{facet.count}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button size="xs" variant="outline" className="self-end" onClick={() => onCriterion(null)}>
        {t("tableFilter.clear")}
      </Button>
    </div>
  );
}
