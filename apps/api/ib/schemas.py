from ninja import Schema


class SendRequestIn(Schema):
    token: str
    queryId: str  # noqa: N815 — matches the browser payload and IB's own naming


class GetStatementIn(Schema):
    token: str
    referenceCode: str  # noqa: N815
