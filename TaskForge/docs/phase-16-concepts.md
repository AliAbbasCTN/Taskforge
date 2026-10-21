# Phase 16 — Swagger / API Documentation

## WHAT is OpenAPI, and what is Swagger?

**OpenAPI** is a standard, machine-readable format (JSON/YAML) for describing a REST API: every route, its parameters, its request body, its possible responses, and how to authenticate. **Swagger** is the family of tools around it; **Swagger UI** is the web page that turns an OpenAPI document into an interactive reference where you can read about a route and call it.

TaskForge serves:

| URL | What |
|---|---|
| `/docs` | The interactive reference (Swagger UI) |
| `/docs-json` | The raw OpenAPI document |
| `/docs-yaml` | The same, as YAML |

## WHY it matters

An API nobody can understand is an API nobody can use - including you in three months. The document is also a *contract*: Postman, Insomnia and code generators (e.g. `openapi-typescript`) read it to produce requests and typed clients. For this project it is the thing a reviewer opens first.

## HOW it works in NestJS: documentation generated from code

`@nestjs/swagger` builds the document at startup by reading what is already there: controllers (routes), `@Param`/`@Query`/`@Body` (inputs), and DTO classes (shapes). Anything it cannot know - descriptions, examples, response bodies, error cases - we add with decorators. Because the document comes from the running code, it **cannot describe a route that does not exist**.

The rest of the phase is about keeping the parts that *can* drift honest.

### 1. Request models vs response models

A **request DTO** does double duty: `class-validator` decorators enforce the rules and `@ApiProperty` documents them, on the same class. Example (`CreateProjectDto`): `@MinLength(2)` rejects a bad request, `@ApiProperty({ minLength: 2 })` tells the reader.

A **response model** is different. Controllers return Prisma objects, not instances of a class, so there is nothing for Swagger to read. We write small classes in `src/docs/models/` purely to *describe* what is sent. Nothing at runtime uses them, so nothing stops them going stale. That is why we add (5).

### 2. Document each route once, readably: `@ApiEndpoint`

A route needs a summary, a description, a success response and its special error cases. Written with raw `@Api...` decorators that is 4-6 lines per handler, burying the routing. `@ApiEndpoint({ summary, ok, conflict, ... })` (`common/swagger/api-endpoint.decorator.ts`) packs it into one declaration.

### 3. Do not repeat what the system already knows

Three kinds of documentation are *already declared* somewhere, so we reuse them instead of retyping:

- **Permissions.** `@RequirePermission(Permission.ProjectManage)` already says what a route needs, and a guard enforces it. It now also adds a `403` response and an `x-required-permission` extension to the document. The permission shown in Swagger is *literally the one the guard checks* - there is no second copy to forget.
- **Audit entries.** `@LogsActivity('task.moved')` likewise publishes `x-activity-action`.
- **Uniform errors.** Every secured route can answer `401`; any route with ids/body/query can answer `400`; anything under `/organizations/{id}` answers `404` for what you may not see. `enrichOpenApiDocument` (`docs/openapi-enrichment.ts`) adds these by *looking at the document's shape*, in one place. A route that declares its own response (say a specific 404) always wins. Because it is a pure function over data, it is unit-tested without starting Nest.

The general lesson: **derive documentation from a single source of truth where one exists; write it by hand only where a human has to explain something.**

### 4. Documenting authentication

Swagger needs to know three things: how a token is sent (`addBearerAuth` - HTTP bearer, JWT), which routes need it (`@ApiBearerAuth` on each controller), and how to get one. The description on the page explains the login-then-refresh flow, and **Authorize** stores the token so **Try it out** works on protected routes. `persistAuthorization` keeps it across reloads. A test asserts that *every* route is either on the short public list (`/health`, register, login, refresh) or marked as secured - so a new route cannot accidentally look public.

### 5. Contract tests: documentation that is verified

`test/docs.e2e-spec.ts` does two things:

- **Coverage:** every route has a summary, a tag, a unique operation id, a success response and a `401`; every path id is documented as a UUID; every permission-protected route has a `403`; every tag used is declared. Add a route in Phase 17 and forget to document it - this test fails.
- **Contract:** it performs real calls and compares each real response body with its published model **in both directions**: a field the API sends that the docs omit, and a field the docs promise that the API does not send. This is the same idea as "consumer-driven contract tests" used between teams, applied to your own docs.

### 6. Security: should the docs be public?

The reference is a map of your whole API. That helps developers and attackers alike, so `SWAGGER_ENABLED` defaults to **on in development/test and off in production**; production must opt in deliberately. (Hiding the docs is *not* a security control - real protection is authentication and authorization, which this API already enforces server-side - but there is no reason to hand out the map for free.)

## What we did not document, and why

- **WebSockets.** OpenAPI describes HTTP only. The Socket.IO events are described in `docs/phase-11-concepts.md`.
- **The Swagger CLI plugin.** Nest can auto-generate `@ApiProperty` from TypeScript types at build time. We chose explicit decorators so every description and example is visible in the code and nothing depends on build-time magic.

## Things to try

1. Open `/docs`, expand **Auth -> POST /auth/login**, **Try it out**, send a real login, copy `accessToken`, **Authorize**, then call **GET /organizations**.
2. Find a route that needs a permission, e.g. `DELETE /organizations/{id}/projects/{projectId}`. Look at its **403** and the `x-required-permission` field in `/docs-json`.
3. Break the contract on purpose: rename a field in `TaskResponse` and run `npm run test:e2e -- docs`. Read the failure message.
4. Download `/docs-json` and import it into Postman.
