import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { RootRedirect } from "@/routes/RootRedirect";

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderRoot() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const account = (id: string) => ({ id, label: id, ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });

beforeEach(async () => {
  window.localStorage.clear();
  await db.accounts.clear();
});

describe("RootRedirect", () => {
  it("goes to the accounts page when there is no account", async () => {
    renderRoot();
    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts");
  });

  it("goes to the last visited account, else the first one", async () => {
    await db.accounts.bulkAdd([account("a"), account("b")]);
    window.localStorage.setItem("ib2:lastAccountId", "b");
    renderRoot();
    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts/b/dashboard");
  });

  it("ignores a remembered account that no longer exists", async () => {
    await db.accounts.bulkAdd([account("a")]);
    window.localStorage.setItem("ib2:lastAccountId", "gone");
    renderRoot();
    expect(await screen.findByTestId("location")).toHaveTextContent("/accounts/a/dashboard");
  });
});
