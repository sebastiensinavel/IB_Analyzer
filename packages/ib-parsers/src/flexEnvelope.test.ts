import { describe, expect, it } from "vitest";
import { parseFlexSendRequest, parseFlexStatementEnvelope } from "./flexEnvelope.ts";

const SUCCESS = `<?xml version="1.0"?>
<FlexStatementResponse timestamp="04 September, 2026 08:00 AM EDT">
  <Status>Success</Status>
  <ReferenceCode>1234567890</ReferenceCode>
  <Url>https://ndcdyn.interactivebrokers.com/x</Url>
</FlexStatementResponse>`;

const FAIL = `<?xml version="1.0"?>
<FlexStatementResponse>
  <Status>Fail</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;

const STATEMENT = `<?xml version="1.0"?>
<FlexQueryResponse queryName="Activity" type="AF">
  <FlexStatements count="1"><FlexStatement accountId="U1234567" fromDate="20250904" toDate="20260903"/></FlexStatements>
</FlexQueryResponse>`;

describe("parseFlexSendRequest", () => {
  it("reads the reference code of a success", () => {
    expect(parseFlexSendRequest(SUCCESS)).toEqual({ status: "success", referenceCode: "1234567890" });
  });

  it("reads the code and the message of a failure", () => {
    expect(parseFlexSendRequest(FAIL)).toEqual({
      status: "error",
      errorCode: "1019",
      errorMessage: "Statement generation in progress. Please try again shortly.",
    });
  });

  it("reports an error rather than throwing on a body that is not XML at all", () => {
    const result = parseFlexSendRequest("<html><body>502 Bad Gateway</body></html>");
    expect(result.status).toBe("error");
  });
});

describe("parseFlexStatementEnvelope", () => {
  it("says ready on an actual statement without parsing it", () => {
    expect(parseFlexStatementEnvelope(STATEMENT)).toEqual({ status: "ready" });
  });

  it("reads the error of a failure envelope", () => {
    expect(parseFlexStatementEnvelope(FAIL)).toEqual({
      status: "error",
      errorCode: "1019",
      errorMessage: "Statement generation in progress. Please try again shortly.",
    });
  });

  it("does not mistake a success envelope for a statement", () => {
    expect(parseFlexStatementEnvelope(SUCCESS).status).toBe("error");
  });
});
