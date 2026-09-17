"""Doubles for ib_async. Duck-typed on purpose, never subclasses of the real classes."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

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


@dataclass
class FakePortfolioItem:
    contract: FakeContract = field(default_factory=FakeContract)
    position: float = 0.0
    marketPrice: float = 0.0
    marketValue: float = 0.0
    averageCost: float = 0.0
    unrealizedPNL: float = 0.0


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
    ):
        self._managed_accounts = managed_accounts if managed_accounts is not None else ["U1234567"]
        self._portfolio = portfolio if portfolio is not None else []
        self._account_values = account_values if account_values is not None else []
        self._fills = fills if fills is not None else []
        self._connect_error = connect_error
        self._portfolio_error = portfolio_error
        self.connected_to: tuple | None = None
        self.readonly: bool | None = None
        self.disconnected = False

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
