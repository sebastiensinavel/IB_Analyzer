from django.http import HttpResponse
from ninja import Router, Status
from ninja.security import django_auth

from core.schemas import ErrorOut
from ib.flex import FlexTimeout, FlexUnreachable, call_flex
from ib.schemas import GetStatementIn, SendRequestIn
from ib.throttling import FlexBurstThrottle, FlexRateThrottle

router = Router(tags=["ib"], auth=django_auth)

TIMEOUT_BODY = {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}
UNREACHABLE_BODY = {"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}

# IB's own limits (spec §3.2): 1 request/second and 10/minute. Both rules are
# checked on every call; ninja sets `Retry-After` on the 429 itself.
FLEX_THROTTLE = [FlexBurstThrottle(), FlexRateThrottle()]


def _relay(endpoint, params):
    """Pass IB's answer through untouched, or fail with a body of our own.

    The 200 case returns a plain `HttpResponse`: `Operation._result_to_response`
    (ninja/operation.py) returns any `HttpResponseBase` as-is, before it ever
    looks at `response_models`, so IB's bytes and content-type reach the
    browser untouched. The 502/504 cases are ours to shape, so they go through
    `Status(...)` instead: ninja validates the body against the declared
    `ErrorOut` schema and serializes it itself, the same pattern `core.api`
    uses — a raw `JsonResponse` here would produce the right bytes too, but
    would bypass that validation and leave the declared 502/504 schemas
    unenforced against what actually ships.
    """
    try:
        content, content_type = call_flex(endpoint, params)
    except FlexTimeout:
        return Status(504, TIMEOUT_BODY)
    except FlexUnreachable:
        return Status(502, UNREACHABLE_BODY)
    return HttpResponse(content, status=200, content_type=content_type)


@router.post("/flex/send-request", response={200: str, 502: ErrorOut, 504: ErrorOut}, throttle=FLEX_THROTTLE)
def send_request(request, payload: SendRequestIn):
    """200 carries IB's raw XML, `Fail` responses included: the browser parses it."""
    return _relay("SendRequest", {"t": payload.token, "q": payload.queryId})


@router.post("/flex/get-statement", response={200: str, 502: ErrorOut, 504: ErrorOut}, throttle=FLEX_THROTTLE)
def get_statement(request, payload: GetStatementIn):
    """200 carries IB's raw XML, `Fail` responses included: the browser parses it."""
    return _relay("GetStatement", {"t": payload.token, "q": payload.referenceCode})
