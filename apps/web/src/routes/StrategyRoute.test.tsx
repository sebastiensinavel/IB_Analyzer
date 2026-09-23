import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { StrategyRoute } from "@/routes/StrategyRoute";
import { WithAccountData } from "@/test/WithAccountData";

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/accounts/:accountId"
            element={
              <WithAccountData>
                <Outlet />
              </WithAccountData>
            }
          >
            <Route path="dashboard" element={<div>dashboard content</div>} />
            <Route
              path="journal/leaps"
              element={
                <StrategyRoute strategy="leaps">
                  <div>leaps journal</div>
                </StrategyRoute>
              }
            />
            <Route
              path="journal/others"
              element={
                <StrategyRoute strategy="others">
                  <div>others journal</div>
                </StrategyRoute>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const account = (id: string, ib: string) => ({ id, label: id, ibAccountId: ib, createdAt: "", warnedDroppedKinds: [] });

beforeEach(async () => {
  await db.accounts.clear();
});

describe("StrategyRoute", () => {
  it("sends an inactive strategy's page to the account's dashboard", async () => {
    await db.accounts.put(account("alpha", "U0000001"));
    renderAt("/accounts/alpha/journal/leaps");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
    expect(screen.queryByText("leaps journal")).not.toBeInTheDocument();
  });

  it("shows the page when the strategy is active", async () => {
    await db.accounts.put({ ...account("alpha", "U0000001"), strategies: ["leaps"] });
    renderAt("/accounts/alpha/journal/leaps");
    expect(await screen.findByText("leaps journal")).toBeInTheDocument();
  });

  it("always shows Others, which is never one of the active strategies", async () => {
    await db.accounts.put({ ...account("alpha", "U0000001"), strategies: [] });
    renderAt("/accounts/alpha/journal/others");
    expect(await screen.findByText("others journal")).toBeInTheDocument();
  });

  it("decides nothing before the account record is read: no redirect fires ahead of it", async () => {
    renderAt("/accounts/alpha/journal/leaps");
    await db.accounts.put({ ...account("alpha", "U0000001"), strategies: ["leaps"] });
    expect(await screen.findByText("leaps journal")).toBeInTheDocument();
  });
});
