# TaskForge Backend

A NestJS + TypeScript backend backed by PostgreSQL via Prisma, with JWT authentication, multi-tenant organizations, teams, RBAC, and projects.

## What exists (Phase 07)

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- **Users:** `GET /users/:id` (self, or anyone sharing an organization with you), `PATCH /users/:id`, `DELETE /users/:id`
- **Organizations:** create/list/get/rename, member management, admin-gated mutations, a "last admin" safety rail
- **Teams:** a subdivision within an organization
  - `POST /organizations/:id/teams` — create (any org member; you become its LEAD)
  - `GET /organizations/:id/teams` — list teams in the org (any org member)
  - `GET /organizations/:id/teams/:teamId` — team details (any org member — teams aren't private within their org)
  - `PATCH/DELETE /organizations/:id/teams/:teamId` — rename/delete (team LEAD only)
  - `GET /organizations/:id/teams/:teamId/members` — list members (any org member)
  - `POST/PATCH/DELETE .../members[/:userId]` — manage team membership (team LEAD only)
  - Adding someone to a team requires them to already be an organization member (422 otherwise)
  - A "last lead" safety rail, mirroring the organization's "last admin" rule
- **RBAC:** routes declare the permission they need with `@RequirePermission(Permission.X)`; a single role→permission table (`src/common/authorization/`) decides who holds it
  - `ADMIN` — everything: organization settings, members, and any team
  - `MANAGER` — can manage **any** team in the organization, but not the organization itself or its members
  - `MEMBER` — no organization-wide permissions; can only manage teams they personally lead
  - Organization ADMIN/MANAGER can manage teams they aren't on (closes the Phase 05 gap)
  - Permissions are re-read from the database on every request, so a role change takes effect immediately
- **Projects** (new): private workspaces inside an organization
  - `POST /organizations/:id/projects` — create (any org member; you become its LEAD)
  - `GET /organizations/:id/projects?status=ACTIVE|ARCHIVED` — list the projects **you can see** (default `ACTIVE`); each includes `memberCount` and your `currentUserRole`
  - `GET /organizations/:id/projects/:projectId` — details (project members, and org ADMIN/MANAGER)
  - `PATCH /organizations/:id/projects/:projectId` — edit name/description (project LEAD, or org ADMIN/MANAGER)
  - `POST .../:projectId/archive` and `POST .../:projectId/unarchive` — reversible; an archived project is read-only
  - `DELETE .../:projectId` — permanent; **only allowed once archived** (409 otherwise)
  - `GET .../:projectId/members` — list members (anyone who can see the project)
  - `POST/PATCH/DELETE .../:projectId/members[/:userId]` — manage membership (project LEAD, or org ADMIN/MANAGER)
  - Projects are **private**: an org MEMBER who isn't on a project gets `404` — not `403` — on every route for it, so its existence isn't revealed
  - ADMIN and MANAGER can see and manage every project in their organization (`organization:projects:manage-any`)
  - Adding someone requires them to already be an organization member (422 otherwise); a "last lead" safety rail applies here too
  - Removing someone from an organization now also removes their team and project memberships in it
- `GET /health` — liveness check that also verifies database connectivity
- Nested resource ownership is independently verified at every level — a team or project ID from one organization can't be accessed through a different organization's URL (a classic IDOR pattern, explicitly guarded against and tested)
- Malformed IDs in URLs are answered with `404` by the tenant/ownership guards instead of reaching the database

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

## Where permissions live

| File | Purpose |
|---|---|
| `src/common/authorization/permission.enum.ts` | Every gate-able action, by name |
| `src/common/authorization/organization-permissions.ts` | Organization role → permissions table |
| `src/common/authorization/team-permissions.ts` | Team role → permissions table |
| `src/common/authorization/project-permissions.ts` | Project role → permissions table |
| `src/common/authorization/require-permission.decorator.ts` | `@RequirePermission(...)` for routes |

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

## Trying the projects flow manually

```bash
# Continuing from the teams flow above: <leadToken>, <orgId>, member@acme.com exist.

# Create a project - you become its LEAD
curl -X POST http://localhost:3000/organizations/<orgId>/projects -H "Authorization: Bearer <leadToken>" \
  -H "Content-Type: application/json" -d '{"name":"Apollo","description":"Moon landing"}'

# member@acme.com is an org member but NOT on the project, so for them it does not exist:
curl http://localhost:3000/organizations/<orgId>/projects/<projectId> -H "Authorization: Bearer <memberToken>"   # 404

# Add them to the project, and now they can read it (but not edit it):
curl -X POST http://localhost:3000/organizations/<orgId>/projects/<projectId>/members \
  -H "Authorization: Bearer <leadToken>" -H "Content-Type: application/json" -d '{"email":"member@acme.com"}'

# Archive it, then (and only then) delete it permanently:
curl -X POST   http://localhost:3000/organizations/<orgId>/projects/<projectId>/archive -H "Authorization: Bearer <leadToken>"
curl -X DELETE http://localhost:3000/organizations/<orgId>/projects/<projectId>         -H "Authorization: Bearer <leadToken>"
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

Domain module folders (`boards/`, `tasks/`, `comments/`, `notifications/`, `files/`, `search/`, `activity/`, `audit/`) are still empty placeholders. See [`../docs/folder-structure.md`](../docs/folder-structure.md) and [`../docs/architecture.md`](../docs/architecture.md).
