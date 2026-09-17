"""The HTTP face of the agent. Raw ib_async data out, nothing stored, nothing computed.

Every JSON field carries the name of the ib_async attribute it comes from, unconverted:
`lastTradeDateOrContractMonth` stays "20261218", `multiplier` stays a string, an option's
`averageCost` stays per contract, a commission stays positive. The browser's parser
(packages/ib-parsers/src/agent.ts) does every conversion, and is where they are tested.
The one exception is `cashAvailable` (see `extract_usd_cash`).

It also relays the two Flex Web Service calls, bytes untouched.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from datetime import datetime, timezone
from importlib.metadata import version as package_version
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Query
from fastapi.responses import JSONResponse, Response
from ib_async import IB
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Config
from .cors import OriginMiddleware
from .flex import FlexTimeout, FlexUnreachable, call_flex

# Only 127.0.0.1 and localhost ever legitimately reach this agent: it listens on the loopback
# interface for a reason. Without this check, a page served from an attacker-controlled domain
# whose DNS resolves to 127.0.0.1 ("DNS rebinding") is same-origin as far as the browser is
# concerned - no Origin header is sent at all, so OriginMiddleware's check never even runs -
# and the response reaches the page regardless of any Access-Control-Allow-Origin header.
# TrustedHostMiddleware strips the ":port" before comparing, so no port handling is needed
# here. Do not remove this as "redundant" with OriginMiddleware: they defend different attacks
# (cross-origin fetch vs. same-origin-by-DNS-trickery), and only this one stops the second.
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

IB_HOST = "127.0.0.1"
CLIENT_ID = 0  # Mandatory to see the orders placed from the TWS window itself (spec fondateur §3.4).
CONNECT_TIMEOUT_S = 5
CASH_TAGS = ("TotalCashBalance", "CashBalance", "AvailableFunds")


def get_ib_factory() -> Callable[[], IB]:
    """Overridden in tests with a FakeIB factory."""
    return IB


FlexCaller = Callable[[str, dict[str, str]], Awaitable[tuple[bytes, str]]]

TIMEOUT_BODY = {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}
UNREACHABLE_BODY = {"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}


def get_flex_caller() -> FlexCaller:
    """Overridden in tests: no test ever reaches Interactive Brokers."""
    return call_flex


class SendRequestIn(BaseModel):
    token: str = Field(min_length=1)
    queryId: str = Field(min_length=1)  # noqa: N815 - the browser's and IB's own naming


class GetStatementIn(BaseModel):
    token: str = Field(min_length=1)
    referenceCode: str = Field(min_length=1)  # noqa: N815


async def relay_flex(caller: FlexCaller, endpoint: str, params: dict[str, str]) -> Response:
    """IB's bytes and content-type pass through untouched, `Fail` answers included: the browser
    parses them. The token travels in the request body, never in this agent's URL, because
    uvicorn's access log writes the query string."""
    try:
        content, content_type = await caller(endpoint, params)
    except FlexTimeout:
        return JSONResponse(status_code=504, content=TIMEOUT_BODY)
    except FlexUnreachable:
        return JSONResponse(status_code=502, content=UNREACHABLE_BODY)
    # A `content-type` header, not `media_type`: Starlette would append a charset to text/*.
    return Response(content=content, headers={"content-type": content_type})


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def to_utc_isoformat(dt: datetime) -> str:
    """`ib_async` attaches UTC to `execution.time`, but nothing in its API enforces that. The
    TS parser reads an offset-less string as *local* time (`new Date(str)`), and that instant
    then feeds `planAgent`'s strict comparison against Flex's bound - a naive datetime must
    never be assumed local here. A naive value is taken to already be the UTC `ib_async`
    promises and is only labelled; an aware one is actually converted.
    """
    return (dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()


def extract_usd_cash(account_values: Iterable[Any]) -> float | None:
    """The USD `TotalCashBalance`: the same figure as Flex's Cash Report `endingCash` and as
    the history's reconciliation oracle. IB repeats each tag per account and per model, so
    model rows are skipped and values are collapsed per account before being summed; the
    first tag that yields anything wins, to avoid double counting. `None`, never 0.0, when
    nothing yields: unknown is not zero.
    """
    for tag in CASH_TAGS:
        per_account: dict[str, float] = {}
        for value in account_values:
            if getattr(value, "tag", None) != tag:
                continue
            if (getattr(value, "currency", "") or "").upper() != "USD":
                continue
            if getattr(value, "modelCode", "") or "":
                continue
            try:
                per_account[getattr(value, "account", "")] = float(value.value)
            except (TypeError, ValueError):
                continue
        if per_account:
            return sum(per_account.values())
    return None


def serialize_contract(contract: Any) -> dict[str, Any]:
    return {
        "conId": contract.conId,
        "symbol": contract.symbol,
        "localSymbol": contract.localSymbol,
        "secType": contract.secType,
        "right": contract.right,
        "strike": contract.strike,
        "lastTradeDateOrContractMonth": contract.lastTradeDateOrContractMonth,
        "multiplier": contract.multiplier,
        "currency": contract.currency,
    }


def serialize_position(item: Any) -> dict[str, Any]:
    return {
        **serialize_contract(item.contract),
        "position": item.position,
        "averageCost": item.averageCost,
        "marketPrice": item.marketPrice,
        "marketValue": item.marketValue,
        "unrealizedPNL": item.unrealizedPNL,
    }


def serialize_execution(fill: Any) -> dict[str, Any]:
    execution = fill.execution
    report = fill.commissionReport
    # IB sends the commission report a moment after the fill: until then there is no report,
    # and no report means `None`, never 0.0.
    has_report = bool(report.execId)
    return {
        "execId": execution.execId,
        "time": to_utc_isoformat(execution.time),
        "acctNumber": execution.acctNumber,
        "side": execution.side,
        "shares": execution.shares,
        "price": execution.price,
        "cumQty": execution.cumQty,
        "avgPrice": execution.avgPrice,
        "orderRef": execution.orderRef,
        "contract": serialize_contract(fill.contract),
        "commission": report.commission if has_report else None,
        "commissionCurrency": report.currency if has_report else None,
    }


def create_app(config: Config) -> FastAPI:
    app = FastAPI(title="ib-tws-agent", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(OriginMiddleware, origins=config.origins)
    # Added last so it runs first (Starlette wraps in reverse order of add_middleware calls):
    # a request with a spoofed Host is rejected before OriginMiddleware even looks at it.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

    @app.get("/health")
    async def health() -> dict[str, str]:
        # The detection ping: free, TWS is never touched here.
        return {"version": package_version("ib-tws-agent")}

    @app.get("/snapshot")
    async def snapshot(
        port: Annotated[int, Query(ge=1, le=65535)],
        ib_factory: Callable[[], IB] = Depends(get_ib_factory),
    ):
        # One connection per call, closed whatever happens: TWS restarts nightly and loses its
        # session, so the agent never holds a connection (spec fondateur §3.4).
        ib = ib_factory()
        try:
            await ib.connectAsync(IB_HOST, port, clientId=CLIENT_ID, timeout=CONNECT_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - whatever ib_async raises, the answer is the same
            ib.disconnect()
            return JSONResponse(
                status_code=503,
                content={"code": "tws-unreachable", "detail": f"{type(exc).__name__}: {exc}"},
            )
        try:
            return {
                "accounts": ib.managedAccounts(),
                "fetchedAt": utc_now_iso(),
                "cashAvailable": extract_usd_cash(ib.accountValues()),
                "positions": [serialize_position(item) for item in ib.portfolio()],
                "executions": [serialize_execution(fill) for fill in ib.fills()],
            }
        finally:
            ib.disconnect()

    @app.post("/flex/send-request")
    async def flex_send_request(payload: SendRequestIn, caller: FlexCaller = Depends(get_flex_caller)) -> Response:
        return await relay_flex(caller, "SendRequest", {"t": payload.token, "q": payload.queryId})

    @app.post("/flex/get-statement")
    async def flex_get_statement(payload: GetStatementIn, caller: FlexCaller = Depends(get_flex_caller)) -> Response:
        return await relay_flex(caller, "GetStatement", {"t": payload.token, "q": payload.referenceCode})

    return app
