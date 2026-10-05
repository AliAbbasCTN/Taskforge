# Phase 08 — Boards, Columns & Tasks: Concepts

## The Shape of the Data

```
Project
  └── Board          (a project can have several)
        └── Column   ("To Do", "In Progress", "Done" ...)
              └── Task
                    └── assignee → User (optional)
```

Everything here hangs off a **Project**, so everything inherits Phase 07's rules: only project members (and org ADMIN/MANAGER) can see any of it, and everything is deleted with its project (`onDelete: Cascade` all the way down).

Notice what's *missing*: no `organizationId` on `Board`, `BoardColumn` or `Task`. Ownership flows down the chain — task → column → board → project → organization — and the request guards verify each link. Storing the organization ID again on every row would be redundant data that could disagree with the real chain.

## Status Is a Column, Not a Field

The roadmap lists "status" among a task's properties. In TaskForge, **a task's status *is* which column it sits in.** There is no `status` column on `Task`.

Why? If both existed, they could disagree — a task in the "Done" column with status "In Progress" — and every piece of code would need to keep them in sync. With a single source of truth, "change the status" and "move the task" are the same operation, and the invalid state simply can't be represented. (The test suite even checks that sending a `status` field is rejected.)

## Ordering: Dense Positions, Renumbered in a Transaction

Columns on a board and tasks in a column have an order, stored as a zero-based `position`. The interesting question is how to keep that order correct when things move.

Options:

| Approach | Problem |
|---|---|
| `UNIQUE (parent, position)` | Swapping two items is impossible without briefly violating the constraint |
| Fractional positions (1.5 between 1 and 2) | Needs periodic rebalancing; harder to read and test |
| **Dense integers, renumber on change** ✅ | A few extra row updates per move |

Boards hold tens of items, not millions, so renumbering a handful of rows is cheap, and the data stays trivially readable (`position 0` is first). The cost is that a move touches several rows — so it **must be one transaction**. Without that, a failure half-way (or two requests interleaving) could leave two tasks with the same position, or one task missing from both its old and new column.

The logic is split deliberately:

- `common/utils/ordering.ts` — **pure functions** (`reorder`, `positionChanges`) that compute *what the new order is* and *which rows actually changed*. No database, so they are trivial to unit-test.
- The services run those inside `$transaction` and persist only the rows that changed.

**Moving a task between columns** is two orderings changing at once: the source column closes the gap, the target column makes room. It is its own route (`POST .../tasks/:taskId/move`) rather than a field on `PATCH`, because it isn't "editing a property" — it's a coordinated change to two lists.

**Known limit, stated honestly:** there is no database constraint preventing two concurrent moves from producing duplicate positions. The transaction prevents partial updates, not every race. Reads sort by `(position, createdAt)`, so a collision shows up as a stable, harmless tie-break and the next move renumbers it away. A truly strict guarantee would need row locking, which is more than a task board needs.

## Two Kinds of Permission: Structure vs. Content

Phase 07 gave projects management permissions. Phase 08 adds the first permissions for what's *inside* a project, and splits them on purpose:

| Permission | Covers | Project LEAD | Project MEMBER |
|---|---|---|---|
| `project:boards:manage` | Create / rename / delete boards; add / rename / move / delete columns | ✅ | ❌ |
| `project:tasks:write` | Create / edit / assign / move / delete tasks | ✅ | ✅ |
| *(none — visibility only)* | Read boards and tasks | ✅ | ✅ |

The reasoning: restructuring a workflow changes everyone's board, so it's not left to every contributor; day-to-day work on tasks is exactly what members are there to do. Org ADMIN/MANAGER hold both through the Phase 07 oversight rule — no new code was needed for that, because `ProjectPermissionGuard` already treats oversight as satisfying *any* required permission.

This is the payoff of Phase 06's design: two new permissions meant two new enum entries, two lines in the role table, and a `@RequirePermission(...)` per route. No guard was rewritten.

## Archived Projects: Now a Guard

In Phase 07, "an archived project is read-only" lived in the service, because there were few routes. Phase 08 adds about fifteen write routes in two modules. Repeating a status check in each is exactly where one missed copy would let someone edit an archived project.

So it became a small guard, `ProjectActiveGuard`: `ProjectGuard` has already loaded the project onto the request, so checking `request.project.status` costs **no extra query**. It runs *after* `ProjectPermissionGuard`, giving the ordering **403 (you may not) → 409 (you may, but not right now)** — and someone without permission learns nothing about the project's state.

## Five Levels of Nesting, Five Ownership Checks

A task URL looks like:

```
/organizations/:id/projects/:projectId/boards/:boardId/tasks/:taskId
```

Every segment is untrusted input, and each one needs its own ownership proof, or it's an IDOR:

| Segment | Verified by | How |
|---|---|---|
| `:id` | `OrganizationMembershipGuard` | a Membership row exists |
| `:projectId` | `ProjectGuard` | belongs to `:id`, and you may see it |
| `:boardId` | `BoardGuard` | `board.projectId === request.project.id` |
| `:columnId` | `ColumnsService` | query is `WHERE id = ? AND boardId = ?` |
| `:taskId` | `TasksService` | query is `WHERE id = ? AND column.boardId = ?` |

The first three are guards; the last two are **scoped queries** — the ownership condition is part of the `WHERE` clause itself, so a foreign ID returns "no row" (404) and there's no separate check to forget. Both approaches give the same result: a resource belonging elsewhere is indistinguishable from one that doesn't exist.

IDs referenced in a request **body** (a task's `columnId`, an `assigneeId`) are different: the URL was valid, the *content* isn't. Those answer **422 Unprocessable Entity**, consistent with Phases 05 and 07.

## Assignees Must Be Project Members

An assignee must be a member of *the project* — not just the organization. Projects are private, so assigning work to an org member who can't see the project would hand them a task they can't open.

That rule has to *stay* true as people leave, so two existing flows were extended:

- Removing someone from a **project** unassigns their tasks in it.
- Removing someone from an **organization** unassigns their tasks anywhere in it.

Both happen in the **same transaction** as the removal. The tasks themselves survive — only the assignment is cleared. (If a user *account* is deleted outright, `onDelete: SetNull` on `assigneeId` does the same at the database level.)

## Default Columns, and Why a Board Starts Non-Empty

Creating a board also creates *To Do / In Progress / Done*. It is one nested Prisma `create`, which executes atomically, so a board can never exist without its starting workflow. They're ordinary columns afterwards: rename, reorder, add more, delete when empty.

A column that still has tasks **cannot be deleted** (409). Silently deleting — or silently relocating — someone's work as a side effect of tidying the board would be a nasty surprise, so the caller must move or delete the tasks first.

## The Board View: One Query

`GET .../boards/:boardId` returns columns (ordered) → tasks (ordered) → assignee, in a **single query** with nested `include`s. Loading tasks per column, or assignees per task, in a loop would be the N+1 problem. Assignees are fetched through `SAFE_USER_SELECT`, so credential fields are never even read.

It isn't paginated: a board holds tens of tasks. Filtering, search and pagination are Phases 10 and 14.

## Database Decisions

- **`BoardColumn`, not `Column`:** avoids colliding with the SQL/ORM meaning of "column" everywhere it appears in code and docs. Table: `board_columns`.
- **Indexes:** `(board_id, position)` and `(column_id, position)` match the exact queries — "this board's columns in order", "this column's tasks in order". `assignee_id` is indexed because the cleanup flows above filter by it.
- **`description` and `dueDate` are nullable**, and "none" is `NULL`, never `""`.
- **`assigneeId` uses `onDelete: SetNull`**, the one place in the schema where deleting the parent should *not* delete the child.

## What Changed in Earlier Code

Not problems — extensions required to keep an invariant true:

- `ProjectsService.removeMember()` and `OrganizationsService.removeMember()` now also unassign the departing member's tasks (see above).
- `PROJECT_ROLE_PERMISSIONS` gained the two content permissions, and MEMBER's list is no longer empty.
- `ProjectsService.remove()`'s comment, which said deletion "will cascade" to boards and tasks, is now simply true.

## What's Deferred

- **Labels** — your roadmap lists them in both Phase 08 and Phase 10, while `docs/database-plan.md` places the `Label`/`TaskLabel` tables in Phase 10 (with comments). This phase follows the database plan, so labels arrive with the rest of advanced task management.
- **Comments, attachments** — Phases 10 and 13.
- **Task filtering, search, pagination, sorting** — Phases 10 and 14.
- **Real-time board updates** — Phase 11. (Moving a task is already a single clean operation, which is what a WebSocket event will announce.)
- **Activity history** ("Ada moved this to Done") — Phase 15.
- **A frontend** — Phase 09. The board view endpoint is shaped to feed a kanban UI directly.
