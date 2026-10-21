# TaskForge

**Collaborative Project Management Platform**

TaskForge is a multi-tenant project management platform inspired by tools like Jira, Linear, and Trello. It is being built progressively, phase by phase, as a full-stack engineering learning project — with production-quality practices at every step.

> TaskForge is **not** a Jira clone. Jira and similar tools are used only as conceptual references for features and architecture.

---

## Current Status

**Phase 00 — Planning & Architecture** ✅ Complete
**Phase 01 — Backend Fundamentals** ✅ Complete
**Phase 02 — Database Architecture** ✅ Complete
**Phase 03 — Authentication** ✅ Complete
**Phase 04 — Multi-Tenancy** ✅ Complete
**Phase 05 — Teams** ✅ Complete
**Phase 06 — RBAC** ✅ Complete
**Phase 07 — Projects** ✅ Complete
**Phase 08 — Boards, Columns & Tasks** ✅ Complete
**Phase 09 — React Frontend** ✅ Complete
**Phase 10 — Advanced Task Management** ✅ Complete
**Phase 11 — WebSockets** ✅ Complete
**Phase 12 — Redis + BullMQ** ✅ Complete
**Phase 13 — File Uploads** ✅ Complete
**Phase 14 — Search & Filtering** ✅ Complete
**Phase 15 — Activity Logs & Audit Trail** ✅ Complete
**Phase 16 — Swagger / API Documentation** ✅ Complete

The whole API is now **documented and explorable**: run the backend and open **http://localhost:3000/docs** for an interactive reference (every route, every request body, every response model, every error, with a built-in **Authorize** button for your token). It is generated from the code itself and checked by tests, so it cannot quietly drift. See [`docs/phase-16-concepts.md`](./docs/phase-16-concepts.md). Before that, TaskForge gained a permanent record of **who did what, and when**: a per-project **activity feed** and per-task timeline for members, and an **organization audit trail** for admins. Entries are snapshots that outlive what they describe, are append-only (enforced by a database trigger), and are recorded by a decorator + interceptor so services stay untouched. See [`docs/phase-15-concepts.md`](./docs/phase-15-concepts.md). Earlier: PostgreSQL full-text task search ([`docs/phase-14-concepts.md`](./docs/phase-14-concepts.md)) and file attachments ([`docs/phase-13-concepts.md`](./docs/phase-13-concepts.md)). See [`docs/`](./docs) for architecture, and [Setup](#setup) below to run it.

---

## Project Overview

TaskForge lets teams inside an organization plan, track, and collaborate on work using organizations, teams, projects, kanban-style boards, and tasks — with real-time updates, background processing, file attachments, search, and a full audit trail.

## Planned Feature Set

- Authentication (JWT access + refresh tokens)
- Multi-tenant organizations with strict data isolation
- Teams and team membership
- Role-based access control (Admin / Manager / Member)
- Projects (private to their members), boards, columns, and tasks
- Comments, labels, priorities, due dates, attachments
- Real-time updates via WebSockets
- Background jobs via Redis + BullMQ
- File uploads (local dev, S3 in production)
- Full-text search, filtering, sorting, pagination
- Activity logs and audit trail
- Swagger/OpenAPI documentation
- Unit, integration, and E2E tests
- Docker + Docker Compose
- CI/CD via GitHub Actions

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, NestJS |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT (access + refresh tokens) |
| Caching / Jobs | Redis + BullMQ |
| Real-time | WebSockets (Socket.IO via NestJS) |
| Frontend | React + TypeScript + Vite |
| API Docs | Swagger / OpenAPI |
| Testing | Jest, Supertest |
| Infra | Docker, Docker Compose, GitHub Actions |
| File Storage | Local (dev) → AWS S3 (production) |

See [`docs/architecture.md`](./docs/architecture.md) for the full architectural breakdown.

## Project Structure

See [`docs/folder-structure.md`](./docs/folder-structure.md).

## Documentation Index

- [`docs/architecture.md`](./docs/architecture.md) — system architecture, actors, entities
- [`docs/database-plan.md`](./docs/database-plan.md) — initial database/entity plan
- [`docs/api-conventions.md`](./docs/api-conventions.md) — REST API design conventions
- [`docs/folder-structure.md`](./docs/folder-structure.md) — backend/frontend folder layout
- [`docs/coding-conventions.md`](./docs/coding-conventions.md) — naming, style, principles
- [`docs/git-workflow.md`](./docs/git-workflow.md) — branching, commits, phase workflow
- [`docs/roadmap.md`](./docs/roadmap.md) — full 21-phase roadmap
- [`docs/phase-01-concepts.md`](./docs/phase-01-concepts.md) — concepts learned in Phase 01 (NestJS, DI, config, validation, testing)
- [`docs/phase-02-concepts.md`](./docs/phase-02-concepts.md) — concepts learned in Phase 02 (PostgreSQL, Prisma, migrations, schema design)
- [`docs/phase-03-concepts.md`](./docs/phase-03-concepts.md) — concepts learned in Phase 03 (password hashing, JWTs, refresh token rotation, a real bug we hit and fixed)
- [`docs/phase-04-concepts.md`](./docs/phase-04-concepts.md) — concepts learned in Phase 04 (multi-tenancy, tenant isolation guards, a real Phase 03 leak we found and fixed)
- [`docs/phase-05-concepts.md`](./docs/phase-05-concepts.md) — concepts learned in Phase 05 (nested resource ownership, IDOR, guard chains)
- [`docs/phase-06-concepts.md`](./docs/phase-06-concepts.md) — concepts learned in Phase 06 (RBAC, permissions vs roles, declarative guards)
- [`docs/phase-07-concepts.md`](./docs/phase-07-concepts.md) — concepts learned in Phase 07 (private resources, visibility vs permission, 404 vs 403, archive vs delete, two issues found and fixed)
- [`docs/phase-08-concepts.md`](./docs/phase-08-concepts.md) — concepts learned in Phase 08 (ordered lists in SQL, status-as-column, structure vs content permissions, five levels of ownership checks)
- [`docs/phase-09-concepts.md`](./docs/phase-09-concepts.md) — concepts learned in Phase 09 (React components/state/hooks, auth on the frontend, token storage trade-offs, protected routes, server state, why the UI is never the security boundary)
- [`docs/phase-10-concepts.md`](./docs/phase-10-concepts.md) — concepts learned in Phase 10 (many-to-many, server-side filtering/sorting/pagination, the query-string boolean trap, data-dependent authorization, optimistic updates, native drag-and-drop)
- [`docs/phase-11-concepts.md`](./docs/phase-11-concepts.md) — concepts learned in Phase 11 (WebSockets, rooms, invalidation-based real-time, authorizing long-lived connections, notifications)
- [`docs/phase-12-concepts.md`](./docs/phase-12-concepts.md) — concepts learned in Phase 12 (message queues, retries and backoff, idempotency, graceful degradation, scheduled jobs, the dual-write problem, monitoring background work)
- [`docs/phase-13-concepts.md`](./docs/phase-13-concepts.md) — concepts learned in Phase 13 (never trusting uploads, magic-number validation, server-generated storage keys, path traversal, the storage abstraction, S3 and credentials, the two-system consistency problem, orphan cleanup)
- [`docs/phase-14-concepts.md`](./docs/phase-14-concepts.md) — concepts learned in Phase 14 (full-text search, tsvector/tsquery, stemming, GIN indexes, trigger-maintained search columns, safe raw SQL, XSS-safe highlighting, choosing between FTS and substring search, graceful degradation when Redis is down)
- [`docs/phase-16-concepts.md`](./docs/phase-16-concepts.md) — concepts learned in Phase 16 (OpenAPI, documentation generated from code, request vs response models, documenting auth and errors once, post-processing a document, contract tests, why docs are off in production by default)
- [`docs/phase-15-concepts.md`](./docs/phase-15-concepts.md) — concepts learned in Phase 15 (activity vs audit, snapshot-based history without foreign keys, append-only enforcement with triggers, decorator + interceptor recording, pure describer functions, best-effort vs transactional logging)

## Setup

### 1. Start PostgreSQL and Redis

The quickest way is the provided containers (requires Docker):

```bash
docker compose up -d
```

This starts PostgreSQL 16 on `localhost:5432` (user/password/database all `taskforge`, matching the default `DATABASE_URL` in `.env.example`) and, from Phase 12, **Redis 7 on `localhost:6379`**, which the background-job queues and multi-instance real-time need. If `REDIS_URL` is missing from your `backend/.env` it defaults to `redis://localhost:6379`; the updated `.env.example` lists it explicitly. If you'd rather use a PostgreSQL you already have installed, just point `DATABASE_URL` at it instead.

### 2. Set up the backend

```bash
cd backend
cp .env.example .env
```

Then open `.env` and replace `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` with two different random values (e.g. `openssl rand -base64 32`, run twice) — the app refuses to start with the placeholder values or with both secrets the same.

```bash
npm install              # also runs `prisma generate` automatically
                         # (use `npm install`, not `npm ci`, the first time after Phase 13:
                         #  it adds the AWS S3 client and updates package-lock.json)
npx prisma migrate dev   # creates the database tables
npm run start:dev
```

The API will be available at `http://localhost:3000`. Try it:

```bash
curl http://localhost:3000/health

# Register an account
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","name":"Ada Lovelace","password":"password1"}'

# Use the accessToken from the response above
curl http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"

# Create an organization - you become its admin
curl -X POST http://localhost:3000/organizations \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Inc."}'
```

#### Running without Docker (Redis and PostgreSQL)

The backend needs PostgreSQL and Redis. Docker Compose is the easiest way to get both (`docker compose up -d` from the project root, after installing Docker Desktop and opening a **new** terminal). If you cannot use Docker: run PostgreSQL locally and point `DATABASE_URL` at it, and get Redis through **WSL2** (`sudo apt install redis-server && sudo service redis-server start`) or **Memurai** (a Redis-compatible Windows service). Without Redis the API still starts and serves requests - notifications are delivered inline and real-time runs in single-instance mode - but background jobs wait, and the end-to-end tests (`npm run test:e2e`) cannot run.

#### Applying the Phase 15 migration

`npx prisma migrate dev` also applies `20261018120000_add_activity_logs`: the `activity_logs` table, its indexes, and a trigger that makes entries append-only. Try it: do something in the app, then open a project (**Recent activity**) or, as an organization admin, **Audit log** on the organization page.

#### Applying the Phase 14 migration

`npx prisma migrate dev` applies `20261017120000_add_task_full_text_search`: it adds the `search_vector` column, a trigger that keeps it current, a GIN index, and indexes all existing tasks. It needs no extra PostgreSQL extension.

#### File uploads (Phase 13)

Nothing to configure for development: uploads are written to `backend/uploads/` (git-ignored) with the default 10 MB limit. To change that, or to use S3 in production, see the "File uploads" section of `backend/.env.example` and [`docs/phase-13-concepts.md`](./docs/phase-13-concepts.md). Open a task on a board and use **Add attachment**, or from the command line:

```bash
curl -X POST \
  "http://localhost:3000/organizations/<orgId>/projects/<projectId>/boards/<boardId>/tasks/<taskId>/attachments" \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@./screenshot.png"
```

### Running Tests

```bash
cd backend
npm run test        # unit tests (no database needed)
npm run test:e2e    # end-to-end tests (REQUIRES a running database)
npm run lint        # ESLint
npm run build       # TypeScript build via Nest CLI
```

### Useful database commands

```bash
npx prisma studio         # visual database browser at localhost:5555
npx prisma migrate dev    # create + apply a migration after a schema change
npx prisma generate       # regenerate the typed client
```

### 3. Run the frontend

With the backend running (step 2), in a second terminal:

```bash
cd frontend
cp .env.example .env     # VITE_API_URL=http://localhost:3000
npm install
npm run dev
```

Open **http://localhost:5173**, create an account, make an organization, then a project, then a board.

The port matters: the backend's `CORS_ORIGIN` allows exactly `http://localhost:5173`, so the dev server is configured to fail rather than silently pick another port.

```bash
npm run test        # frontend unit tests (no backend needed)
npm run typecheck   # TypeScript check
npm run build       # type-check + production build into dist/
```

See [`frontend/README.md`](./frontend/README.md) for details.

## License

MIT — see [`LICENSE`](./LICENSE).
