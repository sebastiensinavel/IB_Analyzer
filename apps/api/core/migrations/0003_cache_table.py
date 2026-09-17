# Creates the table backing `CACHES["default"]` (config/settings.py): the
# throttling in `ib/throttling.py` needs one shared counter per user, not one
# per gunicorn worker (see the comment above `CACHES` in settings.py). A
# migration applies the same way in every environment that runs `migrate`
# (tests included, deploy step in task 8), unlike a manual deployment step.
from django.core.management import call_command
from django.db import migrations


def create_cache_table(apps, schema_editor):
    """`createcachetable` reads `settings.CACHES` itself, so it always builds
    the table actually configured (its `LOCATION`) rather than a name
    hardcoded here twice. It is idempotent: it skips a table that already
    exists (`--reuse-db` in tests, or a migration replayed on a broken
    deploy)."""
    call_command("createcachetable", verbosity=0)


def drop_cache_table(apps, schema_editor):
    schema_editor.execute("DROP TABLE IF EXISTS django_cache")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_invitation"),
    ]

    operations = [
        migrations.RunPython(create_cache_table, drop_cache_table),
    ]
