/// <reference types="node" />
// The real file, on the author's machine only: proves the anonymization hid no defect.
// The IB account id is read from the file itself, never written here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJournals, NO_IDENTITIES } from "@ib/ledger";
import { parseFlexXml } from "./flex.ts";
import { betaFlex } from "./privateFiles.ts";

const PRIVATE_PATH = betaFlex()?.path ?? "";

// Vitest still runs a skipped describe's factory body, so any I/O must happen
// inside the it() itself: reading PRIVATE_PATH here would throw ENOENT on any
// clone without private/, defeating the skipIf guard below.
describe.skipIf(PRIVATE_PATH === "")("the journals engine on the real Flex of beta", () => {
  it("replays the ledger back to the snapshot: zero difference, zero orphan", () => {
    const xml = readFileSync(PRIVATE_PATH, "utf8");
    const ibAccountId = /accountId="([^"]+)"/.exec(xml)?.[1] ?? "";
    const result = parseFlexXml(xml, { accountId: "beta", ibAccountId });
    const report = buildJournals(result.transactions, result.snapshot ?? undefined);

    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);

    // The Flex of beta carries no conid on its trades and no corporate
    // action: the identity table is empty, so the report must be byte-for-byte
    // the one built without it (global constraint of sub-project 7).
    expect(report).toEqual(buildJournals(result.transactions, result.snapshot ?? undefined, NO_IDENTITIES));
  });
});
