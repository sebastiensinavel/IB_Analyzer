"""`/quotes`: last and close of each underlying, straight out of reqMktData - once qualified
and subscribed on its own primary exchange (sub-project 35, real-TWS probe of 2026-09-28)."""

from __future__ import annotations

from math import nan

import pytest

from .conftest import CONFIG, ORIGIN, FakeIB, FakeTicker


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr("ib_tws_agent.main.QUOTES_TIMEOUT_S", 0.05)


def get(client, query):
    return client.get(f"/quotes?port=7496&{query}", headers={"Origin": ORIGIN})


def test_one_quote_per_symbol_raw(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=231.4, close=228.9)})
    body = get(make_client(ib), "symbols=AAPL").json()
    assert body["quotes"] == [{"symbol": "AAPL", "last": 231.4, "close": 228.9}]
    assert isinstance(body["fetchedAt"], str)


def test_a_silent_symbol_comes_back_null_and_never_holds_the_others(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=231.4, close=228.9), "MSFT": FakeTicker(last=nan, close=410.0)})
    body = get(make_client(ib), "symbols=AAPL,MSFT,ZZZZ").json()
    assert body["quotes"] == [
        {"symbol": "AAPL", "last": 231.4, "close": 228.9},
        {"symbol": "MSFT", "last": None, "close": 410.0},
        {"symbol": "ZZZZ", "last": None, "close": None},
    ]


@pytest.mark.parametrize("raw", [nan, 1.7976931348623157e308, -1.0, 0.0])
def test_ib_no_value_markers_become_null(make_client, raw):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=raw, close=228.9)})
    assert get(make_client(ib), "symbols=AAPL").json()["quotes"][0]["last"] is None


def test_symbols_are_upper_cased_and_deduplicated_in_order(make_client):
    ib = FakeIB(qualifiable={"SPY", "AAPL"})
    body = get(make_client(ib), "symbols=spy,AAPL,SPY,%20aapl%20").json()
    assert [q["symbol"] for q in body["quotes"]] == ["SPY", "AAPL"]
    assert [c.symbol for c in ib.mkt_subscribed] == ["SPY", "AAPL"]


def test_asks_for_the_market_data_type_then_qualifies_smart_then_subscribes_on_primary_exchange(make_client):
    from ib_tws_agent.main import MARKET_DATA_TYPE

    ib = FakeIB(qualifiable={"AAPL"}, primary_exchanges={"AAPL": "NASDAQ"})
    get(make_client(ib), "symbols=AAPL")
    assert ib.market_data_types == [MARKET_DATA_TYPE]
    # Qualification asks SMART, as always: it is TWS's own resolution step, not a subscription.
    assert len(ib.qualify_calls) == 1
    (qualified,) = ib.qualify_calls[0]
    assert (qualified.symbol, qualified.secType, qualified.exchange, qualified.currency) == (
        "AAPL",
        "STK",
        "SMART",
        "USD",
    )
    # The subscription itself never uses SMART once a primary exchange is known: a NASDAQ
    # listing subscribed via SMART hits TWS's error 10091 and gets nothing, not even delayed.
    subscribed = ib.mkt_subscribed[0]
    assert (subscribed.symbol, subscribed.secType, subscribed.exchange, subscribed.currency) == (
        "AAPL",
        "STK",
        "NASDAQ",
        "USD",
    )
    assert subscribed.conId != 0


def test_every_subscription_is_cancelled_and_tws_disconnected(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=1.0, close=1.0), "MSFT": FakeTicker(last=1.0, close=1.0)})
    get(make_client(ib), "symbols=AAPL,MSFT")
    assert [c.symbol for c in ib.mkt_cancelled] == ["AAPL", "MSFT"]
    assert ib.disconnected


def test_a_failing_subscription_never_fails_the_answer(make_client):
    ib = FakeIB(quotes_error=RuntimeError("boom"), qualifiable={"AAPL"})
    response = get(make_client(ib), "symbols=AAPL")
    assert response.status_code == 200
    assert response.json()["quotes"] == [{"symbol": "AAPL", "last": None, "close": None}]
    assert ib.disconnected


def test_more_than_the_ceiling_is_refused_before_connecting(make_client):
    from ib_tws_agent.main import QUOTES_MAX_SYMBOLS

    ib = FakeIB()
    symbols = ",".join(f"T{i}" for i in range(QUOTES_MAX_SYMBOLS + 1))
    response = get(make_client(ib), f"symbols={symbols}")
    assert response.status_code == 422
    assert response.json()["code"] == "bad-symbols"
    assert ib.connected_to is None


@pytest.mark.parametrize("symbols", ["", ",,", "A" * 25])
def test_empty_or_oversized_symbols_are_refused(make_client, symbols):
    response = get(make_client(FakeIB()), f"symbols={symbols}")
    assert response.status_code == 422


def test_tws_unreachable_is_a_503(make_client):
    ib = FakeIB(connect_error=ConnectionRefusedError("no TWS"))
    response = get(make_client(ib), "symbols=AAPL")
    assert response.status_code == 503
    assert response.json()["code"] == "tws-unreachable"


def test_the_query_is_read_only_client_zero(make_client):
    ib = FakeIB()
    get(make_client(ib), "symbols=AAPL")
    assert ib.connected_to[0] == "127.0.0.1" and ib.connected_to[2] == 0
    assert ib.readonly is True


def test_an_unqualifiable_symbol_is_never_subscribed_and_comes_back_null(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=231.4, close=228.9)})
    body = get(make_client(ib), "symbols=AAPL,ZZZZ").json()
    assert body["quotes"] == [
        {"symbol": "AAPL", "last": 231.4, "close": 228.9},
        {"symbol": "ZZZZ", "last": None, "close": None},
    ]
    assert [c.symbol for c in ib.mkt_subscribed] == ["AAPL"]


def test_qualification_happens_before_any_subscription(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=1.0, close=1.0)})
    get(make_client(ib), "symbols=AAPL")
    assert len(ib.qualify_calls) == 1
    # The subscribed contract only carries a conId because qualification ran, and wrote it,
    # before reqMktData was ever called.
    assert ib.mkt_subscribed[0].conId != 0


def test_a_nasdaq_and_a_nyse_symbol_are_each_subscribed_on_their_own_primary_exchange(make_client):
    ib = FakeIB(
        quotes={"AAPL": FakeTicker(last=1.0, close=1.0), "IBM": FakeTicker(last=1.0, close=1.0)},
        primary_exchanges={"AAPL": "NASDAQ", "IBM": "NYSE"},
    )
    get(make_client(ib), "symbols=AAPL,IBM")
    by_symbol = {c.symbol: c for c in ib.mkt_subscribed}
    assert by_symbol["AAPL"].exchange == "NASDAQ"
    assert by_symbol["IBM"].exchange == "NYSE"
    assert by_symbol["AAPL"].conId != 0
    assert by_symbol["IBM"].conId != 0
    assert by_symbol["AAPL"].conId != by_symbol["IBM"].conId


def test_a_failing_qualification_returns_all_null_with_a_200_and_disconnects(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=1.0, close=1.0)}, qualify_error=RuntimeError("boom"))
    response = get(make_client(ib), "symbols=AAPL")
    assert response.status_code == 200
    assert response.json()["quotes"] == [{"symbol": "AAPL", "last": None, "close": None}]
    assert ib.mkt_subscribed == []
    assert ib.disconnected


def test_only_subscribed_contracts_are_cancelled(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=1.0, close=1.0)})
    get(make_client(ib), "symbols=AAPL,ZZZZ")
    assert [c.symbol for c in ib.mkt_cancelled] == ["AAPL"]
