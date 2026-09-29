import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";
import i18n from "@/i18n";
import { ShotFrame } from "@/components/welcome/ShotFrame";

it("shows the shot of the current theme and language, full size in a new tab", async () => {
  await i18n.changeLanguage("en");
  render(<I18nextProvider i18n={i18n}><ShotFrame id="positions" alt="Positions" /></I18nextProvider>);
  const img = screen.getByRole("img", { name: "Positions" });
  expect(img).toHaveAttribute("src", "/welcome/positions.light.en.webp");
  expect(img).toHaveAttribute("width", "1600");
  expect(img).toHaveAttribute("loading", "lazy");
  expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  await i18n.changeLanguage("fr");
});

it("keeps its frame and its text when the image cannot load", () => {
  render(<I18nextProvider i18n={i18n}><ShotFrame id="history" alt="Historique" /></I18nextProvider>);
  fireEvent.error(screen.getByRole("img", { name: "Historique" }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("Historique")).toBeInTheDocument();
  expect(screen.getByTestId("shot-frame")).toBeInTheDocument();
});
