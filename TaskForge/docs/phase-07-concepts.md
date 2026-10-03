# Phase 07 — Projects: Concepts

## What a Project Is

A **Project** is a body of work inside an organization — "Apollo", "Website Redesign". It is the thing boards, columns and tasks will hang off in Phase 08. Today a project has a name, an optional description, a status (`ACTIVE` or `ARCHIVED`), and a list of members.

```
Organization
   ├── Teams     → people grouped for org structure (Phase 05)
   └── Projects  → work that people are assigned to (this phase)
```

Teams and projects are **siblings**, not parent and child. A team answers "who do you work with?"; a project answers "what are you working on?". They are deliberately not linked yet — see [What's Deferred](#whats-deferred).

## The Big New Idea: Projects Are Private

Teams are visible to every member of their organization: the organization is the privacy boundary, and a team is closer to a directory entry. **Projects are different — a project is visible only to its own members**, plus organization ADMINs and MANAGERs, who oversee everything.

Why the difference? Projects will contain real work: tasks, comments, attachments. In a real company, the existence of a project called "Reorganization 2027" can itself be sensitive. Being in the organization is therefore *necessary but no longer sufficient* to see a project.

This changes what a guard has to prove. Compare the three levels of nesting we now have:

| Route level | Guard | Question it answers | Failure |
|---|---|---|---|
| `/organizations/:id/...` | `OrganizationMembershipGuard` | Are you in this organization? | 404 |
| `.../projects/:projectId` | `ProjectGuard` | Does it belong to this organization, **and may you see it?** | 404 |
| mutation routes | `ProjectPermissionGuard` | May you do **this** to it? | 403 |

`TeamGuard` only had to answer the *ownership* half of the middle question (the IDOR check). `ProjectGuard` also answers the *visibility* half.

## Why 404 for "you can't see it", but 403 for "you can't do that"

This is the rule worth being able to explain in an interview:

- If you may not **see** a project, the answer is **404 Not Found** — always, on every route, whether the project exists or not. A 403 would confirm "this project exists, you just can't have it", which lets someone probe which IDs are real. 404 is indistinguishable from the project not existing.
- If you **can** see a project but lack the permission for an action (a plain project member trying to rename it), the answer is **403 Forbidden**. You have already proven you may know the project exists, so denying a specific action leaks nothing.

This is why `ProjectGuard` runs *before* `ProjectPermissionGuard`: visibility is settled before permission is considered. An org MEMBER who isn't on a project and tries `PATCH` on it gets 404, not 403.

## Two Sources of Authority

A person can hold authority over a project in two independent ways:

1. **Project membership** — a `ProjectMembership` row with a `ProjectRole` (`LEAD` or `MEMBER`).
2. **Organization oversight** — an organization role (`ADMIN` or `MANAGER`) that holds `Permission.OrganizationProjectsManageAny`.

| Who | See it | Edit / archive / delete / manage members |
|---|---|---|
| Org ADMIN or MANAGER | yes — every project | yes — every project |
| Project LEAD | yes | yes |
| Project MEMBER | yes | no (403) |
| Org MEMBER, not on the project | no (404) | no (404) |
| Not in the organization | no (404) | no (404) |

This mirrors Phase 06's team override (`OrganizationTeamsManageAny`) exactly. Oversight is not a convenience; it is what stops a project from becoming unmanageable. If a project's only lead leaves, someone with oversight can still fix it.

As in Phase 06, the role-to-permission tables live in code (`project-permissions.ts`, `organization-permissions.ts`), and routes only declare what they need (`@RequirePermission(Permission.ProjectManage)`).

## One Query, Not Two

`ProjectGuard` needs the project *and* the requester's membership of it. Instead of two queries it uses one Prisma `include` filtered to the current user:

```ts
this.prisma.project.findUnique({
  where: { id: projectId },
  include: { memberships: { where: { userId }, take: 1 } },
});
```

The membership is attached to the request as `request.projectMembership`, so `ProjectPermissionGuard` is a pure in-memory check with no database access of its own.

The same instinct applies to the list endpoint. Each project comes back with a `memberCount` and the requester's `currentUserRole`. Computing those by looping over the projects afterwards would be the classic **N+1 query problem** (one query for the list, then N more). Instead, `_count` and a filtered `include` fetch everything in the same query.

## Privacy Is Enforced in the Query Itself

For an ordinary org MEMBER, the list query adds `memberships: { some: { userId } }`. That filter is part of the SQL, so a project the requester can't see never leaves the database — it is not fetched and then filtered out in application code, where one forgotten `.filter()` would be a data leak.

## Archive vs. Delete

| | Archive | Delete |
|---|---|---|
| Reversible | yes (`unarchive`) | **no** |
| Data kept | all of it | none |
| Allowed from | `ACTIVE` | `ARCHIVED` only |

Archiving is the *undoable* step. Permanent deletion is only allowed on an already-archived project, which makes an accidental delete much harder (two deliberate steps).

**Why there is no `deletedAt` soft-delete column**, even though `docs/database-plan.md` suggested soft-deletion might suit projects: the plan said to use it "only where undo genuinely matters". Archiving already *is* the undo. A second, hidden "deleted but recoverable" state on top would give users two overlapping concepts for "not active anymore" and force every query to remember to exclude deleted rows. Simpler: one reversible state (archive) and one permanent action (delete).

**An archived project is read-only.** It can be read, unarchived or deleted, but not edited, and its membership can't change. That rule lives in the **service**, not a guard, because it depends on the project's *current* status and applies only to some routes. A useful way to split the work: **guards decide who may act; the service decides whether the action makes sense given the state of the data.**

Archive and unarchive are `POST` actions rather than `PATCH { status }`, because they are state *transitions* with their own rules ("can't archive twice"), not fields you edit.

## Rules the Database Can't Express

Two preconditions live in application code, as they did for teams:

- **You can only join a project if you're already in its organization.** Otherwise the tenant boundary would have a hole in it — a project member who isn't an org member. Adding someone outside the org is a `422`, even when the requester has every permission.
- **A project can't lose its last lead through the API.** Removing or demoting the only `LEAD` is a `409`.

## What We Found and Fixed

Per the project rules, problems in earlier phases are reported rather than silently worked around.

### PROBLEM 1: Removing someone from an organization left their team memberships behind (and would have left project memberships too)

**CAUSE:** A `TeamMembership` points at a `Team` and a `User` — not at an organization `Membership`. Deleting the organization membership therefore deleted nothing else. In Phase 05 this was harmless, because `OrganizationMembershipGuard` blocks a removed user from every organization route anyway. But the stale rows were still there, and if the person was ever **re-added** to the organization, they would silently regain their old team roles (possibly `LEAD`). With projects, the same gap would mean a person removed from an organization could be re-added and instantly see private projects they had been deliberately removed from.

**SOLUTION:** `OrganizationsService.removeMember()` now deletes the user's team memberships and project memberships **in that organization** and the organization membership itself in one transaction (`prisma.$transaction([...])`). It is scoped by organization, so memberships in *other* organizations are untouched, and it is atomic, so a failure can't leave a half-removed user.

**FILES CHANGED:** `backend/src/organizations/organizations.service.ts`, `backend/src/organizations/organizations.service.spec.ts`

**Known consequence:** if the removed person was a project's only lead, the project is left with no lead. An organization ADMIN or MANAGER can still manage it and add a new one. We chose this over blocking the removal, because refusing to remove a departing employee until every project they lead has a successor would make offboarding painful.

### PROBLEM 2: Malformed IDs reached the database from inside guards

**CAUSE:** In NestJS, **guards run before pipes**. Controllers use `ParseUUIDPipe` to reject malformed IDs, but the tenant and ownership guards (`OrganizationMembershipGuard`, `TeamGuard`, and the new `ProjectGuard`) run first, so a request like `/organizations/not-a-uuid/...` handed the raw string to Prisma. Our ID columns are PostgreSQL `uuid` columns, so a malformed value typically makes the query itself fail with a database error rather than returning "no row". No earlier test sent a malformed ID, so this was never exercised.

**SOLUTION:** A small `isUuid()` helper. Each guard now checks ID format first and answers 404 — the same response it gives for an ID that is well-formed but doesn't exist, which fits the "indistinguishable from not found" policy.

**FILES CHANGED:** `backend/src/common/utils/is-uuid.ts` (new), `backend/src/organizations/guards/organization-membership.guard.ts`, `backend/src/teams/guards/team.guard.ts`, `backend/src/projects/guards/project.guard.ts`

## Database Design Decisions

- **`@@index([organizationId, status])` on `Project`:** the main query is "this organization's projects, filtered by status". Because `organizationId` is the leading column, this one composite index also serves plain "all projects in this org", so a separate single-column `organizationId` index would be redundant.
- **`ProjectRole` is its own enum**, not a reuse of `TeamRole` or `MembershipRole`, for the same reason `TeamRole` is separate from `MembershipRole`: authority over an organization, a team and a project are three independent questions.
- **`description` is nullable**, and "no description" is stored as `NULL`, never `""`. Two representations of "empty" invite bugs.
- **`onDelete: Cascade`** from `Organization → Project → ProjectMembership`: deleting an organization removes its projects; deleting a project removes its memberships. No orphaned rows.

## What's Deferred

- **Boards, columns, tasks** — Phase 08. A project's *contents* will bring their own permissions (can a plain member create a task?). Today's tables deliberately cover only what exists now.
- **Team-based project access** ("give the Engineering team access to this project") — not built. Today access is per person. If it's added, it's a new membership source layered on this model, not a rewrite.
- **Pagination, search, sorting** of the project list — Phase 14.
- **Activity history** ("Ada archived this project") — Phase 15.
- **Who may create projects** — currently any organization member. Restricting it would mean adding a permission, which is a one-line change to the role table plus a `@RequirePermission` on the route.
