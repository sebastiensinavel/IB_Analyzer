import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { uncovered } from "@ib/coverage";
import { db } from "@/db/schema";
import { AccountDataProvider, useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

/** Renders the message of the error its child threw, instead of the child. */
class Catch extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ?? this.props.children;
  }
}

function JournalsOnly() {
  useAccountJournals();
  return null;
}

function RiskOnly() {
  useAccountRiskReport();
  return null;
}

function Probe() {
  const journals = useAccountJournals();
  const { report } = useAccountRiskReport();
  if (journals.status === "loading" || report === undefined) return <p>loading</p>;
  const asOf = journals.report.reconciliation.asOf ?? "no snapshot";
  const naked = report === null ? "no report" : `${uncovered(report).length} uncovered`;
  return <p>{`${asOf} / ${journals.report.rows.length} rows / ${naked}`}</p>;
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.contracts.clear()]);
});

describe("AccountDataProvider", () => {
  it("refuses to be read outside the provider, rather than replaying the ledger a second time", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <Catch>
          <JournalsOnly />
        </Catch>
        <Catch>
          <RiskOnly />
        </Catch>
      </>,
    );
    // Both `Catch` instances render a bare string, so their text nodes land as direct
    // siblings under the same container with no separator: RTL's getNodeText joins only
    // an element's own child text nodes, so the container's text is their concatenation.
    // A substring match still proves each hook threw its own distinct message.
    expect(screen.getByText("useAccountJournals must be used inside <AccountDataProvider>", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("useAccountRiskReport must be used inside <AccountDataProvider>", { exact: false })).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("serves its own account's journals and risk report, and follows the base", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    // alpha's snapshot: beta's provider must not see it.
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    render(
      <AccountDataProvider accountId="beta">
        <Probe />
      </AccountDataProvider>,
    );
    expect(await screen.findByText(/^no snapshot \/ [1-9]\d* rows \/ no report$/)).toBeInTheDocument();
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    expect(await screen.findByText(/^2026-09-02 \/ [1-9]\d* rows \/ 0 uncovered$/)).toBeInTheDocument();
  });
});
