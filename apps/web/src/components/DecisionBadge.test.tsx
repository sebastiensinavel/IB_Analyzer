import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DecisionBadge } from "@/components/DecisionBadge";

const timed = { decision: "keep" as const, threshold: 0.42, remainingDays: 11.6, totalDays: 30.2 };

describe("DecisionBadge", () => {
  it("gives the timed buyback threshold on hover", async () => {
    render(<DecisionBadge decision="keep" advice={timed} currency="USD" />);
    await userEvent.setup().hover(screen.getByText("keep"));
    expect(await screen.findByText("Rachat rentable sous 0.42 USD : 12 j restants sur 30", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("falls back to the premium-share wording without days", async () => {
    render(<DecisionBadge decision="keep" advice={{ decision: "keep", threshold: 0.75, remainingDays: null, totalDays: null }} currency="USD" />);
    await userEvent.setup().hover(screen.getByText("keep"));
    expect(await screen.findByText("Rachat rentable sous 0.75 USD : 40 % de la prime", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("renders nothing without a decision", () => {
    const { container } = render(<DecisionBadge decision={null} advice={null} currency="USD" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the badge without a tooltip when there is no advice", async () => {
    render(<DecisionBadge decision="keep" advice={null} currency="USD" />);
    await userEvent.setup().hover(screen.getByText("keep"));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.getByText("keep")).toBeInTheDocument();
    expect(screen.queryByText(/Rachat rentable/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
