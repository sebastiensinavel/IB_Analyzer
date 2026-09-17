import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { ConsistencyPage } from "@/pages/ConsistencyPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderConsistency(accountId: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/consistency`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/consistency"
            element={
              <WithAccountData>
                <ConsistencyPage />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.cashPoints.clear(), db.contracts.clear(), db.accounts.clear()]);
});

describe("ConsistencyPage", () => {
  it("stacks the three checks in order under its title", async () => {
    renderConsistency("alpha");
    const uncovered = await screen.findByLabelText("Positions non couvertes");
    const reconciliation = screen.getByLabelText("Reconstitution du portefeuille");
    const cash = screen.getByLabelText("Cohérence du cash");
    expect(screen.getByRole("heading", { level: 1, name: "Consistance" })).toBeInTheDocument();
    expect(uncovered.compareDocumentPosition(reconciliation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reconciliation.compareDocumentPosition(cash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists the positions the snapshot leaves uncovered", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Positions non couvertes");
    expect(within(card).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
  });

  it("shows no snapshot and no badge in the uncovered card on an empty base", async () => {
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Positions non couvertes");
    expect(await within(card).findByText(/Aucun snapshot de positions/)).toBeInTheDocument();
    expect(within(card).queryByText("0")).not.toBeInTheDocument();
  });

  it("carries the reconciliation in its three states, following the base", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderConsistency("beta");
    expect(await screen.findByText("Portefeuille reconstitué conforme au snapshot du 2026-09-02")).toBeInTheDocument();
    await db.snapshots.put({ ...SAMPLE_JOURNAL_SNAPSHOT, positions: SAMPLE_JOURNAL_SNAPSHOT.positions.slice(1) });
    expect(await screen.findByText("MQZA : ledger 200, snapshot 0")).toBeInTheDocument();
    await db.snapshots.clear();
    const card = screen.getByLabelText("Reconstitution du portefeuille");
    expect(await within(card).findByText(/Aucun snapshot de positions/)).toBeInTheDocument();
  });

  it("checks the cash against the Cash Report", async () => {
    await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS);
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Cohérence du cash");
    expect(within(card).getByText("USD : solde calé sur le cash de fin du 2026-12-31 (1,456.85), début non vérifié")).toBeInTheDocument();
    expect(within(card).getByText("EUR : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
  });

  it("shows the cash check even on an empty ledger", async () => {
    renderConsistency("alpha");
    const card = await screen.findByLabelText("Cohérence du cash");
    expect(within(card).getByText("USD : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
    expect(within(card).getByText("EUR : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
  });
});
