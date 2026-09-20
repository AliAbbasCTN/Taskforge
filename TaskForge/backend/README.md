# TaskForge Backend

A NestJS + TypeScript backend backed by PostgreSQL via Prisma, with JWT authentication.

## What exists (Phase 03)

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- **Users:** `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `DELETE /users/:id` — all require a valid access token; `PATCH`/`DELETE` require you to be modifying your own account
- `GET /health` — liveness check that also verifies database connectivity
- Passwords hashed with bcrypt; refresh tokens hashed with SHA-256 and rotated on every use
- A typed, validated configuration system (`src/config/`) — fails fast at startup if the environment is misconfigured, including JWT secrets
- A global exception filter producing consistent error responses (`src/common/filters/`)
- Global request validation (whitelist + reject unknown properties)

## Run locally

Requires a running PostgreSQL — from the project root, `docker compose up -d` is the quickest option.

```bash
cp .env.example .env
```

Edit `.env` and set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to two different random values (`openssl rand -base64 32`).

```bash
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

## Trying the auth flow manually

```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","name":"Ada Lovelace","password":"password1"}'

# Copy the accessToken and refreshToken from the response, then:
curl http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"

curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'

curl -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer <accessToken>"
```

## Database

| Command | Purpose |
|---|---|
| `npx prisma migrate dev` | Create and apply a migration after editing `schema.prisma` |
| `npx prisma migrate deploy` | Apply existing migrations (production/CI) |
| `npx prisma migrate reset` | Drop and recreate the dev database, reapplying all migrations — needed if you have old rows that predate a NOT NULL column added later |
| `npx prisma generate` | Regenerate the typed client |
| `npx prisma studio` | Visual database browser |

## Structure

Domain module folders (`organizations/`, `teams/`, `projects/`, `boards/`, `tasks/`, `comments/`, `notifications/`, `files/`, `search/`, `activity/`, `audit/`) are still empty placeholders. See [`../docs/folder-structure.md`](../docs/folder-structure.md) and [`../docs/architecture.md`](../docs/architecture.md).
