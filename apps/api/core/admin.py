from django.conf import settings
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html

from core.models import Invitation, User


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
