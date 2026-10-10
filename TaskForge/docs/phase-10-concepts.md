# Phase 10 — Advanced Task Management: Concepts

## What Was Added

Task details, labels, comments, filtering, sorting, pagination, and drag-and-drop. Most of the interesting ideas are about **how data is queried and how a UI stays responsive**, not about new tables.

## Many-to-Many: Labels and the Join Table

A task can have many labels, and a label can be on many tasks. SQL has no "list" column, so this relationship needs a third table — a **join table** (`task_labels`) with one row per (task, label) pair:

```
tasks ──< task_labels >── labels
```

The pair `(task_id, label_id)` is the **primary key**, so attaching the same label twice is impossible by construction, not by hope. An index on `label_id` serves "which tasks have this label?" (the filter); the primary key already serves the other direction.

**Labels belong to one project.** Each project keeps its own vocabulary, and `@@unique([projectId, name])` stops duplicates. The schema can't express "this label and this task are in the *same* project", so `TasksService.setLabels` checks it: otherwise someone could attach — and so learn the name of — another project's label by guessing its ID. That is the same IDOR family as every nested-resource check since Phase 05.

**The API hides the join table.** Prisma returns `labels: [{ taskId, labelId, label: {...} }]`; clients want `labels: [{ id, name, color }]`. One function (`flattenLabels`) translates, so the database's shape never leaks into the API.

**Setting labels is `PUT` with the whole list**, not "add" and "remove" endpoints. The client says what the labels *should be*; the server makes it so. That is idempotent (sending it twice changes nothing) and immune to two people clicking at once producing a muddle of adds and removes.

## Filtering, Sorting, Pagination — On the Server

All three happen in the database query, never in the browser. A browser can only filter what it has already downloaded, and once results are paginated that is just one page.

**Filtering.** `TaskFilterDto` validates each filter (an enum, a UUID) and `buildTaskFilterWhere` turns them into a Prisma `where`. User input is never spliced into SQL text — Prisma parameterizes everything — so filtering is injection-safe by construction.

**The query-string boolean trap.** Query values arrive as strings, and our global `ValidationPipe` uses `enableImplicitConversion`, which converts to the declared type. For `boolean` that is `Boolean(value)` — and `Boolean("false")` is **`true`**. Left alone, `?overdue=false` would filter *for* overdue tasks: silently the opposite of what was asked. `toOptionalBoolean` reads the original text instead, and both a unit test and an e2e test pin the behaviour down. Whenever a value is converted for you, ask what the conversion does to the unexpected cases.

**Sorting** uses an allow-list (`@IsIn([...])`), never "any field name". Two details matter:
- `priority` sorts by the enum's **declared order** in PostgreSQL (`LOW < MEDIUM < HIGH < URGENT`), which is the meaning we want; sorting the *text* alphabetically would put `HIGH` before `LOW` before `URGENT`.
- `dueDate` puts tasks with **no due date last** in either direction. Otherwise "soonest first" would open with a pile of undated tasks.

**A tie-breaker makes paging correct.** Every sort ends with `id`. Without it, rows with equal sort values can come back in any order, so the same row might show up on two pages — or on none — as you page through.

**Pagination.** `page`/`pageSize` ("offset pagination") with a hard `MAX_PAGE_SIZE` of 100: without a cap, `?pageSize=1000000` turns pagination off. The response is an envelope — `{ items, total, page, pageSize, totalPages }` — and the count and the page are fetched in **one transaction** so they describe the same moment.

*Trade-off:* offset pagination is simple and lets a UI jump to "page 3", but if rows are added while someone pages, items can shift between pages. **Cursor pagination** ("give me the 20 after this one") avoids that and stays fast on huge tables, at the cost of no page jumping. For task lists of this size, offset is the right call; the alternative is worth knowing.

**Board view vs. list view.** The board view returns *whole* columns — a kanban lane has to be complete to make sense — and accepts the same filters. The list view returns *one page*. Both are fed by the same query-builder code.

## Authorization That Depends on the Data

Phase 06's guards answer "may you do this *kind* of thing on this route?" Comments need a second kind of rule — one that depends on *which comment*:

| Action | Rule |
|---|---|
| Comment | any project member (`project:tasks:write`) |
| Edit | **only the author** — not even a project lead |
| Delete | the author, **or** a moderator (project lead, org admin/manager) |

A guard runs before the handler and can't see the comment, so the *guard* lets the request in and the *service* decides the data-dependent half. The moderator check reuses the exact same permission logic as the guards through one shared function, **`canActOnProject`** — so the two can never drift apart. (`ProjectPermissionGuard` now calls it too.)

A 403, not a 404, for "not your comment" is deliberate: the requester can already *see* the comment, so refusing reveals nothing — the same reasoning as every earlier phase.

**Comment text is data, never markup.** The API stores it verbatim and the frontend renders it as a React text child, which React escapes. A comment containing `<script>` appears as those literal characters and never runs. There is no `dangerouslySetInnerHTML` anywhere. Likewise a label's colour is validated to `#RRGGBB` on the server *and* checked again by `safeColor` before it reaches a `style` attribute — defence in depth, because CSS injection through an unvalidated colour is a real attack.

## Optimistic Updates

When you drop a card, waiting for the server before moving it feels broken: it snaps back, then jumps. **Optimistic UI** shows the expected result immediately and reconciles afterwards:

1. **`onMutate`** — cancel in-flight refetches (they would overwrite our guess with stale data), remember the current board, and show the expected board via `applyMove`.
2. **`onError`** — the server refused: put the remembered board back.
3. **`onSettled`** — success *or* failure: refetch, so the screen always ends up showing what the server really has, including positions it renumbered.

`applyMove` is a **pure function** that mirrors the backend's reordering rules exactly (take the task out, insert at the index, renumber both columns). Purity is what makes it testable. The mirroring is also its risk: if client and server rules ever disagree, cards visibly jump after each drop — so the two are documented as a pair, with the same clamping rule in `ordering.ts` and the backend's `reorder()`.

*This refines Phase 09's rule that the client never edits its own copy of the board:* it still never treats that copy as truth — the optimistic version only lives until the server's answer replaces it.

## Drag and Drop Without a Library

The browser has a built-in drag-and-drop API:

- The card is `draggable` and, on `dragstart`, puts its id in the drag payload.
- A lane must call `preventDefault()` in `dragover` — **without it the browser refuses to allow a drop at all**, a famously confusing requirement.
- On `drop`, the lane reads the id back and works out *where* from the mouse position: `computeDropIndex` counts the cards whose vertical midpoint is above the cursor. It **skips the dragged card itself**, because the backend inserts at an index among the *other* cards — counting it would be off by one when dragging downward in the same column. Kept free of the DOM (plain numbers), it is unit-tested.

**Why not a library?** This needed no dependency, and avoiding one keeps the project small. The honest cost: the HTML5 drag API doesn't support keyboards, screen readers, or touch screens. So the **"Move to…" menu stays** as the accessible route, calling the same endpoint. A drag-only board would exclude real users.

**Drag-and-drop is switched off while a filter is active.** A drop position is an index among *all* cards in a column, but a filtered lane shows only some. "Between the 2nd and 3rd visible card" no longer maps to a real position, so the board would silently reorder the wrong thing. The menu still works.

## The Task Panel: a Route and a Native Dialog

The panel is a nested route (`.../boards/:boardId/tasks/:taskId`) drawn over the board, so the open task is **in the URL** — linkable, reload-safe, and the back button closes it. It uses the native `<dialog>` element: `showModal()` gives focus trapping, Escape-to-close, and an inert background for free, all painful to build by hand.

Filters and the Board/List view are likewise **URL query parameters**, preserved when the panel opens and closes. Every filter read from the URL is treated as untrusted and validated before use.

## Design Decisions

- **Labels reuse `project:boards:manage`**, not a new permission: they are project *structure* (a shared vocabulary), like boards and columns. Attaching a label to a task is a task edit (`project:tasks:write`).
- **`Comment.authorId` is `SetNull`:** if an account is deleted, its comments stay (a conversation with half its messages missing makes no sense) and show as written by a "Former member". `editedAt` is its own column rather than derived from `updatedAt`, because Prisma also bumps `updatedAt` on creation.
- **No new env vars, no new dependencies** — backend or frontend.

## What's Deferred

- **Full-text search** and index tuning — Phase 14. (The list endpoint filters by exact fields only.)
- **Comment pagination** — comments per task are few; revisit if that changes.
- **Real-time** — done in Phase 11. In this phase another person's comment or move appeared only on refetch.
- **Attachments** — Phase 13.
- **Comment notifications** — done in Phase 11 (the task's assignee is notified). **@mentions** are still not built.
- **Case-insensitive label uniqueness** — "Bug" and "bug" are distinct to the database.
- **Reordering columns by drag** — columns still reorder through the API only.
