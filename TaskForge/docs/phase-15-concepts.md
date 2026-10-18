# Phase 15 — Activity Logs & Audit Trail: Concepts

## The Problem

A project-management tool is a shared workspace, and shared workspaces raise questions:

- *"Who moved this task to Done?"*
- *"When did Max get access to the project — and who gave it to him?"*
- *"Someone deleted Project Apollo. Who, and when?"*

Without a record, the answers are guesses. This phase adds one: an **activity log** that stores *who did what to which thing, and when*, and two ways to read it.

## Activity Feed vs Audit Trail: One Record, Two Audiences

They are the same data viewed for different purposes:

| | Activity feed | Audit trail |
|---|---|---|
| **Question answered** | "What's been happening?" | "Who did that, and was it allowed?" |
| **Audience** | Everyone who can see the project | Organization **admins** only |
| **Scope** | One project (or one task's timeline) | The whole organization — all projects plus membership and settings changes |
| **Endpoint** | `GET /organizations/:id/projects/:projectId/activity` | `GET /organizations/:id/audit-log` |
| **Why separate** | Collaboration and context | Accountability and security — it records who was given which role |

Both read one table, `activity_logs`, and differ only in who may read what scope.

## 1. The Shape of an Entry

> **Lena Lead** *moved task “Fix login” from To Do to Done* — 5 min ago

Stored as structured facts, not as a sentence:

| Column | Example | Meaning |
|---|---|---|
| `organizationId` | uuid | The tenant (the only real foreign key) |
| `projectId`, `taskId` | uuid or null | Where it happened. `taskId` is also set for a task's comments and attachments, so a task's whole timeline is one indexed query |
| `actorId`, `actorName` | uuid, "Lena Lead" | Who did it |
| `action` | `task.moved` | What kind of event |
| `targetType`, `targetId`, `targetName` | `task`, uuid, "Fix login" | What it was done to |
| `metadata` (JSON) | `{from: "To Do", to: "Done"}` | The details |
| `createdAt` | timestamp | When |

The **sentence is built when the entry is read** (`formatActivityMessage`), not stored. The database keeps facts; wording is presentation. Rephrasing — or translating — then applies to the entire history at once, with no data migration. An action the code doesn't recognise (written by a newer version) falls back to a generic sentence instead of failing.

## 2. Records Must Outlive What They Describe: Snapshots, Not Foreign Keys

The most important design decision in this phase.

"Lena deleted project *Apollo*" must still be readable after Apollo is gone. If `projectId` were a foreign key with the usual `ON DELETE CASCADE`, deleting the project would **delete its own history** — exactly the evidence you wanted.

So:

- `projectId`, `taskId` and `targetId` are **plain ids with no foreign key**. Deleting the thing leaves the history alone.
- **Names are copied in at the time of the event** (`targetName`, `actorName`). The title of a deleted task, the name of a removed member, the old column of a move are all captured *before* the change.
- `organizationId` **is** a real foreign key: deleting an entire tenant deletes its history, which is correct.
- `actorId` is `ON DELETE SET NULL`: deleting a user account clears the link, but `actorName` keeps the entry attributable ("Max Member", not "unknown").

This is the **snapshot** idea you'll meet again anywhere history matters: an invoice copies the product's price and name rather than pointing at a product that may change.

## 3. Append-Only, Enforced by the Database

An audit trail is only trustworthy if entries cannot be edited. The application has no code that updates or deletes them — but a bug, or anyone with database access, could. So the database refuses.

A **trigger** (`activity_logs_no_update`) raises an error on any `UPDATE`. One change is allowed: the one PostgreSQL itself performs when a user is deleted (`ON DELETE SET NULL` clears `actor_id`). The trigger permits exactly that — `actor_id` going from a value to `NULL` with every other column unchanged — and nothing else. (Row *deletes* aren't blocked, since deleting an organization legitimately cascades.)

*Honest limit:* a database superuser can drop the trigger. Tamper-evidence against a determined insider needs things outside this app — write-once storage or shipping logs to a separate system. This is an appropriate level for the project; it's worth knowing where it stops.

Like Phase 14's search trigger, this lives in SQL that Prisma's schema diffing doesn't see, so future migrations stay clean.

## 4. How Actions Get Recorded: a Decorator and an Interceptor

There are two obvious places to write log entries:

1. **Inside every service method** — precise, but it means threading the actor and organization into methods that don't have them (`move`, `remove`, `setLabels` take neither), changing many signatures, and a log call in every service forever. Easy to forget one.
2. **In one cross-cutting layer** — declare *what* in the controller, keep *how* out of it.

TaskForge uses the second, the same pattern as Phase 11's real-time events:

```ts
@Post(':taskId/move')
@LogsActivity('task.moved')
move(...) { ... }
```

`ActivityInterceptor` (registered globally) does the rest:

1. **Guards run first.** A request that isn't authenticated or authorized never reaches an interceptor, so everything logged was really allowed.
2. If the action needs one, it takes a **snapshot** *before* the handler runs — the title a delete is about to destroy, the column a move is about to leave.
3. The handler runs. **If it throws (400, 404, …) nothing is logged** — a failed request changed nothing.
4. On success, the action's **describer** turns *request + response + snapshot* into entries.

### Describers: pure functions in one table
`ACTIVITY_SPECS` maps each action to a pure function. Examples of the thinking encoded there:

- **A move within one column isn't an event**; a move to a different column is — it's a *status change*, so it records `from` and `to` column names.
- **Assignment gets its own event.** One `PATCH` that renames *and* reassigns a task yields two entries, `task.updated` and `task.assigned` — "assigned to Max" reads better in a feed than "updated assigneeId", and people filter on it. Those two are **derived actions** (valid, stored and filterable, but never attached to a route).
- **A "role change" to the same role isn't an event.**
- Describers read JSON defensively. A missing field gives a missing name, never an exception.

Because they're pure functions, they are tested with plain objects — no HTTP, no database.

### Ordering within one request
One request can yield several entries inserted in a single statement, which would give them the *same* timestamp, and the feed's tie-breaker (a random id) would shuffle them. Each entry is stamped 1 ms after the previous one, in described order, so the story reads correctly.

## 5. Best-Effort vs Transactional: an Honest Trade-off

The interceptor logging is **best-effort**: if writing the entry fails, the error is logged on the server and the user's request still succeeds.

- **Strict alternative:** write the entry in the *same database transaction* as the change, so there is never a change without a record (or a record without a change).
- **Why we didn't:** it means passing the actor and tenant through every service method, and tying audit logging to every transaction — a large, invasive change for a portfolio-scale app.
- **The consequence to understand:** if the database fails *between* the change and its log write, the change exists without an entry. Systems with regulatory audit requirements (finance, healthcare) use the transactional approach — or an outbox pattern, as in Phase 12's notifications.

Knowing both options, and being able to say why you chose one, is the interview-worthy part.

## 6. What We Do *Not* Record

- **Failed or forbidden requests.** Logging denied attempts is valuable for security monitoring, but is a different feature (and a different volume). Listed under future work.
- **Reads.** Who *viewed* something is access logging, not an audit of changes.
- **Boards' columns, labels, and teams** (and edits to comments). The pattern makes each of these one decorator plus one describer; they were left out to keep the phase focused.
- **IP address and user agent.** Common in real audit logs, but behind a proxy `request.ip` is only trustworthy once Express's "trust proxy" is configured correctly — a production-hardening step for Phase 20 — and storing IPs has privacy implications.

## 7. Reading It Safely

- **Authorization.** The project feed uses the same chain as every project route (token → organization membership → project access): a project you can't see is a `404`. The audit trail adds a new permission, `organization:audit:read`, held by **ADMIN only** — it reveals who got which role, so even managers don't get it.
- **Tenant isolation.** Every query filters by `organizationId`, *in addition to* the route guards; and the project feed always pins the project from the URL (a `projectId` in the query string is ignored there).
- **Validation.** `action` must be a real action, ids must be UUIDs, `from`/`to` must be ISO-8601, `pageSize` is capped.
- **No joins.** Names are snapshots on the row, so reading a page is one query plus a count.
- **Stable paging.** Newest first, with the id as tie-breaker, backed by `(organization_id, created_at DESC)`, `(project_id, created_at DESC)` and `(task_id, created_at DESC)` indexes — each matches one way the log is read.

## 8. The Frontend

- **Task panel → Activity:** the task's latest 10 events (the project feed filtered by `taskId`).
- **Project page → Recent activity:** paged feed.
- **Audit log page** (`/orgs/:orgId/audit-log`, linked for admins): filter by action and date range, paged. Hiding the link from non-admins is a convenience only; the server answers `403`.
- **Live:** any real-time project change also refreshes the feeds.
- Names and titles are rendered as React text (escaped), and times are relative ("5 min ago") with the exact moment in a tooltip.

## Known Limitations and Future Work

- Best-effort logging (section 5); no record of denied requests, reads, columns, labels, teams or comment edits.
- No retention policy: the table only grows. A scheduled job (Phase 12's maintenance queue) could archive or purge old entries, balancing compliance against storage.
- The activity feed has no actor filter in the UI (the API supports `actorId`).
- Offset pagination, as elsewhere: entries arriving while you page can shift results.
- Audit entries don't link to deleted things (nothing to link to) — the snapshot name is all there is, by design.

## Where to Look

| Concern | File |
|---|---|
| Table, indexes, append-only trigger | `backend/prisma/migrations/20261018120000_add_activity_logs/migration.sql` |
| The decorator | `backend/src/activity/activity.decorator.ts` |
| Recording flow | `backend/src/activity/activity.interceptor.ts` |
| What each action records | `backend/src/activity/activity-describers.ts` |
| "Before" snapshots | `backend/src/activity/activity-snapshot.service.ts` |
| Sentences | `backend/src/activity/activity-message.ts` |
| Storing and querying | `backend/src/activity/activity.service.ts` |
| Routes | `backend/src/activity/activity.controller.ts` |
| UI | `frontend/src/pages/AuditLogPage.tsx`, `components/ActivityList.tsx`, `TaskActivity.tsx`, `ProjectActivity.tsx` |
