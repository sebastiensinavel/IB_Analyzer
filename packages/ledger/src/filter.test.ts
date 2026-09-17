import { describe, expect, it } from "vitest";
import { dayOf } from "./filter.ts";

describe("dayOf", () => {
  it("keeps the UTC calendar day of an ISO timestamp", () => {
    expect(dayOf("2026-08-14T16:20:00.000Z")).toBe("2026-08-14");
  });
});
