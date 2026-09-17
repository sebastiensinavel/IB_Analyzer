/**
 * The two-step Flex Web Service protocol answers with a small envelope before
 * it answers with a statement. Only the envelope is read here: the statement
 * itself goes to `parseFlexXml` untouched.
 */
export type FlexEnvelope =
  | { status: "success"; referenceCode: string }
  | { status: "ready" }
  | { status: "error"; errorCode: string; errorMessage: string };

const UNREADABLE: FlexEnvelope = {
  status: "error",
  errorCode: "unreadable",
  errorMessage: "The response was not a Flex Web Service envelope.",
};

function text(doc: Document, tag: string): string | null {
  return doc.querySelector(tag)?.textContent?.trim() ?? null;
}

function readError(doc: Document): FlexEnvelope {
  const errorCode = text(doc, "ErrorCode");
  if (errorCode === null) return UNREADABLE;
  return { status: "error", errorCode, errorMessage: text(doc, "ErrorMessage") ?? "" };
}

export function parseFlexSendRequest(xml: string): FlexEnvelope {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return UNREADABLE;
  if (text(doc, "Status") === "Success") {
    const referenceCode = text(doc, "ReferenceCode");
    return referenceCode ? { status: "success", referenceCode } : UNREADABLE;
  }
  return readError(doc);
}

export function parseFlexStatementEnvelope(xml: string): FlexEnvelope {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return UNREADABLE;
  if (doc.querySelector("FlexQueryResponse")) return { status: "ready" };
  return readError(doc);
}
