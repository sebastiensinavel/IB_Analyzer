import { describe, expect, it } from "vitest";
import { buildRiskReport } from "@ib/coverage";
import type { Reconciliation } from "@ib/ledger";
import type { JournalsView } from "@/db/hooks";
import { coverageVerdict, reconstitutionVerdict } from "@/lib/consistency";
import { SAMPLE_POSITIONS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function ready(reconciliation: Reconciliation): JournalsView {
  return { status: "ready", report: { rows: [], reconciliation, stats: { wheel: [], leaps: [], condors: [], portfolio: [] }, capital: { wheel: [], leaps: [], condors: [], portfolio: [] } }, identityIssues: [] };
}

const PUT = { ticker: "MQZA", secType: "OPT", right: "P" as const, strike: 17, expiry: "2026-10-02", currency: "USD" };
const DIFFERENCE = { contract: PUT, label: "MQZA Oct02'26 17 Put", ledgerQty: -3, snapshotQty: -2 };
const ORPHAN = { id: "o" } as Reconciliation["orphans"][number];

describe("coverageVerdict", () => {
  it("is unknown and loading while the snapshot has not been read", () => {
    expect(coverageVerdict(undefined)).toEqual({ status: "unknown", loading: true, uncovered: 0 });
  });

  it("is unknown, not loading, without a snapshot", () => {
    expect(coverageVerdict(null)).toEqual({ status: "unknown", loading: false, uncovered: 0 });
  });

  it("alerts on an uncovered position, and counts them", () => {
    expect(coverageVerdict(buildRiskReport(SAMPLE_SNAPSHOT.positions, SAMPLE_SNAPSHOT.cashAvailable))).toEqual({
      status: "alert",
      loading: false,
      uncovered: 1,
    });
  });

  it("is ok when nothing is uncovered", () => {
    expect(coverageVerdict(buildRiskReport([SAMPLE_POSITIONS[5]], 42000))).toEqual({ status: "ok", loading: false, uncovered: 0 });
  });
});

describe("reconstitutionVerdict", () => {
  it("is unknown and loading while the journals are computed", () => {
    expect(reconstitutionVerdict({ status: "loading" })).toEqual({ status: "unknown", loading: true, gaps: 0, asOf: null });
  });

  it("is unknown without a snapshot, whatever orphans the replay found", () => {
    expect(reconstitutionVerdict(ready({ asOf: null, differences: [], orphans: [ORPHAN] }))).toEqual({
      status: "unknown",
      loading: false,
      gaps: 0,
      asOf: null,
    });
  });

  it("is ok when the replay matches the snapshot exactly", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-02", differences: [], orphans: [] }))).toEqual({
      status: "ok",
      loading: false,
      gaps: 0,
      asOf: "2026-09-02",
    });
  });

  it("alerts on a difference", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-02", differences: [DIFFERENCE], orphans: [] }))).toMatchObject({ status: "alert", gaps: 1 });
  });

  it("alerts on an orphan alone, as the card leaves its matching state for one", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-02", differences: [], orphans: [ORPHAN] }))).toMatchObject({ status: "alert", gaps: 1 });
  });

  it("counts differences and orphans together", () => {
    expect(reconstitutionVerdict(ready({ asOf: "2026-09-06T13:02:00.000Z", differences: [DIFFERENCE], orphans: [ORPHAN] }))).toEqual({
      status: "alert",
      loading: false,
      gaps: 2,
      asOf: "2026-09-06T13:02:00.000Z",
    });
  });
});
