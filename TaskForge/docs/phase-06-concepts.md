# Phase 06 — RBAC: Concepts

## What RBAC Is, and What Phases 04/05 Were Doing Instead

**RBAC (Role-Based Access Control)** means permissions are granted to *roles*, and people get permissions by holding roles - rather than permissions being granted to individuals one at a time.

Phases 04 and 05 already had roles (`ADMIN`, `LEAD`) and already enforced them. But they enforced them the *hardcoded* way: `OrganizationAdminGuard` literally asked "is this person's role `ADMIN`?", and `TeamLeadGuard` asked "is this person's role `LEAD`?". That works while there's exactly one privileged role per scope - but it doesn't scale, for a specific reason:

- The question the code asks is **"who are you?"** (are you an ADMIN?) when the question that actually matters is **"what are you trying to do?"** (rename the organization? add a member?).
- Every new role, or every new distinction between actions, means writing a new guard or editing existing ones.

## The Shift: Roles Grant Permissions, Routes Require Permissions

Phase 06 splits that single hardcoded check into two independent halves:

1. **Routes declare a permission**: `@RequirePermission(Permission.OrganizationManage)`. This says what the route *protects*, and nothing about who's allowed.
2. **A table maps roles to permissions**: `ORGANIZATION_ROLE_PERMISSIONS` says which roles currently hold which permissions.

A guard sits between them, reading the required permission off the route and checking it against the requester's role via the table. **The route never mentions a role. The table never mentions a route.**

**Why this matters, concretely:** suppose next month it's decided MANAGERs should also be able to rename the organization. Under the old approach, that means finding every route that renames an organization and editing its guard. Under this approach, it's a one-line change to one table - and every route requiring `organization:manage` picks it up automatically. The e2e tests would then tell you immediately if that change accidentally opened something it shouldn't have.

## Permissions Are Code, Not Database Rows

Roles live in the database (`MembershipRole`, `TeamRole` enums on membership rows), because *which role a person holds* is data that changes at runtime. But the mapping of role → permissions is a **constant in code** (`organization-permissions.ts`), not a table. This is a deliberate choice worth being able to defend:

- Permissions are tied directly to specific routes and guards in the code. A permission that exists in a database but has no route checking it does nothing; a route that checks a permission not defined in code can't compile. Keeping the definition in code means the compiler enforces that the two stay in sync.
- Database-driven permissions (admins defining custom roles with custom permission sets at runtime) is a real feature some products have - but it's genuinely a different, much larger feature, with its own UI and migration concerns. TaskForge doesn't need it, and building it "just in case" would be exactly the over-engineering the project conventions warn against.

## What Changed for MANAGER

`MANAGER` has existed in the schema since Phase 04, deliberately given no distinct behavior ("Phase 06 is where ADMIN/MANAGER/MEMBER actually diverge"). This phase pays that off:

| Permission | ADMIN | MANAGER | MEMBER |
|---|---|---|---|
| `organization:manage` (rename org) | ✅ | ❌ | ❌ |
| `organization:members:manage` (add/remove/re-role members) | ✅ | ❌ | ❌ |
| `organization:teams:manage-any` (manage ANY team) | ✅ | ✅ | ❌ |

A MANAGER runs team structure across the organization but can't touch organization settings or membership. That's a genuine, defensible split - not just "MANAGER = ADMIN with a different label."

## Closing the Phase 05 Gap: The Organization-Level Override

Phase 05's docs explicitly flagged this as a deliberate temporary limitation: *an organization ADMIN had no special power over a team they didn't personally lead.* That was awkward - an admin could be locked out of managing a team in their own organization just because nobody had added them to it.

`TeamPermissionGuard` fixes this with two paths to access, checked in order:

1. **Organization-wide override** - if the requester's *organization* role holds `organization:teams:manage-any` (ADMIN or MANAGER), they're allowed. No team membership required.
2. **Team-level role** - otherwise, their role on *this specific team* must grant the required permission (currently only LEAD).

The override is checked first because it costs nothing (the organization role is already attached to the request by an earlier guard) and it's the common case for an admin acting organization-wide, so it avoids a needless database query.

## Permissions Are Re-Read Every Request, Not Baked Into the Token

One of the e2e tests promotes a member to MANAGER and then, using the **same access token issued before the promotion**, immediately succeeds at an action that was forbidden a moment earlier. This is a real design property worth understanding:

The JWT access token contains only `sub`, `email`, and `jti` (from Phase 03) - **not** the user's role. Every request re-reads the current `Membership` row from the database (via `OrganizationMembershipGuard`) and derives permissions from that. So a role change takes effect on the very next request, with no need to log out and back in.

The alternative - baking the role into the JWT - would make role changes invisible until the token expired (up to 15 minutes), and, worse, a *demotion* wouldn't take effect immediately either: someone demoted for cause could keep acting with their old privileges until their token lapsed. Reading fresh on every request costs one small indexed query and is the right trade for a security-sensitive check.

## Fail Closed

Both guards throw `403` if the route forgot `@RequirePermission(...)`, rather than treating "no permission declared" as "no restriction." A guard attached to a route with a missing declaration is a **configuration mistake** - and the safe response to a mistake in an authorization system is to deny, loudly, not to silently let everyone through. Both cases (missing declaration, missing `request.membership`) have dedicated unit tests.

## What's Still Deferred

- **Projects and tasks.** The roadmap says permissions should "work across organizations, teams, projects, and tasks." Projects don't exist until Phase 07 and tasks until Phase 08, so there's nothing to protect yet. The `Permission` enum, the role tables, and `@RequirePermission` are built to extend to them - Phase 07 adds new `Permission` values and new guards following the same pattern, rather than needing a rework.
- **Custom/database-defined roles.** See above - deliberately not built.
- **"Leave organization/team" self-service.** Still admin/lead-initiated removal only.
