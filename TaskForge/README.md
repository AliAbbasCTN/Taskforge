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

The backend has full authentication: registration, login, JWT access + refresh tokens with rotation, and logout, all backed by PostgreSQL via Prisma. Protected routes require a valid access token, and users can only modify their own account. See [`docs/`](./docs) for architecture and [Setup](#setup) below to run it.

---

## Project Overview

TaskForge lets teams inside an organization plan, track, and collaborate on work using organizations, teams, projects, kanban-style boards, and tasks — with real-time updates, background processing, file attachments, search, and a full audit trail.

## Planned Feature Set

- Authentication (JWT access + refresh tokens)
- Multi-tenant organizations with strict data isolation
- Teams and team membership
- Role-based access control (Admin / Manager / Member)
- Projects, boards, columns, and tasks
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

## Setup

### 1. Start PostgreSQL

The quickest way is the provided container (requires Docker):

```bash
docker compose up -d
```

This starts PostgreSQL 16 on `localhost:5432` with user/password/database all set to `taskforge`, matching the default `DATABASE_URL` in `.env.example`. If you'd rather use a PostgreSQL you already have installed, just point `DATABASE_URL` at it instead.

### 2. Set up the backend

```bash
cd backend
cp .env.example .env
```

Then open `.env` and replace `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` with two different random values (e.g. `openssl rand -base64 32`, run twice) — the app refuses to start with the placeholder values or with both secrets the same.

```bash
npm install              # also runs `prisma generate` automatically
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
curl http://localhost:3000/users -H "Authorization: Bearer <accessToken>"
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

### Frontend

Not built yet — introduced in Phase 09.

## License

MIT — see [`LICENSE`](./LICENSE).
