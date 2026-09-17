from __future__ import annotations

import re

from unittest.mock import MagicMock

from ib_tws_agent.main import CASH_TAGS, ReadOnlyIB, extract_usd_cash, get_ib_factory
from tests.conftest import (
    ORIGIN,
    FakeAccountValue,
    FakeCommissionReport,
    FakeContract,
    FakeExecution,
    FakeFill,
    FakeIB,
    FakePortfolioItem,
)

# /snapshot requires an allowed Origin (Fix 2 of the whole-branch review): these tests are
# about snapshot mechanics, not about CORS, so they all carry one. The refusal itself is
# tested in test_cors.py.
HEADERS = {"Origin": ORIGIN}

OPTION = FakeContract(
    conId=700000001,
    symbol="AAPL",
    localSymbol="AAPL  261218C00180000",
    secType="OPT",
    right="C",
    strike=180.0,
    lastTradeDateOrContractMonth="20261218",
    multiplier="100",
    currency="USD",
)
STOCK = FakeContract(conId=265598, symbol="AAPL", localSymbol="AAPL", secType="STK")


def test_snapshot_connects_once_on_the_requested_port_with_client_id_zero_and_disconnects(make_client):
    fake_ib = FakeIB()

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS)

    assert response.status_code == 200
    assert fake_ib.connected_to == ("127.0.0.1", 7502, 0, 5)
    assert fake_ib.disconnected is True


def test_snapshot_connects_in_read_only_mode(make_client):
    # Without it, ib_async's connectAsync requests open and completed orders, which a TWS with
    # "Read-Only API" ticked refuses (error 321) and signals on every sync.
    fake_ib = FakeIB()

    make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS)

    assert fake_ib.readonly is True


def test_the_real_factory_never_binds_the_tws_orders():
    # ib_async's connectAsync sends reqAutoOpenOrders(True) whenever clientId is 0, readonly or
    # not: binding the orders of the TWS window is a write the agent never needs.
    ib = get_ib_factory()()
    ib.client = MagicMock()

    ib.reqAutoOpenOrders(True)

    assert isinstance(ib, ReadOnlyIB)
    ib.client.reqAutoOpenOrders.assert_not_called()


def test_snapshot_envelope(make_client):
    response = make_client(FakeIB(managed_accounts=["U1234567", "U7654321"])).get(
        "/snapshot", params={"port": 7502}, headers=HEADERS
    )

    body = response.json()
    assert set(body) == {"accounts", "fetchedAt", "cashAvailable", "positions", "executions"}
    assert body["accounts"] == ["U1234567", "U7654321"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", body["fetchedAt"])
    assert body["positions"] == []
    assert body["executions"] == []


def test_positions_are_serialized_raw_stock_and_option_alike(make_client):
    fake_ib = FakeIB(
        portfolio=[
            FakePortfolioItem(contract=STOCK, position=100.0, averageCost=150.25, marketPrice=172.1, marketValue=17210.0, unrealizedPNL=2185.0),
            FakePortfolioItem(contract=OPTION, position=-1.0, averageCost=250.0, marketPrice=2.0, marketValue=-200.0, unrealizedPNL=50.0),
        ]
    )

    positions = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["positions"]

    assert positions == [
        {
            "conId": 265598, "symbol": "AAPL", "localSymbol": "AAPL", "secType": "STK", "right": "", "strike": 0.0,
            "lastTradeDateOrContractMonth": "", "multiplier": "", "currency": "USD",
            "position": 100.0, "averageCost": 150.25, "marketPrice": 172.1, "marketValue": 17210.0, "unrealizedPNL": 2185.0,
        },
        {
            "conId": 700000001, "symbol": "AAPL", "localSymbol": "AAPL  261218C00180000", "secType": "OPT", "right": "C",
            "strike": 180.0, "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD",
            # Per contract, as TWS gives it: the browser divides by the multiplier, not the agent.
            "position": -1.0, "averageCost": 250.0, "marketPrice": 2.0, "marketValue": -200.0, "unrealizedPNL": 50.0,
        },
    ]


def test_execution_with_a_commission_report(make_client):
    fill = FakeFill(
        contract=OPTION,
        execution=FakeExecution(execId="0000e1a7.68bc1234.01.01", side="SLD", shares=1.0, price=2.5, cumQty=1.0, avgPrice=2.5),
        commissionReport=FakeCommissionReport(execId="0000e1a7.68bc1234.01.01", commission=1.05, currency="USD"),
    )

    executions = make_client(FakeIB(fills=[fill])).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["executions"]

    assert executions == [
        {
            "execId": "0000e1a7.68bc1234.01.01",
            "time": "2026-09-06T14:31:02+00:00",
            "acctNumber": "U1234567",
            "side": "SLD",
            "shares": 1.0,
            "price": 2.5,
            "cumQty": 1.0,
            "avgPrice": 2.5,
            "orderRef": "",
            "contract": {
                "conId": 700000001, "symbol": "AAPL", "localSymbol": "AAPL  261218C00180000", "secType": "OPT", "right": "C",
                "strike": 180.0, "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD",
            },
            # Positive, as CommissionReport.commission is: the browser turns it into a cost.
            "commission": 1.05,
            "commissionCurrency": "USD",
        }
    ]


def test_execution_time_with_a_naive_datetime_is_labelled_utc_not_shifted(make_client):
    # ib_async promises UTC even when it forgets the tzinfo; treating a naive value as local
    # would shift `when` by the machine's offset once the TS parser reads it.
    from datetime import datetime

    fill = FakeFill(contract=STOCK, execution=FakeExecution(time=datetime(2026, 9, 6, 14, 31, 2)))

    execution = make_client(FakeIB(fills=[fill])).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["executions"][0]

    assert execution["time"] == "2026-09-06T14:31:02+00:00"


def test_execution_time_with_a_non_utc_tzinfo_is_converted(make_client):
    from datetime import datetime, timedelta, timezone

    tokyo = timezone(timedelta(hours=9))
    fill = FakeFill(contract=STOCK, execution=FakeExecution(time=datetime(2026, 9, 6, 23, 31, 2, tzinfo=tokyo)))

    execution = make_client(FakeIB(fills=[fill])).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["executions"][0]

    assert execution["time"] == "2026-09-06T14:31:02+00:00"


def test_execution_without_a_commission_report_yet_has_null_commission_never_zero(make_client):
    fill = FakeFill(contract=STOCK, execution=FakeExecution(side="BOT", shares=10.0, price=172.0))

    execution = make_client(FakeIB(fills=[fill])).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["executions"][0]

    assert execution["commission"] is None
    assert execution["commissionCurrency"] is None
    assert execution["side"] == "BOT"
    assert execution["shares"] == 10.0


def test_cash_available_is_the_usd_total_cash_balance(make_client):
    fake_ib = FakeIB(
        account_values=[
            FakeAccountValue(tag="TotalCashBalance", value="16284.37", currency="USD"),
            FakeAccountValue(tag="TotalCashBalance", value="999.99", currency="USD", modelCode="MODEL"),
            FakeAccountValue(tag="TotalCashBalance", value="5.00", currency="EUR"),
            FakeAccountValue(tag="AvailableFunds", value="1.00", currency="USD"),
        ]
    )

    body = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()

    assert body["cashAvailable"] == 16284.37


def test_cash_available_is_null_not_zero_when_no_tag_gives_anything(make_client):
    body = make_client(FakeIB(account_values=[FakeAccountValue(currency="EUR")])).get(
        "/snapshot", params={"port": 7502}, headers=HEADERS
    ).json()

    assert body["cashAvailable"] is None


def test_extract_usd_cash_falls_through_the_tags_in_order():
    assert CASH_TAGS == ("TotalCashBalance", "CashBalance", "AvailableFunds")
    values = [FakeAccountValue(tag="AvailableFunds", value="3"), FakeAccountValue(tag="CashBalance", value="2")]
    assert extract_usd_cash(values) == 2.0
    assert extract_usd_cash([FakeAccountValue(tag="CashBalance", value="not a number")]) is None


def test_tws_down_is_a_503_with_a_code_and_the_connection_is_released(make_client):
    fake_ib = FakeIB(connect_error=ConnectionRefusedError("refused"))

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS)

    assert response.status_code == 503
    assert response.json() == {"code": "tws-unreachable", "detail": "ConnectionRefusedError: refused"}
    assert fake_ib.disconnected is True


def test_a_failure_while_reading_still_disconnects(make_client):
    fake_ib = FakeIB(portfolio_error=RuntimeError("boom"))

    try:
        make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS)
    except RuntimeError:
        pass  # TestClient re-raises server exceptions by default; what matters is below.

    assert fake_ib.disconnected is True


def test_port_is_required_and_bounded(make_client):
    client = make_client(FakeIB())

    assert client.get("/snapshot", headers=HEADERS).status_code == 422
    assert client.get("/snapshot", params={"port": 0}, headers=HEADERS).status_code == 422
    assert client.get("/snapshot", params={"port": 70000}, headers=HEADERS).status_code == 422
