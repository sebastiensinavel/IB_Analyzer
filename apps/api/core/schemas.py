from ninja import Schema


class AcceptInvitationIn(Schema):
    token: str
    password: str


class SessionUserOut(Schema):
    """The browser keys its local profile on `id`: it must be stable and opaque."""

    id: str
    email: str


class ErrorOut(Schema):
    code: str
    detail: str
