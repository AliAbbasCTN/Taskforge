# TaskForge Backend

A NestJS + TypeScript backend backed by PostgreSQL via Prisma, with JWT authentication and multi-tenant organizations.

## What exists (Phase 04)

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- **Users:** `GET /users/:id` (self, or anyone sharing an organization with you), `PATCH /users/:id`, `DELETE /users/:id` (self only)
- **Organizations:**
  - `POST /organizations` — create one (you become its ADMIN)
  - `GET /organizations` — list organizations you belong to
  - `GET /organizations/:id` — details (members only — 404 for non-members)
  - `PATCH /organizations/:id` — rename (admins only)
  - `GET /organizations/:id/members` — list members (members only)
  - `POST /organizations/:id/members` — add an existing user by email (admins only)
  - `PATCH /organizations/:id/members/:userId` — change a member's role (admins only)
  - `DELETE /organizations/:id/members/:userId` — remove a member (admins only)
- `GET /health` — liveness check that also verifies database connectivity
- Tenant isolation is enforced server-side by `OrganizationMembershipGuard` on every organization-scoped route — a non-member gets 404, never 403
- A "last admin" safety rail prevents an organization from ever ending up with zero admins

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

## Trying the multi-tenancy flow manually

```bash
# Register two accounts
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","name":"Admin","password":"password1"}'
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"outsider@x.com","name":"Outsider","password":"password1"}'

# Using the admin's accessToken, create an organization
curl -X POST http://localhost:3000/organizations \
  -H "Authorization: Bearer <adminAccessToken>" -H "Content-Type: application/json" \
  -d '{"name":"Acme Inc."}'

# The outsider trying to view that org (by id) gets 404, not 403
curl http://localhost:3000/organizations/<orgId> -H "Authorization: Bearer <outsiderAccessToken>"

# Add the outsider as a member (admin-only)
curl -X POST http://localhost:3000/organizations/<orgId>/members \
  -H "Authorization: Bearer <adminAccessToken>" -H "Content-Type: application/json" \
  -d '{"email":"outsider@x.com"}'
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

Domain module folders (`teams/`, `projects/`, `boards/`, `tasks/`, `comments/`, `notifications/`, `files/`, `search/`, `activity/`, `audit/`) are still empty placeholders. See [`../docs/folder-structure.md`](../docs/folder-structure.md) and [`../docs/architecture.md`](../docs/architecture.md).
