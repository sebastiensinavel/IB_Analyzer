import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Button } from "@ib/ui/button";
import { Checkbox } from "@ib/ui/checkbox";
import { Input } from "@ib/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ib/ui/popover";
import { Separator } from "@ib/ui/separator";
import { TableHead } from "@ib/ui/table";
import { parseCriterion } from "@/lib/tableCriteria";
import type { ColumnMeta, Criterion, Facet, SortDirection, TableView } from "@/lib/tableView";
import { cn } from "@/lib/utils";

export interface ColumnHeaderProps {
  meta: ColumnMeta;
  label: string;
  view: TableView;
  /** Values offered by an enum column's filter. */
  facets?: readonly Facet[];
  numeric?: boolean;
  /** The label wraps onto several lines instead of being clipped (Positions); History keeps one line. */
  wrap?: boolean;
  className?: string;
  title?: string;
  /** `null` resets the sort; `additive` comes from the shift key. */
  onSort: (dir: SortDirection | null, additive: boolean) => void;
  onCriterion: (criterion: Criterion | null) => void;
}

/**
 * A sortable, filterable column header: the whole cell is one button opening one panel, the sort
 * actions above the column's filter. Renders its own TableHead so aria-sort sits on the header cell.
 *
 * Nothing in the header says the column is filtered: the pills above the table do. The sort, on the
 * other hand, has to be read on the column itself, permanently: the direction's arrow once the
 * column is sorted, a faint double chevron while it is not. That chevron stays in the layout —
 * revealing it on hover would shrink the label under the very cursor asking about it, and the
 * column widths are sized with it in place.
 */
export function ColumnHeader({ meta, label, view, facets = [], numeric = false, wrap = false, className, title, onSort, onCriterion }: ColumnHeaderProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sortIndex = view.sort.findIndex((key) => key.column === meta.key);
  const sortKey = sortIndex >= 0 ? view.sort[sortIndex] : null;
  const criterion = view.criteria[meta.key];
  const ariaSort = sortIndex === 0 && sortKey ? (sortKey.dir === "asc" ? "ascending" : "descending") : undefined;
  const SortIcon = sortKey === null ? ChevronsUpDownIcon : sortKey.dir === "desc" ? ArrowDownIcon : ArrowUpIcon;
  const sort = (dir: SortDirection | null, additive: boolean) => {
    onSort(dir, additive);
    setOpen(false);
  };

  return (
    <TableHead className={className} title={title} aria-sort={ariaSort}>
      <Popover open={open} onOpenChange={setOpen}>
        <div className={cn("flex min-w-0", numeric && "justify-end")}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  // `font`, `letter-spacing` and `color` inherit from TableHead by Tailwind's
                  // preflight (`button { font: inherit; letter-spacing: inherit; color: inherit }`),
                  // but browsers force `text-transform: none` on form controls outside that
                  // shorthand: without `uppercase` here, a sortable header falls back to sentence
                  // case while every non-sortable header (a plain TableHead) stays uppercase.
                  "-mx-1 inline-flex min-w-0 cursor-pointer items-center rounded px-1 py-0.5 uppercase outline-none",
                  "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted data-popup-open:text-foreground",
                )}
              />
            }
          >
            <span className={wrap ? "break-words whitespace-normal" : "truncate"}>{label}</span>
            {meta.sortable && (
              <SortIcon aria-hidden="true" data-testid="sort-indicator" className={cn("ml-0.5 size-3 shrink-0", !sortKey && "opacity-40")} />
            )}
            {sortKey && view.sort.length > 1 && (
              <>
                <span aria-hidden="true" className="text-[0.65rem] tabular-nums">
                  {sortIndex + 1}
                </span>
                {/* A space of its own, so the name reads "Montant Tri n°2"; a flex container renders none. */}
                {" "}
                <span className="sr-only">{t("tableFilter.sortOrder", { order: sortIndex + 1 })}</span>
              </>
            )}
          </PopoverTrigger>
        </div>
        <PopoverContent className="w-64 gap-2 p-3" align={numeric ? "end" : "start"} aria-label={t("tableFilter.panel", { column: label })}>
          {meta.sortable && (
            <>
              <div className="flex gap-1">
                {(["asc", "desc"] as const).map((dir) => (
                  <Button
                    key={dir}
                    size="xs"
                    variant={sortKey?.dir === dir ? "default" : "outline"}
                    aria-pressed={sortKey?.dir === dir}
                    onClick={(event) => sort(dir, event.shiftKey)}
                  >
                    {dir === "asc" ? <ArrowUpIcon aria-hidden="true" /> : <ArrowDownIcon aria-hidden="true" />}
                    {t(dir === "asc" ? "tableFilter.sortAsc" : "tableFilter.sortDesc")}
                  </Button>
                ))}
              </div>
              {sortKey && (
                <Button size="xs" variant="ghost" className="self-start" onClick={(event) => sort(null, event.shiftKey)}>
                  <XIcon aria-hidden="true" />
                  {t("tableFilter.sortReset")}
                </Button>
              )}
              <Separator />
            </>
          )}
          <p className="text-xs font-medium text-muted-foreground">{t("tableFilter.filterSection")}</p>
          {meta.type === "enum" ? (
            <EnumFilter facets={facets} checked={Array.isArray(criterion) ? criterion : []} onCriterion={onCriterion} />
          ) : (
            <TextFilter
              type={meta.type}
              label={label}
              // Only a column with no sort row opens on its input: on a sortable one that would put
              // the focus below the buttons the panel opens on, and Shift+Tab would be the way back.
              autoFocus={!meta.sortable}
              initial={typeof criterion === "string" ? criterion : ""}
              onCriterion={onCriterion}
              onDone={() => setOpen(false)}
            />
          )}
          {meta.sortable && <p className="text-[0.65rem] text-muted-foreground">{t("tableFilter.sortAddHint")}</p>}
        </PopoverContent>
      </Popover>
    </TableHead>
  );
}

function TextFilter({
  type,
  label,
  autoFocus,
  initial,
  onCriterion,
  onDone,
}: {
  type: "text" | "number" | "date";
  label: string;
  autoFocus: boolean;
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
        autoFocus={autoFocus}
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
