from allauth.account.adapter import DefaultAccountAdapter


class AccountAdapter(DefaultAccountAdapter):
    """Signup is closed for good: an invitation is the only way in."""

    def is_open_for_signup(self, request):
        return False
