# Repository layout

Short English map of this repository, for anyone opening it for the first time. The
authoritative design document is `docs/specs/2026-09-03-architecture-design.md` (French), and
the working rules live in `CLAUDE.md`.

## The one rule that shapes everything

All portfolio logic runs **in the browser**; the server never stores transactions, positions
or Flex tokens. That is why the business code sits in framework-free TypeScript packages and
the Django app stays thin.

## Top level

| Path | What it is |
|---|---|
| `apps/web` | The React + Vite SPA — the actual application. Data lives in IndexedDB (Dexie). |
| `apps/api` | Thin Django 5.2 server: users, invitations, 2FA, Flex proxy. No portfolio tables, ever. |
| `apps/tws-agent` | Optional local Python agent (FastAPI) on `127.0.0.1`: reads TWS for intraday data, relays Flex calls. |
| `packages/ledger` | Domain model and computations: transactions, positions, cash, journals. No UI, no I/O. |
| `packages/ib-parsers` | Parsers for IB inputs: Flex XML, HTML activity statements, agent payloads. |
| `packages/coverage` | Option-coverage engine, risk report, strategy positions, position suggestions; depends on `ledger`. |
| `packages/ui` | shadcn components (on base-ui, not Radix), shared by the app. |
| `tools/dev-env` | Per-checkout port/database allocation and detached dev instances. |
| `scripts/` | Repository-level checks (`check-api-types.mjs`). |
| `deploy/` | VPS operations: the `iba` script (prod and dev instances) and the prod systemd unit. The shared Traefik lives outside this repository, in `/srv/infra`. |
| `docs/` | Specs, plans, deployment guide, deferred-debt list. |
| `private/` | Real IB files used to write parsers. Git-ignored, never committed. |

## Workspaces

Two workspace managers over one repository:

- **pnpm** (`pnpm-workspace.yaml`): `apps/*` and `packages/*`. Internal packages are
  `@ib/ledger`, `@ib/ib-parsers`, `@ib/coverage`, `@ib/ui`, consumed as `workspace:*` source —
  nothing is built before use.
- **uv** (root `pyproject.toml`): members `apps/api` and `apps/tws-agent`, on Python 3.14.

Dependency direction: `apps/web` → `coverage` → `ledger`, and `apps/web` → `ib-parsers` →
`ledger`. `ledger` depends on nothing. Cycles are what the business-constant placement rules in
`CLAUDE.md` are guarding against.

## Inside `apps/web/src`

| Folder | Role |
|---|---|
| `pages/`, `routes/` | Screens and the router; every view is scoped `/accounts/:accountId/...`. |
| `components/` | App-level components (sidebar, cards, tables). |
| `db/` | Dexie schema, imports, replay, account data provider. All persistence. |
| `flex/`, `agent/`, `api/` | The three outside worlds: Flex sync (relayed by the agent or the server proxy), local TWS agent, Django API. |
| `lib/`, `hooks/` | Presentation helpers and shared hooks. |
| `i18n/` | `fr.json` / `en.json`; the packages never emit user-visible text. |
| `mocks/` | Seed data for demos and screenshots. |
| `test/` | Test helpers shared by component tests. |

Playwright end-to-end tests live outside `src`, in `apps/web/e2e/`, and run separately from
`pnpm check`.

## Docs

- `docs/specs/<date>-<topic>-design.md` — one design spec per sub-project.
- `docs/plans/<date>-<topic>.md` — the matching implementation plan; its checkboxes are the
  progress record for that branch.
- `docs/points-reportes.md` — known, deliberately deferred debt.
- `docs/deploiement-vps.md` — VPS deployment, command by command.

## Tests

Tests sit next to the code they cover (`foo.ts` / `foo.test.ts`). Vitest for TypeScript,
pytest for `apps/api` and `apps/tws-agent`, Playwright for end-to-end. Files named
`*.private.test.ts` run against real data in `private/` and are skipped without it;
`*.oracle.test.ts` replay anonymized fixture corpora (`packages/ib-parsers/tests/fixtures`)
against their own statements, Cash Reports or snapshot — a mismatch is a bug in the engine,
not in the oracle. The coverage engine was validated once against the old Python engine; that
oracle is gone, and only hand-written Vitest tests pin it now.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Runs the SPA alone; no server needed. |
| `pnpm dev:api` | Runs Django (needs PostgreSQL from `docker-compose.dev.yml`). |
| `pnpm dev:start` / `dev:stop` / `dev:status` | Detached Vite + Django instance for the current checkout. |
| `pnpm check` | Lint, typecheck, API-types freshness, build, TS tests. Never runs Python. |
| `pnpm test:api` / `pnpm test:agent` | The Python test suites. |
| `pnpm gen:api` | Regenerates `apps/web/src/api/schema.d.ts` from `apps/api/openapi.json`. |
| `pnpm build:agent` | Builds the agent wheel served under `/agent/`. |

Each checkout gets its own ports and database (`tools/dev-env/ports.mjs`): the repository root
uses `5173`/`8000`, a worktree under `.claude/worktrees/<name>` takes the next free slot. Never
hard-code a port in those tools.

## Branch workflow

Each sub-project: spec → plan → TDD implementation in a git worktree under
`.claude/worktrees/<name>`, merged into `main` once the branch review is clean. The plan's
checkboxes are ticked in the same commit as the work they describe.
