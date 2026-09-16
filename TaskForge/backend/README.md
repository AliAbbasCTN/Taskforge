# TaskForge Backend

A NestJS + TypeScript backend backed by PostgreSQL via Prisma.

## What exists (Phase 02)

- `GET /health` — liveness check that also verifies database connectivity (returns 503 if the database is unreachable)
- `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` — full CRUD for user records, persisted to PostgreSQL
- A typed, validated configuration system (`src/config/`) — fails fast at startup if the environment is misconfigured
- A global exception filter producing consistent error responses (`src/common/filters/`)
- Global request validation (whitelist + reject unknown properties)
- A singleton Prisma connection managed by NestJS lifecycle hooks (`src/database/`)

## Run locally

Requires a running PostgreSQL — from the project root, `docker compose up -d` is the quickest option.

```bash
cp .env.example .env
npm install              # also runs `prisma generate`
npx prisma migrate dev   # apply migrations
npm run start:dev
```

## Test

```bash
npm run test       # unit tests — no database required
npm run test:e2e   # e2e tests — REQUIRES a running, migrated database
npm run lint
npm run build
```

## Database

| Command | Purpose |
|---|---|
| `npx prisma migrate dev` | Create and apply a migration after editing `schema.prisma` |
| `npx prisma migrate deploy` | Apply existing migrations (production/CI — never generates new ones) |
| `npx prisma generate` | Regenerate the typed client |
| `npx prisma studio` | Visual database browser |

The schema lives in `prisma/schema.prisma`; migrations are committed under `prisma/migrations/`. Never edit a migration that has already been applied — create a new one instead.

## Structure

Domain module folders (`auth/`, `organizations/`, `teams/`, `projects/`, `boards/`, `tasks/`, `comments/`, `notifications/`, `files/`, `search/`, `activity/`, `audit/`) are still empty placeholders — they're filled in as the roadmap reaches each one. See [`../docs/folder-structure.md`](../docs/folder-structure.md) and [`../docs/architecture.md`](../docs/architecture.md).
