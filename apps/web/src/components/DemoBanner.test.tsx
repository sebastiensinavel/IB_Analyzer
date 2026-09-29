import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { DbProvider } from "@/db/DbProvider";
import { navigation } from "@/demo/mode";
import { DemoBanner } from "@/components/DemoBanner";

function renderBanner() {
  return render(
    <I18nextProvider i18n={i18n}>
      <DbProvider>
        <DemoBanner />
      </DbProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("DemoBanner", () => {
  it("shows nothing outside the demo", () => {
    renderBanner();
    expect(screen.queryByText("Mode démonstration — données fictives")).toBeNull();
  });

  it("says it is the demo and leaves it to the welcome page", async () => {
    window.sessionStorage.setItem("ib2:demo", "1");
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent("Mode démonstration — données fictives");
    await userEvent.setup().click(screen.getByRole("button", { name: "Quitter la démo" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/welcome"));
  });
});
