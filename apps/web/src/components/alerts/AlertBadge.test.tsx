import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { AlertBadge } from "./AlertBadge";

const renderBadge = (count: number) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AlertBadge count={count} />
    </I18nextProvider>,
  );

describe("AlertBadge", () => {
  it("renders nothing at zero", () => {
    const { container } = renderBadge(0);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count with its accessible label, in the warning colors", () => {
    renderBadge(3);
    const badge = screen.getByLabelText("3 alertes déclenchées");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveClass("bg-warning", "text-warning-foreground");
  });
});
