import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { Strategy } from "@ib/ledger";
import i18n from "@/i18n";
import { StrategyStack } from "@/components/history/StrategyStack";

afterEach(cleanup);

function renderStack(strategies: readonly Strategy[]) {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <StrategyStack strategies={strategies} />
    </I18nextProvider>,
  );
  return container.firstElementChild as HTMLElement;
}

/** The text of each line of the stack, top to bottom. */
function lines(stack: HTMLElement): string[] {
  return [...stack.children].map((line) => line.textContent ?? "");
}

describe("StrategyStack", () => {
  it("stacks two strategies one under the other", () => {
    const stack = renderStack(["wheel", "others"]);
    expect(lines(stack)).toEqual(["Wheel", "Autres"]);
    expect(stack).toHaveAttribute("title", "Wheel, Autres");
  });

  it("keeps a single strategy on one line", () => {
    expect(lines(renderStack(["condors"]))).toEqual(["Condors"]);
  });

  it("shows two lines at most: the second badge then how many more, all of them in the title", () => {
    const stack = renderStack(["wheel", "leaps", "others"]);
    expect(lines(stack)).toEqual(["Wheel", "LEAPS+1"]);
    expect(stack).toHaveAttribute("title", "Wheel, LEAPS, Autres");
  });

  it("uses the compact badge, two of which fit in a row of the history", () => {
    const badge = renderStack(["wheel"]).querySelector("span");
    expect(badge?.className).toContain("h-4");
  });
});
