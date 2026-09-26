# TaskForge Backend

A NestJS + TypeScript backend backed by PostgreSQL via Prisma, with JWT authentication, multi-tenant organizations, and teams.

## What exists (Phase 05)

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- **Users:** `GET /users/:id` (self, or anyone sharing an organization with you), `PATCH /users/:id`, `DELETE /users/:id`
- **Organizations:** create/list/get/rename, member management, admin-gated mutations, a "last admin" safety rail
- **Teams** (new): a subdivision within an organization
  - `POST /organizations/:id/teams` — create (any org member; you become its LEAD)
  - `GET /organizations/:id/teams` — list teams in the org (any org member)
  - `GET /organizations/:id/teams/:teamId` — team details (any org member — teams aren't private within their org)
  - `PATCH/DELETE /organizations/:id/teams/:teamId` — rename/delete (team LEAD only)
  - `GET /organizations/:id/teams/:teamId/members` — list members (any org member)
  - `POST/PATCH/DELETE .../members[/:userId]` — manage team membership (team LEAD only)
  - Adding someone to a team requires them to already be an organization member (422 otherwise)
  - A "last lead" safety rail, mirroring the organization's "last admin" rule
- `GET /health` — liveness check that also verifies database connectivity
- Nested resource ownership is independently verified at every level — a team ID from one organization can't be accessed through a different organization's URL (a classic IDOR pattern, explicitly guarded against and tested)

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

## Trying the teams flow manually

```bash
# Register a lead and an org member
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"lead@acme.com","name":"Lead","password":"password1"}'
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"member@acme.com","name":"Member","password":"password1"}'

# Create an org, add the member, create a team
curl -X POST http://localhost:3000/organizations -H "Authorization: Bearer <leadToken>" \
  -H "Content-Type: application/json" -d '{"name":"Acme"}'
curl -X POST http://localhost:3000/organizations/<orgId>/members -H "Authorization: Bearer <leadToken>" \
  -H "Content-Type: application/json" -d '{"email":"member@acme.com"}'
curl -X POST http://localhost:3000/organizations/<orgId>/teams -H "Authorization: Bearer <leadToken>" \
  -H "Content-Type: application/json" -d '{"name":"Engineering"}'

# Add the org member to the team
curl -X POST http://localhost:3000/organizations/<orgId>/teams/<teamId>/members \
  -H "Authorization: Bearer <leadToken>" -H "Content-Type: application/json" \
  -d '{"email":"member@acme.com"}'
```

## Database

| Command | Purpose |
|---|---|
| `npx prisma migrate dev` | Create and apply a migration after editing `schema.prisma` |
| `npx prisma migrate deploy` | Apply existing migrations (production/CI) |
| `npx prisma migrate reset` | Drop and recreate the dev database, reapplying all migrations |
| `npx prisma generate` | Regenerate the typed client |
| `npx prisma studio` | Visual database browser |

## Structure

Domain module folders (`projects/`, `boards/`, `tasks/`, `comments/`, `notifications/`, `files/`, `search/`, `activity/`, `audit/`) are still empty placeholders. See [`../docs/folder-structure.md`](../docs/folder-structure.md) and [`../docs/architecture.md`](../docs/architecture.md).
