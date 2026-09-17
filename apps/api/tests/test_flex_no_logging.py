import logging

import httpx
import pytest
import respx

from ib.flex import FLEX_BASE

SEND = "/api/ib/flex/send-request"
TOKEN = "a-very-recognisable-flex-token"


@pytest.mark.django_db
@respx.mock
def test_the_token_appears_in_no_log_record(auth_client, caplog):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=b"<FlexStatementResponse/>", headers={"content-type": "text/xml"})
    )
    with caplog.at_level(logging.DEBUG):
        response = auth_client.post(
            SEND, data={"token": TOKEN, "queryId": "1"}, content_type="application/json"
        )
    assert response.status_code == 200
    assert TOKEN not in caplog.text
    for record in caplog.records:
        assert TOKEN not in str(record.args)
