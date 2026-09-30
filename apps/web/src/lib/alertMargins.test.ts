import { describe, expect, it } from "vitest";
import { alertMargins } from "./alertMargins";

describe("alertMargins", () => {
  it("rend les défauts du paquet sans réglage ni compte", () => {
    expect(alertMargins(undefined)).toEqual({ wheel: 0.7, condor: 0.15 });
    expect(alertMargins(null)).toEqual({ wheel: 0.7, condor: 0.15 });
    expect(alertMargins({})).toEqual({ wheel: 0.7, condor: 0.15 });
  });
  it("complète un réglage partiel", () => {
    expect(alertMargins({ alertMargins: { wheel: 0.5 } })).toEqual({ wheel: 0.5, condor: 0.15 });
    expect(alertMargins({ alertMargins: { condor: 0.3 } })).toEqual({ wheel: 0.7, condor: 0.3 });
  });
});
