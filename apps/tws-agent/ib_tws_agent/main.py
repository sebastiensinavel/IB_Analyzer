"""The HTTP face of the agent. Raw ib_async data out, nothing stored, nothing computed.

Every JSON field carries the name of the ib_async attribute it comes from, unconverted:
`lastTradeDateOrContractMonth` stays "20261218", `multiplier` stays a string, an option's
`averageCost` stays per contract, a commission stays positive. The browser's parser
(packages/ib-parsers/src/agent.ts) does every conversion, and is where they are tested.
The one exception is `cashAvailable` (see `extract_usd_cash`). The per-position `pnl` is the
same story: `dailyPnL` and `value` pass through as `PnLSingle` names them, and the browser
derives the day's percentage move from them (§4 of the design doc); the agent computes
nothing.

It also relays the two Flex Web Service calls, bytes untouched.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from contextlib import suppress
from datetime import datetime, timezone
from importlib.metadata import version as package_version
from math import isnan
from time import monotonic
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Query
from fastapi.responses import JSONResponse, Response
from ib_async import IB, Stock
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Config
from .cors import OriginMiddleware
from .flex import FlexTimeout, FlexUnreachable, call_flex

logger = logging.getLogger(__name__)

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
# How long /snapshot waits, in all, for TWS's first per-position P&L message. Measured against a
# real TWS: the last of 78 positions answered in 2.32 s. CONNECT_TIMEOUT_S + PNL_TIMEOUT_S stays
# under the browser's AGENT_FETCH_TIMEOUT_MS (15 s).
PNL_TIMEOUT_S = 5
PNL_POLL_S = 0.05
# IB's "no value": DBL_MAX, and the nan ib_async leaves in an object TWS has not filled yet.
UNSET_THRESHOLD = 1e300
CASH_TAGS = ("TotalCashBalance", "CashBalance", "AvailableFunds")
# Defaults of /bars: what a chart of an underlying needs. TRADES is the only series carrying
# volume, and IB adjusts it for splits but not dividends.
BARS_DURATION = "2 Y"
BARS_SIZE = "1 day"
BARS_WHAT_TO_SHOW = "TRADES"


class ReadOnlyIB(IB):
    """An IB that never asks TWS for anything its "Read-Only API" mode refuses.

    With `clientId 0`, ib_async's `connectAsync` binds the orders of the TWS window to the API
    (`reqAutoOpenOrders(True)`), even with `readonly=True`. The agent reads positions and fills,
    never orders, so the binding is skipped here.
    """

    def reqAutoOpenOrders(self, autoBind: bool = True):  # noqa: N802 - ib_async's own naming
        pass


def get_ib_factory() -> Callable[[], IB]:
    """Overridden in tests with a FakeIB factory."""
    return ReadOnlyIB


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


def clean_pnl(value: float | None) -> float | None:
    """A value IB does not have is `None`, never 0.0 — and `nan` is not JSON anyway."""
    if value is None or isnan(value) or abs(value) >= UNSET_THRESHOLD:
        return None
    return value


def serialize_position(item: Any, pnl: Any | None) -> dict[str, Any]:
    daily = clean_pnl(getattr(pnl, "dailyPnL", None)) if pnl is not None else None
    value = clean_pnl(getattr(pnl, "value", None)) if pnl is not None else None
    return {
        **serialize_contract(item.contract),
        "position": item.position,
        "averageCost": item.averageCost,
        "marketPrice": item.marketPrice,
        "marketValue": item.marketValue,
        "unrealizedPNL": item.unrealizedPNL,
        # Both from the same PnLSingle message, so their ratio is coherent — `marketValue` above
        # comes from updatePortfolio, at another instant. `None` when TWS said nothing in time.
        "pnl": None if daily is None else {"dailyPnL": daily, "value": value},
    }


def serialize_bar(bar: Any) -> dict[str, Any]:
    """One candle, raw. `date` is what ib_async gives - a `date` for daily bars, a `datetime`
    for intraday ones - and is only stringified here; the browser reads it."""
    return {
        "date": bar.date.isoformat(),
        "open": bar.open,
        "high": bar.high,
        "low": bar.low,
        "close": bar.close,
        "volume": float(bar.volume),
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


async def collect_pnl(ib: IB, items: Iterable[Any]) -> dict[int, Any]:
    """Subscribe to each position's P&L, wait for TWS's first values, cancel, and hand them back.

    Never raises: the day's values are a bonus, and the snapshot is due whatever TWS does with
    them. A contract TWS stays silent about is simply absent from the result.
    """
    entries: dict[int, Any] = {}
    keys: list[tuple[str, int]] = []
    try:
        keys = [(item.account, item.contract.conId) for item in items]
        for account, con_id in keys:
            entries[con_id] = ib.reqPnLSingle(account, "", con_id)
        deadline = monotonic() + PNL_TIMEOUT_S
        while monotonic() < deadline and any(clean_pnl(e.dailyPnL) is None for e in entries.values()):
            await asyncio.sleep(PNL_POLL_S)
    except Exception:  # noqa: BLE001 - whatever ib_async raises, the snapshot is still due
        logger.warning("per-position P&L unavailable; the snapshot goes out without it", exc_info=True)
    finally:
        for account, con_id in keys:
            with suppress(Exception):
                ib.cancelPnLSingle(account, "", con_id)
    return entries


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
            # readonly: otherwise ib_async requests the open and completed orders, which a TWS
            # in "Read-Only API" mode refuses with an error 321 on every sync.
            await ib.connectAsync(IB_HOST, port, clientId=CLIENT_ID, timeout=CONNECT_TIMEOUT_S, readonly=True)
        except Exception as exc:  # noqa: BLE001 - whatever ib_async raises, the answer is the same
            ib.disconnect()
            return JSONResponse(
                status_code=503,
                content={"code": "tws-unreachable", "detail": f"{type(exc).__name__}: {exc}"},
            )
        try:
            items = ib.portfolio()
            pnl = await collect_pnl(ib, items)
            return {
                "accounts": ib.managedAccounts(),
                "fetchedAt": utc_now_iso(),
                "cashAvailable": extract_usd_cash(ib.accountValues()),
                "positions": [serialize_position(item, pnl.get(item.contract.conId)) for item in items],
                "executions": [serialize_execution(fill) for fill in ib.fills()],
            }
        finally:
            ib.disconnect()

    @app.get("/bars")
    async def bars(
        port: Annotated[int, Query(ge=1, le=65535)],
        symbol: Annotated[str, Query(min_length=1, max_length=24)],
        duration: Annotated[str, Query(max_length=16)] = BARS_DURATION,
        barSize: Annotated[str, Query(max_length=16)] = BARS_SIZE,
        currency: Annotated[str, Query(min_length=1, max_length=8)] = "USD",
        ib_factory: Callable[[], IB] = Depends(get_ib_factory),
    ):
        """Historical bars of one underlying. Options are out of scope on purpose: IB keeps no
        end-of-day data for them, and none at all once they expire."""
        ib = ib_factory()
        try:
            await ib.connectAsync(IB_HOST, port, clientId=CLIENT_ID, timeout=CONNECT_TIMEOUT_S, readonly=True)
        except Exception as exc:  # noqa: BLE001 - whatever ib_async raises, the answer is the same
            ib.disconnect()
            return JSONResponse(
                status_code=503,
                content={"code": "tws-unreachable", "detail": f"{type(exc).__name__}: {exc}"},
            )
        try:
            rows = await ib.reqHistoricalDataAsync(
                Stock(symbol.upper(), "SMART", currency.upper()),
                endDateTime="",
                durationStr=duration,
                barSizeSetting=barSize,
                whatToShow=BARS_WHAT_TO_SHOW,
                useRTH=True,
                formatDate=1,
            )
            # An empty list is TWS's answer for an unknown symbol, a missing market data
            # subscription or a pacing violation alike: the browser shows "no data", never an error.
            return {"symbol": symbol.upper(), "fetchedAt": utc_now_iso(), "bars": [serialize_bar(bar) for bar in rows]}
        finally:
            ib.disconnect()

    @app.post("/flex/send-request")
    async def flex_send_request(payload: SendRequestIn, caller: FlexCaller = Depends(get_flex_caller)) -> Response:
        return await relay_flex(caller, "SendRequest", {"t": payload.token, "q": payload.queryId})

    @app.post("/flex/get-statement")
    async def flex_get_statement(payload: GetStatementIn, caller: FlexCaller = Depends(get_flex_caller)) -> Response:
        return await relay_flex(caller, "GetStatement", {"t": payload.token, "q": payload.referenceCode})

    return app
