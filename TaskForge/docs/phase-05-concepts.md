# Phase 05 — Teams: Concepts

## Why Teams Are a Separate Layer, Not Just "More Organizations"

**WHAT:** A `Team` is a smaller working group *within* an `Organization` - e.g. "Engineering" or "Design" inside Acme Corp.

**WHY not just make every team its own Organization:** the Organization is TaskForge's actual tenant boundary - the thing that isolates one customer's data from another's. A Team is a subdivision of *people already inside one tenant*, not a separate tenant itself. Collapsing the two concepts would mean losing the ability to say "these two groups of people work for the same company and should be able to see each other's team directory," which is exactly what real organizations need (an engineer can see that a Design team exists, even without being on it).

## Nested Resources Need Their Own Ownership Check (The IDOR Pattern)

**WHAT:** Every team route lives under `/organizations/:id/teams/:teamId/...`. `OrganizationMembershipGuard` confirms the requester belongs to organization `:id`. But that alone is NOT enough to trust `:teamId`.

**WHY:** Nothing about "you're a member of organization X" tells you anything about which `teamId` values belong to organization X. Without an independent check, someone could take a real team ID belonging to a *different* organization (Organization B) and substitute it into a URL under an organization they legitimately belong to (Organization A) - `/organizations/<org-A-id>/teams/<team-from-org-B>`. If the app only checked "is `:id` an org I belong to" and then blindly trusted `:teamId`, it would happily return Organization B's team data to a completely unrelated user.

This class of bug has a name - **IDOR, Insecure Direct Object Reference** - and it's one of the most common real-world API vulnerabilities. It happens whenever an app authorizes access to a *parent* resource (the organization) but forgets to independently verify that a *nested* resource (the team) actually belongs to that parent.

**The fix:** `TeamGuard` explicitly checks `team.organizationId === request.params.id` and 404s if they don't match - exactly the same status code as a team that doesn't exist at all, so the mismatch can't be distinguished from a typo. There's a dedicated e2e test for exactly this scenario (`IDOR CHECK: a team ID from a DIFFERENT organization returns 404`), because this is a case regular manual testing ("does my own team page load?") would never catch - it only shows up when you deliberately try to access someone else's nested resource through your own valid parent.

## Two Different Guards, Two Different Failure Reasons

This phase has four guards stacked together (`JwtAuthGuard`, `OrganizationMembershipGuard`, `TeamGuard`, `TeamLeadGuard`), and it's worth being precise about what each one is actually protecting against, because they return different status codes for principled reasons:

| Guard | Question it answers | Failure code | Why |
|---|---|---|---|
| `JwtAuthGuard` | Are you logged in at all? | 401 | No identity yet |
| `OrganizationMembershipGuard` | Do you belong to this organization? | 404 | Hides whether the org exists from non-members |
| `TeamGuard` | Does this team actually belong to this organization? | 404 | Prevents the IDOR case above; also hides nonexistent teams |
| `TeamLeadGuard` | Do you have LEAD permissions on THIS team? | 403 | You already know the team exists (any org member can see it) - this is denying an action, not hiding a resource |

Notice `TeamLeadGuard` returns 403, not 404, even though it's very similar in spirit to `OrganizationMembershipGuard`. The difference is what the requester already knows by the time each guard runs: a non-org-member genuinely doesn't know the organization exists, so 404 hides that. But by design, any org member can already see every team in their org (teams aren't private) - so refusing a *mutation* doesn't need to pretend the team doesn't exist. This is the same "don't reveal more than the requester is already entitled to know" principle from Phase 04, applied one layer deeper.

## The Cross-Guard Data Passing Pattern

`TeamGuard` fetches the team row and attaches it to `request.team`. `TeamLeadGuard` (which runs right after it) reads `request.team.id` to look up the current user's membership - it never re-fetches the team itself. This mirrors exactly how `OrganizationMembershipGuard` attaches `request.membership` for `OrganizationAdminGuard` to read in Phase 04. The pattern generalizes: **a guard that establishes a fact should attach the evidence for that fact to the request**, so later guards (and route handlers, via decorators) don't have to redo the same database work. Guard order is load-bearing here, not just stylistic - `TeamLeadGuard` would crash (or silently misbehave) if it ran before `TeamGuard` had a chance to set `request.team`.

## Why a Team Membership Requires an Existing Organization Membership

**WHAT:** `TeamsService.addMember()` checks that the target user already has a `Membership` row for the team's organization *before* creating the `TeamMembership` row - and rejects with `422 Unprocessable Entity` if they don't.

**WHY this isn't a database constraint:** there's no way to express "this foreign key is only valid if ANOTHER, unrelated foreign key relationship also exists" as a simple SQL constraint (that would need a database trigger, or a composite/check constraint referencing two different tables - possible, but a lot of machinery for one business rule). This is exactly the kind of precondition that belongs in application code, checked explicitly, with a clear error message - rather than forced awkwardly into the schema.

**WHY 422, not 400 or 404:** the request is well-formed (a valid email, a real user) - it's not a validation failure. And the user genuinely exists - it's not a "not found" situation either. What's wrong is that the *combination* of "this specific user" and "this specific team" doesn't satisfy a business rule. `docs/api-conventions.md` reserves 422 for exactly this: semantically invalid data that passes basic validation.

## Reusing a Guard Across Two Modules Without Coupling Them

`OrganizationMembershipGuard` lives in `src/organizations/guards/`, but `TeamsModule` also registers it as one of its own providers, rather than importing the whole `OrganizationsModule`. NestJS guards used via `@UseGuards(SomeClass)` must be resolvable through the current module's dependency injection - registering the same guard *class* in two modules' `providers` arrays creates two separate instances of a small, stateless class (its only dependency is the globally-available `PrismaService`), at zero cost, while keeping `TeamsModule` from needing to know anything about `OrganizationsModule`'s controllers or internals. This is a deliberate, narrow exception to "don't duplicate code" - it's duplicating a *provider registration*, not the logic itself, in exchange for real module independence.

## The "Last Lead" Rule Mirrors "Last Admin" Exactly

`TeamsService.assertNotLastLead()` is structurally identical to `OrganizationsService.assertNotLastAdmin()` from Phase 04 - same reasoning (a resource should never end up with zero people able to manage it), same shape (count the privileged role, refuse if the count would hit zero). This repetition is intentional, not an oversight: the two checks operate on different tables (`Membership` vs. `TeamMembership`) and different roles (`ADMIN` vs. `LEAD`), and a shared generic "assert not last privileged member" helper would need to know about both tables' shapes to be reusable - premature abstraction for two call sites. If a third such check appears in a future phase, that's the point where extracting a shared helper actually starts paying for itself.

## What's Deliberately Left Out This Phase

- **No "leave organization/team" self-service route** - removal is admin/lead-initiated only, same limitation noted in Phase 04.
- **No organization-ADMIN override on teams.** An org ADMIN has no special power over a team they don't personally lead - only that team's own LEAD can rename, delete, or manage its membership. This might feel surprising, but building a cross-level "admins can override team leads" permission now, before Phase 06's RBAC exists to express it properly, would mean building it twice.
- **No `DELETE /organizations/:id` route.** Phase 04 never added one, so this phase can't test "does deleting an org really cascade to its teams" through the API - the e2e test for that exercises the cascade directly against the database instead, which still proves the foreign key constraint itself is correct.
