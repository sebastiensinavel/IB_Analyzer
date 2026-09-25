FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
# vite.config.ts importe tools/dev-env/ports.mjs (ports du serveur de dev) : le build le
# vérifie au typage, sans quoi l'image ne se construit pas.
COPY tools/dev-env ./tools/dev-env
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter web build

# The agent's wheel, served by the site: a user needs uv and this site, nothing else
# (spec sous-projet 4 §9). Built standalone from its own pyproject: no workspace, no lock.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS agent
WORKDIR /repo
COPY apps/tws-agent ./apps/tws-agent
RUN uv build --wheel --out-dir /out apps/tws-agent \
 && python apps/tws-agent/scripts/write_index.py /out \
 && rm -f /out/.gitignore

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY --from=agent /out /usr/share/nginx/html/agent
