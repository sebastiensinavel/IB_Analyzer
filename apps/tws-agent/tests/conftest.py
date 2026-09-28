"""Doubles for ib_async. Duck-typed on purpose, never subclasses of the real classes."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import nan
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ib_tws_agent.config import Config
from ib_tws_agent.main import create_app, get_ib_factory

ORIGIN = "https://app.example"
CONFIG = Config(origins=(ORIGIN,), listen=8100)


@dataclass
class FakeContract:
    conId: int = 0
    symbol: str = "AAPL"
    localSymbol: str = "AAPL"
    secType: str = "STK"
    right: str = ""
    strike: float = 0.0
    lastTradeDateOrContractMonth: str = ""
    multiplier: str = ""
    currency: str = "USD"
    primaryExchange: str = ""


@dataclass
class FakePortfolioItem:
    contract: FakeContract = field(default_factory=FakeContract)
    account: str = "U1234567"
    position: float = 0.0
    marketPrice: float = 0.0
    marketValue: float = 0.0
    averageCost: float = 0.0
    unrealizedPNL: float = 0.0


@dataclass
class FakePnLSingle:
    """ib_async's PnLSingle: nan until TWS fills it in, which the real one does asynchronously."""

    account: str = "U1234567"
    modelCode: str = ""
    conId: int = 0
    dailyPnL: float = nan
    unrealizedPnL: float = nan
    realizedPnL: float = nan
    position: int = 0
    value: float = nan


@dataclass
class FakeAccountValue:
    account: str = "U1234567"
    tag: str = "TotalCashBalance"
    value: str = "0"
    currency: str = "USD"
    modelCode: str = ""


@dataclass
class FakeExecution:
    execId: str = "0000e1a7.68bc1234.01.01"
    acctNumber: str = "U1234567"
    side: str = "BOT"
    shares: float = 1.0
    price: float = 1.0
    cumQty: float = 1.0
    avgPrice: float = 1.0
    orderRef: str = ""
    time: datetime = field(default_factory=lambda: datetime(2026, 9, 6, 14, 31, 2, tzinfo=timezone.utc))


@dataclass
class FakeCommissionReport:
    execId: str = ""
    commission: float = 0.0
    currency: str = ""


@dataclass
class FakeFill:
    contract: FakeContract = field(default_factory=FakeContract)
    execution: FakeExecution = field(default_factory=FakeExecution)
    commissionReport: FakeCommissionReport = field(default_factory=FakeCommissionReport)


@dataclass
class FakeTicker:
    """ib_async's Ticker: nan until TWS fills it in. Only the fields /quotes reads."""

    contract: Any = None
    last: float = nan
    close: float = nan


class FakeIB:
    def __init__(
        self,
        *,
        managed_accounts=None,
        portfolio=None,
        account_values=None,
        fills=None,
        connect_error: Exception | None = None,
        portfolio_error: Exception | None = None,
        pnl=None,
        pnl_error: Exception | None = None,
        bars=None,
        bars_error: Exception | None = None,
        quotes=None,
        quotes_error: Exception | None = None,
        qualifiable: set[str] | None = None,
        primary_exchanges: dict[str, str] | None = None,
        qualify_error: Exception | None = None,
        qualify_delay: float | None = None,
    ):
        self._managed_accounts = managed_accounts if managed_accounts is not None else ["U1234567"]
        self._portfolio = portfolio if portfolio is not None else []
        self._account_values = account_values if account_values is not None else []
        self._fills = fills if fills is not None else []
        self._connect_error = connect_error
        self._portfolio_error = portfolio_error
        # conId -> the FakePnLSingle TWS has already filled in. A conId absent from this mapping
        # is a contract TWS stays silent about: it gets a default, all-nan object.
        self._pnl = pnl if pnl is not None else {}
        self._pnl_error = pnl_error
        self._bars = bars if bars is not None else []
        self._bars_error = bars_error
        self._quotes = quotes if quotes is not None else {}
        self._quotes_error = quotes_error
        # A symbol qualifies (gets a conId and a primaryExchange) when it is in `quotes` - the
        # real TWS knows a symbol it can quote - or explicitly listed here, for a symbol that
        # should qualify but carries no ticker (an unqualifiable ticker has neither).
        self._qualifiable = qualifiable if qualifiable is not None else set()
        self._primary_exchanges = primary_exchanges if primary_exchanges is not None else {}
        self._qualify_error = qualify_error
        # A qualification that never resolves - a real TWS gone silent - within the caller's
        # own timeout, to exercise the asyncio.wait_for cutoff in collect_quotes.
        self._qualify_delay = qualify_delay
        # (contract, kwargs) of every reqHistoricalDataAsync call, in order.
        self.historical_requests: list[tuple] = []
        self.pnl_subscribed: list[tuple[str, str, int]] = []
        self.pnl_cancelled: list[tuple[str, str, int]] = []
        self.connected_to: tuple | None = None
        self.readonly: bool | None = None
        self.disconnected = False
        self.market_data_types: list[int] = []
        self.mkt_subscribed: list[Any] = []
        self.mkt_cancelled: list[Any] = []
        # Each call's contracts, in order, exactly as qualifyContractsAsync received them.
        self.qualify_calls: list[tuple] = []
        self._next_con_id = 1000

    async def connectAsync(self, host, port, clientId=0, timeout=4, readonly=False):
        self.connected_to = (host, port, clientId, timeout)
        self.readonly = readonly
        if self._connect_error is not None:
            raise self._connect_error

    def disconnect(self):
        self.disconnected = True

    def managedAccounts(self):
        return list(self._managed_accounts)

    def portfolio(self):
        if self._portfolio_error is not None:
            raise self._portfolio_error
        return list(self._portfolio)

    def accountValues(self):
        return list(self._account_values)

    def fills(self):
        return list(self._fills)

    def reqPnLSingle(self, account, modelCode, conId):
        if self._pnl_error is not None:
            raise self._pnl_error
        self.pnl_subscribed.append((account, modelCode, conId))
        return self._pnl.get(conId, FakePnLSingle(account=account, conId=conId))

    async def reqHistoricalDataAsync(self, contract, **kwargs):
        self.historical_requests.append((contract, kwargs))
        if self._bars_error is not None:
            raise self._bars_error
        return list(self._bars)

    def cancelPnLSingle(self, account, modelCode, conId):
        self.pnl_cancelled.append((account, modelCode, conId))

    def reqMarketDataType(self, marketDataType):
        self.market_data_types.append(marketDataType)

    async def qualifyContractsAsync(self, *contracts):
        """The real one fills in each contract's `conId` (and, here, `primaryExchange`)
        in place and returns a same-shaped list; an unknown or ambiguous contract keeps
        `conId 0` and gets `None` in its slot. Qualifiable: a symbol in `quotes` - TWS knows
        it well enough to have a price for it - or explicitly listed in `qualifiable`."""
        self.qualify_calls.append(contracts)
        if self._qualify_delay is not None:
            await asyncio.sleep(self._qualify_delay)
        if self._qualify_error is not None:
            raise self._qualify_error
        result: list[Any] = []
        for contract in contracts:
            if contract.symbol in self._quotes or contract.symbol in self._qualifiable:
                contract.conId = self._next_con_id
                self._next_con_id += 1
                contract.primaryExchange = self._primary_exchanges.get(contract.symbol, "NASDAQ")
                result.append(contract)
            else:
                result.append(None)
        return result

    def reqMktData(self, contract, genericTickList="", snapshot=False, regulatorySnapshot=False, mktDataOptions=None):
        if not contract.conId:
            raise ValueError(
                f"Contract {contract} can't be hashed because no 'conId' value exists. "
                "Qualify contract to populate 'conId'."
            )
        if self._quotes_error is not None:
            raise self._quotes_error
        self.mkt_subscribed.append(contract)
        ticker = self._quotes.get(contract.symbol, FakeTicker())
        ticker.contract = contract
        return ticker

    def cancelMktData(self, contract):
        self.mkt_cancelled.append(contract)


@pytest.fixture
def make_client():
    # base_url gives every request a Host of "127.0.0.1", one of TrustedHostMiddleware's two
    # allowed hosts (the default "testserver" is not); a test can still override Host per
    # request to exercise the middleware itself.
    def _make(fake_ib: FakeIB | None = None, config: Config = CONFIG) -> TestClient:
        app = create_app(config)
        if fake_ib is not None:
            app.dependency_overrides[get_ib_factory] = lambda: (lambda: fake_ib)
        return TestClient(app, base_url="http://127.0.0.1")

    return _make
