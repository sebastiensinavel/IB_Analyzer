"""`/bars`: daily history for one underlying, straight out of `reqHistoricalData`.

Prototype (sous-projet graphes) : only stocks, only what a chart needs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import pytest

from .conftest import CONFIG, ORIGIN, FakeIB


@dataclass
class FakeBar:
    date: date = field(default_factory=lambda: date(2026, 5, 29))
    open: float = 17.0
    high: float = 18.25
    low: float = 16.5
    close: float = 17.5
    volume: float = 1234.0


def test_bars_returns_one_row_per_bar(make_client):
    ib = FakeIB(bars=[FakeBar(), FakeBar(date=date(2026, 6, 1), close=18.0)])
    client = make_client(ib)

    response = client.get("/bars?port=7496&symbol=BTDR", headers={"Origin": ORIGIN})

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "BTDR"
    assert body["bars"] == [
        {"date": "2026-05-29", "open": 17.0, "high": 18.25, "low": 16.5, "close": 17.5, "volume": 1234.0},
        {"date": "2026-06-01", "open": 17.0, "high": 18.25, "low": 16.5, "close": 18.0, "volume": 1234.0},
    ]


def test_bars_asks_tws_for_two_years_of_daily_trades(make_client):
    ib = FakeIB(bars=[])
    client = make_client(ib)

    client.get("/bars?port=7496&symbol=BTDR", headers={"Origin": ORIGIN})

    contract, kwargs = ib.historical_requests[0]
    assert (contract.symbol, contract.secType, contract.exchange, contract.currency) == ("BTDR", "STK", "SMART", "USD")
    # TRADES is split-adjusted and the only series with volume; useRTH keeps the chart on
    # session bars, as TWS itself draws them.
    assert kwargs["durationStr"] == "2 Y"
    assert kwargs["barSizeSetting"] == "1 day"
    assert kwargs["whatToShow"] == "TRADES"
    assert kwargs["useRTH"] is True


def test_bars_takes_the_window_from_the_query(make_client):
    ib = FakeIB(bars=[])
    client = make_client(ib)

    client.get("/bars?port=7496&symbol=BTDR&duration=6%20M&barSize=1%20hour", headers={"Origin": ORIGIN})

    _, kwargs = ib.historical_requests[0]
    assert kwargs["durationStr"] == "6 M"
    assert kwargs["barSizeSetting"] == "1 hour"


def test_bars_answers_503_when_tws_is_unreachable(make_client):
    ib = FakeIB(connect_error=ConnectionRefusedError("no TWS here"), bars=[])
    client = make_client(ib)

    response = client.get("/bars?port=7496&symbol=BTDR", headers={"Origin": ORIGIN})

    assert response.status_code == 503
    assert response.json()["code"] == "tws-unreachable"
    assert ib.disconnected


def test_bars_closes_the_connection_even_when_tws_errors(make_client):
    ib = FakeIB(bars_error=RuntimeError("pacing violation"))
    client = make_client(ib)

    with pytest.raises(RuntimeError):
        client.get("/bars?port=7496&symbol=BTDR", headers={"Origin": ORIGIN})

    assert ib.disconnected


def test_bars_refuses_a_foreign_origin(make_client):
    client = make_client(FakeIB(bars=[]), CONFIG)

    response = client.get("/bars?port=7496&symbol=BTDR", headers={"Origin": "https://evil.example"})

    assert response.status_code == 403
