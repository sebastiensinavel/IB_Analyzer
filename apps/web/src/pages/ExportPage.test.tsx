import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position } from "@ib/ledger";
import { db, type AccountRecord } from "@/db/schema";
import { NAV_SECTIONS } from "@/lib/navigation";
import { ExportPage } from "./ExportPage";

const account = (id: string): AccountRecord => ({
  id, label: id, ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [],
});

const stock = (symbol: string, quantity: number): Position => ({
  symbol, secType: "STK", right: "", strike: null, expiry: null, multiplier: null, quantity, avgPrice: null, marketPrice: null,
  marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "",
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("ExportPage", () => {
  it("shows every account's held tickers as a TradingView list and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    await db.snapshots.bulkPut([
      { accountId: "alpha", source: "flex", asOf: "2026-10-28", importedAt: "", positions: [stock("MSFT", 10)], cashAvailable: null },
      { accountId: "beta", source: "flex", asOf: "2026-10-28", importedAt: "", positions: [stock("AAPL", 5), stock("MSFT", 1)], cashAvailable: null },
    ]);
    render(<ExportPage />);
    const list = await screen.findByLabelText("Liste de surveillance TradingView");
    expect(list.textContent).toBe("AAPL,MSFT");
    await userEvent.click(screen.getAllByRole("button", { name: "Copier" })[0]);
    expect(writeText).toHaveBeenCalledWith("AAPL,MSFT");
  });

  it("says there is nothing to export without any position", async () => {
    render(<ExportPage />);
    expect(await screen.findByText(/Aucun titre détenu/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun niveau à tracer/)).toBeInTheDocument();
  });

  it("sits just above Settings in the Configuration section, reachable without an account", () => {
    const configuration = NAV_SECTIONS.find((section) => section.labelKey === "nav.sections.configuration")!;
    const keys = configuration.items.map((item) => item.labelKey);
    expect(keys.indexOf("nav.export")).toBe(keys.indexOf("nav.settings") - 1);
    const entry = configuration.items.find((item) => item.labelKey === "nav.export")!;
    expect(entry.accountScoped).toBe(false);
    expect(entry.to("alpha")).toBe("/export");
  });
});
