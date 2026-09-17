import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { ThemeToggle } from "@/components/ThemeToggle";

describe("ThemeToggle", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
  });

  it("toggles the dark class on the html element and persists the choice", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeToggle />
      </I18nextProvider>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("ib2:theme")).toBe("dark");

    await user.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("ib2:theme")).toBe("light");
  });
});
