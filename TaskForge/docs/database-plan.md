# TaskForge — Initial Database Plan

This document describes the **planned** database evolution, phase by phase. Nothing here is implemented yet — real Prisma schemas and migrations begin in Phase 02. This is a map, not a final schema.

## Guiding Principles

- Introduce models only when a phase actually needs them (no speculative schema).
- Every table gets `id`, `createdAt`, `updatedAt` at minimum.
- Use proper foreign keys and `onDelete` cascade rules — never orphaned rows.
- Use enums for fixed sets of values (roles, statuses, priorities) instead of free-text strings.
- Add indexes on foreign keys and frequently-filtered columns (e.g. `organizationId`, `status`).
- Prefer soft-deletion (`deletedAt`) only where "undo" or audit history genuinely matters (e.g. Projects, Tasks) — not everywhere by default.

## Entity Introduction by Phase

| Phase | Models Introduced |
|---|---|
| 02 | `User` |
| 03 | `passwordHash`, `hashedRefreshToken` fields added to `User` |
| 04 | `Organization`, `Membership` (with `MembershipRole` enum) |
| 05 | `Team`, `TeamMembership` |
| 06 | (role/permission fields on membership models — no new tables initially) |
| 07 | `Project`, `ProjectMembership` (with `ProjectStatus` and `ProjectRole` enums) — implemented; see `docs/phase-07-concepts.md` |
| 08 | `Board`, `BoardColumn`, `Task` (with `TaskPriority` enum) — implemented; see `docs/phase-08-concepts.md`. Labels stay in Phase 10 as planned |
| 10 | `Comment`, `Label`, `TaskLabel` — implemented; see `docs/phase-10-concepts.md` |
| 11 | `Notification` — implemented; see `docs/phase-11-concepts.md`. (The original plan listed no new tables for this phase; the in-app inbox needs a durable record, because a socket message alone is lost if the user is offline.) WebSocket events themselves reference existing models and are not stored |
| 12 | (BullMQ job data — not stored in Postgres, lives in Redis) |
| 13 | `Attachment` |
| 14 | (full-text search indexes on existing tables — no new tables) |
| 15 | `ActivityLog` |

## Conceptual Entity-Relationship Sketch

```
User ──< OrganizationMembership >── Organization
                                        │
                                        ├──< Team ──< TeamMembership >── User
                                        │
                                        └──< Project ──< ProjectMembership >── User
                                                │
                                                └──< Board ──< Column ──< Task
                                                                            │
                                                                            ├──< Comment
                                                                            ├──< Attachment
                                                                            ├──< TaskLabel >── Label
                                                                            └──< ActivityLog
```

## Planned Enums

- `MembershipRole`: `ADMIN`, `MANAGER`, `MEMBER`
- `TaskStatus`: derived from `Column` (status is really "which column"), but a simple `TaskPriority` enum will exist: `LOW`, `MEDIUM`, `HIGH`, `URGENT`
- `ProjectStatus`: `ACTIVE`, `ARCHIVED` (implemented in Phase 07; archiving replaces a `deletedAt` soft-delete column — see `docs/phase-07-concepts.md`)
- `ProjectRole`: `LEAD`, `MEMBER` (implemented in Phase 07)

## Notes on Multi-Tenant Data Isolation at the Database Level

Every organization-scoped table (`Team`, `Project`, `Board`, `Column`, `Task`, etc.) will carry an `organizationId` foreign key (directly or transitively), and services will always filter by it. This is planned from the start so it isn't retrofitted awkwardly later.

## Migrations Strategy

- Prisma Migrate will be used (`prisma migrate dev` locally, `prisma migrate deploy` in CI/production).
- Every schema change ships with a generated migration file committed to the repo — never hand-edited SQL unless explicitly called out and explained.
