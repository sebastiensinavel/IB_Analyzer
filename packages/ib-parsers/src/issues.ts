import type { Transaction } from "@ib/ledger";

export type ParseIssueCode =
  | "account-mismatch"
  | "section-missing"
  | "section-unread"
  | "column-missing"
  | "currency-missing"
  | "unknown-cash-type"
  | "unknown-asset-category"
  | "row-skipped"
  | "normalization"
  | "multiplier-missing";

export interface ParseIssue {
  /** An error empties the result: nothing of the file may be written. */
  severity: "error" | "warning";
  code: ParseIssueCode;
  /** Technical detail, IB's own section and column names, shown as is. */
  detail: string;
}

export interface ParseTarget {
  /** Slug of the account the rows are written to. */
  accountId: string;
  /** IB account id the file must belong to, e.g. "U1234567". */
  ibAccountId: string;
}

export interface ParseResult<S> {
  transactions: Transaction[];
  /** What the file says about itself; `null` when it is not even the right kind of file. */
  statement: S | null;
  issues: ParseIssue[];
}

export function hasErrors(issues: readonly ParseIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function warning(code: ParseIssueCode, detail: string): ParseIssue {
  return { severity: "warning", code, detail };
}

export function error(code: ParseIssueCode, detail: string): ParseIssue {
  return { severity: "error", code, detail };
}
