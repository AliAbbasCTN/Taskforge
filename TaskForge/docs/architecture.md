# TaskForge — Architecture Overview

## 1. What TaskForge Is

TaskForge is a **multi-tenant SaaS project management platform**. "Multi-tenant" means many separate customers (organizations) share the same running application and database, but each organization's data is completely isolated from every other organization's data.

Think of it like Slack or Notion: one company runs the software, but each customer (workspace/organization) only ever sees their own data.

## 2. Actors / User Roles

| Actor | Description |
|---|---|
| **User** | An individual account. A user can belong to multiple organizations. |
| **Organization Owner/Admin** | Full control over an organization: billing (future), members, teams, projects, settings. |
| **Manager** | Can manage projects and teams they're responsible for, but not organization-wide settings. |
| **Member** | Can work on tasks within projects/teams they've been added to. |

Roles are scoped **per organization** — a user can be an Admin in Organization A and a Member in Organization B at the same time.

## 3. Core Domain Entities

```
User
  └── OrganizationMembership (role: ADMIN | MANAGER | MEMBER)
        └── Organization
              └── Team
                    └── TeamMembership
              └── Project
                    └── ProjectMembership
                          └── Board
                                └── Column
                                      └── Task
                                            ├── Comment
                                            ├── Attachment
                                            └── ActivityLog
```

Key relationships:

- A **User** can belong to many **Organizations** (via `OrganizationMembership`).
- An **Organization** owns **Teams** and **Projects**.
- A **Project** belongs to exactly one **Organization**.
- A **Board** belongs to exactly one **Project** (a project can have one or more boards).
- A **Board** has ordered **Columns** (e.g. To Do / In Progress / Done).
- A **Column** contains ordered **Tasks**.
- A **Task** can have **Comments**, **Attachments**, an **Assignee**, **Labels**, a **Priority**, and a **Due Date**.
- Every meaningful mutation produces an **ActivityLog** entry for audit/history purposes.

This structure is introduced gradually — Phase 02 starts with only `User`, and later phases add `Organization`, `Team`, `Project`, `Board`, `Column`, `Task`, etc., one layer at a time.

## 4. High-Level System Architecture

TaskForge is built as a **modular monolith**, not microservices. This is a deliberate choice:

- A single deployable backend service is far simpler to build, test, deploy, and reason about for a project of this scope.
- "Modular" means the codebase is still cleanly separated into independent modules (auth, organizations, projects, tasks, etc.) with clear boundaries — so it could be split into microservices later if it ever needed to be, but we don't pay that complexity cost upfront.
- Microservices solve organizational/scaling problems TaskForge doesn't have. Introducing them here would be over-engineering.

```
                         ┌─────────────────────────┐
                         │        Frontend         │
                         │   React + TS + Vite      │
                         └────────────┬─────────────┘
                                      │ REST + WebSocket
                                      ▼
                         ┌─────────────────────────┐
                         │      NestJS Backend      │
                         │  (Modular Monolith)      │
                         │                          │
                         │  auth · users · orgs     │
                         │  teams · projects        │
                         │  boards · tasks          │
                         │  comments · files        │
                         │  notifications · search  │
                         │  activity · audit        │
                         └───┬───────────┬──────────┘
                             │           │
                 ┌───────────▼──┐   ┌────▼────────┐
                 │ PostgreSQL   │   │   Redis     │
                 │ (Prisma ORM) │   │ (BullMQ +   │
                 │              │   │  caching)   │
                 └──────────────┘   └─────────────┘
```

## 5. Backend Architecture

NestJS enforces a modular structure out of the box. Each domain area is its own **module**, containing:

- `*.module.ts` — wires the module together (declares controllers, providers, imports)
- `*.controller.ts` — handles HTTP routes, delegates to services (no business logic here)
- `*.service.ts` — business logic
- `dto/` — Data Transfer Objects, used for request validation
- `entities/` or reliance on Prisma-generated types
- `*.spec.ts` — unit tests colocated with the code they test

Cross-cutting concerns (guards, interceptors, pipes, filters, decorators used across modules) live in `src/common/`. Configuration loading lives in `src/config/`. The Prisma client wrapper lives in `src/database/`.

## 6. Multi-Tenancy Strategy

TaskForge uses a **shared database, shared schema** multi-tenancy model: all organizations' data lives in the same PostgreSQL database and the same tables, distinguished by an `organizationId` foreign key.

Why this approach (vs. one database per tenant):
- Simpler to operate and migrate.
- Sufficient isolation when enforced correctly at the application layer.
- Common pattern for small-to-mid SaaS products; the same pattern used by many real companies at this stage.

**Enforcement rule (non-negotiable):** every query that touches organization-scoped data must filter by `organizationId`, and that `organizationId` must come from the authenticated user's verified membership — never from a client-supplied value alone. This is enforced in guards/services on the backend. The frontend restricting access is not sufficient and is never trusted.

## 7. Authentication & Authorization Strategy

- **Authentication** (who are you?): JWT access tokens (short-lived) + refresh tokens (longer-lived, rotated, stored securely) issued at login.
- **Authorization** (what are you allowed to do?): Guards check the user's role within the specific organization/project/resource being accessed — introduced incrementally starting with basic route protection (Phase 03) and growing into full RBAC (Phase 06).

## 8. Real-Time Strategy

WebSockets (via NestJS's Socket.IO gateway support) will be introduced in Phase 11, once there's meaningful task/board state worth broadcasting. Clients join "rooms" scoped to a project or board, and receive events like `task.updated` or `task.moved`.

## 9. Background Jobs Strategy

Redis + BullMQ are introduced in Phase 12 for work that shouldn't block the HTTP request/response cycle — e.g. sending notification emails, generating exports, or processing uploaded files.

## 10. File Storage Strategy

- **Development:** files are stored on local disk under a git-ignored directory.
- **Production:** the same upload interface is backed by AWS S3, using an abstraction so the rest of the app doesn't care which storage backend is active.

## 11. Why This Order (Roadmap Rationale)

The roadmap intentionally builds bottom-up:

1. Backend fundamentals first (Phase 01) — no point building UI for an API that doesn't exist.
2. Database next (Phase 02) — everything else depends on the data model.
3. Auth next (Phase 03) — almost everything else depends on knowing who the user is.
4. Multi-tenancy next (Phase 04) — the core concept the whole platform is built around.
5. Teams → RBAC → Projects → Boards/Tasks — each layer builds on the previous domain layer.
6. Frontend (Phase 09) — only introduced once there's a real API worth building a UI for.
7. Advanced features (real-time, jobs, files, search, activity) — layered on top of a working core product.
8. Documentation, testing, Docker, CI/CD, production hardening — professionalize what's already built.

This mirrors how real production systems are actually built, and avoids the common beginner mistake of building UI against a backend that keeps changing shape.
