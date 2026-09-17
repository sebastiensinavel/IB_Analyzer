FROM python:3.14-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# apps/api is a member of the uv workspace rooted at the repo root: the lock
# file (uv.lock) and the workspace manifest (pyproject.toml) live there, not
# inside apps/api. `--frozen` installs strictly from that lock and never
# relocks, so the image stays reproducible. `--package` targets only the
# api's own dependencies - the sibling workspace member (apps/tws-agent)
# is never copied in and never needed here.
COPY pyproject.toml uv.lock /app/
COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-project --package ib-analyzer-api

COPY apps/api /app/apps/api
RUN uv sync --frozen --no-dev --package ib-analyzer-api

ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app/apps/api
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
