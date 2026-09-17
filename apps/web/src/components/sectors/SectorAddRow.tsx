import { Fragment, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { Input } from "@ib/ui/input";
import { TableCell, TableRow } from "@ib/ui/table";
import { useDb } from "@/db/DbProvider";
import { addSector, normalizeTicker, parseScoreInput } from "@/db/sectors";
import { CATEGORY_LIST_ID, STATUS_LIST_ID } from "./lists";

const EMPTY = { ticker: "", name: "", category: "", score: "", status: "" };
type Draft = typeof EMPTY;
type Problem = { kind: "exists"; ticker: string } | { kind: "score" } | null;

/** The first row of the table: a ticker typed by hand. A ticker already there is refused. */
export function SectorAddRow() {
  const { t } = useTranslation();
  const db = useDb();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<Problem>(null);
  const tickerInput = useRef<HTMLInputElement>(null);
  // A ref, not state: a second Enter fired before the first `add()` resolves must see it
  // synchronously, which a state flip scheduled for the next render would not guarantee.
  const inFlight = useRef(false);

  async function add() {
    if (inFlight.current) return;
    if (normalizeTicker(draft.ticker) === "") return;
    const score = parseScoreInput(draft.score);
    if (score === "invalid") {
      setProblem({ kind: "score" });
      return;
    }
    inFlight.current = true;
    try {
      const result = await addSector(db, { ticker: draft.ticker, name: draft.name, category: draft.category, score, status: draft.status });
      if (result === "exists") {
        setProblem({ kind: "exists", ticker: normalizeTicker(draft.ticker) });
      } else if (result === "added") {
        setDraft(EMPTY);
        setProblem(null);
        tickerInput.current?.focus();
      }
    } finally {
      inFlight.current = false;
    }
  }

  const field = (key: keyof Draft) => ({
    value: draft[key],
    "aria-label": t(`sectors.table.add.${key}`),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setDraft((previous) => ({ ...previous, [key]: value }));
      setProblem(null);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void add();
      }
    },
  });

  return (
    <Fragment>
      <TableRow data-testid="sector-add-row">
        <TableCell>
          <Input ref={tickerInput} className="w-24 font-mono" {...field("ticker")} />
        </TableCell>
        <TableCell>
          <Input {...field("name")} />
        </TableCell>
        <TableCell>
          <Input list={CATEGORY_LIST_ID} {...field("category")} />
        </TableCell>
        <TableCell>
          <Input
            inputMode="decimal"
            className="w-20 text-right font-mono tabular-nums"
            placeholder="—"
            aria-invalid={problem?.kind === "score" || undefined}
            {...field("score")}
          />
        </TableCell>
        <TableCell>
          <Input list={STATUS_LIST_ID} {...field("status")} />
        </TableCell>
        {/* En cours: computed from the snapshots, nothing to type. */}
        <TableCell />
        <TableCell className="text-right">
          <Button size="sm" disabled={draft.ticker.trim() === ""} onClick={() => void add()}>
            {t("sectors.table.add.button")}
          </Button>
        </TableCell>
      </TableRow>
      {problem && (
        <TableRow>
          <TableCell colSpan={7} role="alert" className="text-sm text-destructive">
            {problem.kind === "exists" ? t("sectors.table.add.exists", { ticker: problem.ticker }) : t("sectors.table.add.invalidScore")}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
