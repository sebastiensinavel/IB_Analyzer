from ninja import Schema


class AcceptInvitationIn(Schema):
    token: str
    password: str


class SessionUserOut(Schema):
    """Opaque and stable. The browser keys nothing local on it: since sub-project 25 the
    IndexedDB database belongs to the browser, not to the account."""

    id: str
    email: str


class ErrorOut(Schema):
    code: str
    detail: str
