from django.conf import settings
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.template.defaultfilters import filesizeformat
from django.utils.html import format_html

from core.models import Backup, Invitation, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "is_staff", "is_active", "date_joined")
    search_fields = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    """No email is ever sent: the admin copies the link and passes it on."""

    list_display = ("email", "created_at", "expires_at", "accepted_at")
    readonly_fields = ("token", "created_at", "accepted_at", "accepted_user", "invitation_link")
    fields = ("email", "expires_at", "invitation_link", "token", "created_at", "accepted_at", "accepted_user")

    @admin.display(description="Invitation link")
    def invitation_link(self, obj):
        if not obj.pk:
            return "—"
        return format_html("<code>{}</code>", obj.link(settings.PUBLIC_BASE_URL))

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(Backup)
class BackupAdmin(admin.ModelAdmin):
    """Metadata only — who has deposited a backup, how big it is, when it last changed.

    `blob` is deliberately absent from `list_display`, `fields` and everywhere else on
    this page, and that is not just `BinaryField.editable = False` doing its usual job of
    dropping the column from a ModelForm. Even if it were editable, it would still not
    belong here: this server cannot decrypt this blob and does not know its structure, so
    an admin page that rendered it would be the one place that turns "opaque encrypted
    bytes" into "a page full of bytes in someone's browser" — exactly what this table
    exists to avoid. If you are about to add `blob` back to `list_display` because the
    column looks empty without it, don't: read this comment again instead.
    """

    list_display = ("user", "size", "updated_at")
    readonly_fields = ("user", "size", "updated_at")
    fields = ("user", "size", "updated_at")

    @admin.display(description="Size", ordering="bytes")
    def size(self, obj):
        return filesizeformat(obj.bytes)

    def has_add_permission(self, request):
        # There is no way to type a valid blob into a form field, so there is no way to
        # create a valid row here. Deposits only ever come from the browser, through the
        # backup API.
        return False
