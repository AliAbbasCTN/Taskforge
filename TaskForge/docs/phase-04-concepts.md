# Phase 04 — Multi-Tenancy: Concepts

## What "Multi-Tenancy" Actually Means

**WHAT:** Multiple independent customers (organizations) share the same running application and the same database, but each one's data must be completely invisible to every other one.

**WHY this architecture (shared database, not one database per tenant):** A separate database per organization is simpler to reason about for isolation, but it doesn't scale operationally - imagine running migrations across ten thousand databases, or provisioning a new one for every signup. A shared database with an `organizationId` on every tenant-scoped row is the standard approach for SaaS products at TaskForge's stage, and it's what almost every real multi-tenant product (Slack, Notion, Linear) actually does under the hood.

**The one rule everything else follows from:** every piece of organization-scoped data must be reachable only through a query that checks the requester's membership. This has to be enforced on the server, in every request, unconditionally - a frontend that simply "doesn't show" other organizations' data provides no real security at all, since any HTTP client (not just the official frontend) can call the API directly.

## Users vs. Memberships vs. Organizations

**WHAT:** `User` is an account (Phase 02). `Organization` is a tenant (this phase). `Membership` is the join row connecting the two, carrying a `role`.

**WHY a separate join model, rather than an `organizationId` column directly on `User`:** a `User` needs to belong to *multiple* organizations (the same person might work with two different teams on TaskForge), with a potentially different role in each. A single foreign key on `User` could only ever represent one organization at a time. The join model is what makes "Ada is an ADMIN in Acme Corp and a MEMBER in Startup Inc, simultaneously" representable at all.

## Enforcing Isolation With a Guard, Not a Service-Layer Check

**WHAT:** `OrganizationMembershipGuard` runs before any `/organizations/:id/...` route handler, looks up whether the requester has a `Membership` row for that organization, and rejects the request if not.

**WHY a guard, specifically, rather than a check written inside each service method:** a check duplicated inside every service method is a check that's one missed copy-paste away from a real data leak - it only takes one new route where a developer forgets to add the check. A guard applied declaratively (`@UseGuards(...)`) is structurally hard to skip by accident, and it's visible right at the top of the controller, next to the route itself, rather than buried inside business logic several files away.

This is the same reasoning that put global validation in a `ValidationPipe` back in Phase 01 rather than validating manually inside every controller method - centralize the thing that must never be forgotten.

## Why a Non-Member Gets 404, Not 403

This is a small but deliberate choice worth defending in an interview. Returning **403 Forbidden** for a non-member confirms the organization ID is real - you're just not allowed to see it. That's a genuine information leak: if organization IDs were even slightly guessable, an attacker could distinguish "real ID I can't access" from "ID that doesn't exist" just from the status code, and start mapping out which resources exist on the platform.

Returning **404 Not Found** in both cases means a non-member's request is indistinguishable from a request for an organization that was never created at all. This is the same reasoning already applied in Phase 02/03 (a cross-tenant resource lookup returns 404, never 403) - this phase is where that pattern gets its first real test, since organizations are the first genuine tenant boundary in the app.

Contrast this with `OrganizationAdminGuard`: once a request has already passed the membership guard, the organization's existence and the user's membership in it are no longer secret *from that user* - so denying an admin-only action correctly returns 403, not 404. The rule isn't "guards always return 404" - it's "don't reveal more than the requester is already entitled to know."

## A Real Bug We Fixed That Phase 03 Introduced (Without Knowing It Yet)

Phase 03 shipped `GET /users` (list every user) and `GET /users/:id` (view any user's profile) with no restriction beyond "you're logged in." At the time, that was a perfectly reasonable default - there was no concept of a tenant boundary yet, so there was nothing to violate.

Multi-tenancy changes that retroactively. Once organizations exist, "any logged-in user can list every user on the platform" is a genuine tenant-isolation leak: a member of Organization A could enumerate every person in Organization B, with no relationship to them at all. This wasn't a bug when it was written - it became one the moment this phase introduced organizations, and it needed fixing as part of this phase rather than being left as a loose end.

**The fix:**
- `GET /users` (the platform-wide list) was removed outright. There's no legitimate use for it once organizations exist, and its replacement - "see the members of an organization I belong to" - is `GET /organizations/:id/members`, which is properly scoped from the start.
- `GET /users/:id` now requires the requester to either be viewing their own profile, or share at least one organization with the target user. Anyone else gets a 404 - the same "don't confirm existence" reasoning from above.

The e2e test suite has two tests specifically named to make this traceable later: one proving the old cross-tenant leak is now closed (`Phase 03 regression: a member of Org A cannot look up a user who is ONLY in Org B`), and one proving the legitimate case still works (`Phase 03 fix confirmed: users who share an organization CAN look each other up`).

## The "Last Admin" Safety Rail

**WHAT:** `OrganizationsService` refuses to remove or demote a `Membership` with role `ADMIN` if it's the only remaining admin in that organization.

**WHY:** without this, an organization could end up with zero admins - no one able to add members, change settings, or fix anything - through a single accidental click (an admin removing themselves, or another admin demoting them) with no way to recover except direct database access. This is a basic safety rail, not a security boundary - it protects against mistakes, not attacks. Note that it's *narrower* than full role-based permissions: it doesn't yet stop a MANAGER from doing something a MEMBER can't (there's no such distinction implemented yet - see below), it only ever fires on the specific "would this leave zero admins" case.

## Why `MANAGER` Exists in the Enum But Does Nothing Yet

The `MembershipRole` enum has three values (`ADMIN`, `MANAGER`, `MEMBER`) because `docs/database-plan.md` planned for three from Phase 00. But every authorization check built this phase only ever distinguishes `ADMIN` from "everyone else" - `MANAGER` and `MEMBER` are currently treated identically. This is intentional, not an oversight: building out what a `MANAGER` can do that a `MEMBER` can't only makes sense once there's actual organization-scoped data (projects, tasks) for that distinction to apply to. That's Phase 06's job, once Phase 07/08 give RBAC something real to protect. Adding a third permission tier's logic now, with nothing yet for it to gate, would be exactly the kind of premature abstraction this project's conventions warn against.

## Why the Slug Field Exists but Isn't Used for Routing Yet

Every route in this phase uses the organization's UUID (`/organizations/:id`), not its slug. The `slug` column was still added now, with its uniqueness enforced at the database level, because retrofitting a unique, human-readable identifier onto a table that already has thousands of organizations with colliding names is a much bigger migration than reserving the column upfront while the table is empty. It's not being used for anything yet - it's there so a future phase (custom workspace URLs, for instance) doesn't need a disruptive schema change to add it.

## Why the Transaction in `create()` Matters

Creating an organization does two separate writes: insert the `Organization` row, then insert a `Membership` row making the creator its admin. Wrapping both in `prisma.$transaction()` guarantees they succeed or fail together. Without it, a crash or database error between the two inserts could leave an organization in existence with **zero members and no admin** - permanently inaccessible through the API, since every route that reads an organization requires a membership to reach it in the first place.
