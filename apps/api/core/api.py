from allauth.account.internal.flows.login import record_authentication
from django.contrib.auth import get_user_model, login
from django.core.exceptions import ValidationError
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone
from ninja import Router, Status
from ninja.errors import HttpError
from ninja.utils import check_csrf

from core.models import Invitation
from core.schemas import AcceptInvitationIn, ErrorOut, SessionUserOut

router = Router(tags=["core"])

# One message for unknown, expired and already-accepted tokens alike: telling
# them apart would leak whether an invitation exists.
INVITATION_INVALID = {"code": "invitation-invalid", "detail": "This invitation cannot be used."}


@router.post("/invitations/accept", auth=None, response={200: SessionUserOut, 400: ErrorOut})
def accept_invitation(request, payload: AcceptInvitationIn):
    # `auth=None`: no authenticator runs, and every django-ninja view is
    # marked csrf_exempt at the Django middleware level (cookie-based auth
    # classes, e.g. APIKeyCookie, do their own CSRF check instead). This
    # endpoint creates an account and opens a session — exactly what CSRF
    # protects — so it checks the token itself, the same way
    # APIKeyCookie(csrf=True) does internally.
    if check_csrf(request):
        raise HttpError(403, "CSRF check failed")

    invitation = Invitation.objects.filter(token=payload.token).first()
    if invitation is None or not invitation.is_usable:
        return Status(400, INVITATION_INVALID)

    user_model = get_user_model()
    candidate = user_model(email=invitation.email)
    try:
        validate_password(payload.password, candidate)
    except ValidationError as error:
        return Status(400, {"code": "password-invalid", "detail": " ".join(error.messages)})

    with transaction.atomic():
        # Re-read under the row lock: two clicks on the same link must not
        # create two users.
        locked = Invitation.objects.select_for_update().get(pk=invitation.pk)
        if not locked.is_usable:
            return Status(400, INVITATION_INVALID)
        user = user_model.objects.create_user(email=locked.email, password=payload.password)
        locked.accepted_at = timezone.now()
        locked.accepted_user = user
        locked.save(update_fields=["accepted_at", "accepted_user"])

    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    # `django.contrib.auth.login` alone leaves allauth's own "recently authenticated" session
    # record empty: that record is only ever written by allauth's *own* login flow
    # (perform_password_login -> record_authentication), never by Django's raw login(). Every
    # reauthentication-gated headless endpoint — enabling TOTP, generating recovery codes,
    # WebAuthn, email/phone management (constaté: allauth's own `reauthentication_required`
    # decorator, used across `allauth/mfa` and `allauth/account`) — reads that record and,
    # without it, immediately demands a fresh `/auth/reauthenticate` call the SPA never makes
    # (task 20's e2e test caught this: a freshly invited user could never activate 2FA). The
    # user just proved their password by choosing it here, which is at least as strong as a
    # normal login, so recording it is honest, not a workaround.
    record_authentication(request, user, method="password")
    return Status(200, {"id": str(user.pk), "email": user.email})
