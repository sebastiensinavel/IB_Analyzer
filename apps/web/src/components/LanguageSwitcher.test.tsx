import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

describe("LanguageSwitcher", () => {
  afterEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("switches i18n's active language to English when selected", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("English"));

    expect(i18n.language).toBe("en");
  });

  it("shows the translated label, not the raw language code, on the closed trigger", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Français");
    expect(trigger).not.toHaveTextContent("fr");
  });
});
