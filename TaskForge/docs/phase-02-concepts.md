# Phase 02 — Database Architecture: Concepts

## Relational Databases & PostgreSQL

**WHAT:** A relational database stores data in tables (rows and columns), with explicit relationships between tables enforced by the database itself. PostgreSQL is a mature, open-source relational database.

**WHY PostgreSQL for TaskForge:** It handles everything the roadmap needs without bolting on extra infrastructure — strong relational integrity (essential for a multi-tenant app where a task must belong to a column, which belongs to a board, which belongs to a project, which belongs to an organization), JSON columns when we need flexibility, and built-in full-text search (which Phase 14 uses instead of adding Elasticsearch).

**WHY not a document database (MongoDB):** TaskForge's data is deeply relational. Enforcing "this task's assignee must be a real user in this organization" is something a relational database does natively with foreign keys. In a document store, that guarantee becomes application code you have to get right every single time.

## ORMs and Prisma

**WHAT:** An ORM (Object-Relational Mapper) lets you query a database using your programming language instead of writing raw SQL strings. Prisma is a TypeScript-first ORM.

**WHY Prisma specifically:**
- **Type safety.** Prisma reads `schema.prisma` and *generates* a client whose types exactly match your database. If you typo `prisma.user.findUnique({ where: { emial } })`, TypeScript catches it at compile time. If you later rename a column, every affected query becomes a compile error instead of a runtime surprise in production.
- **Safe by default.** Prisma parameterizes every query, so SQL injection isn't possible through the normal query API.
- **Migrations are first-class.** Schema changes produce reviewable SQL files committed to git.

**WHERE:** `prisma/schema.prisma` defines the schema; `src/database/prisma.service.ts` exposes the generated client to the app.

**HOW the pieces fit:**
```
prisma/schema.prisma          ← you write this
        │
        ├─ npx prisma generate ─→ node_modules/.prisma/client  (typed client)
        │
        └─ npx prisma migrate  ─→ prisma/migrations/*/migration.sql  (SQL)
                                        │
                                        └─→ applied to PostgreSQL
```

The generated client lives in `node_modules`, which is why it's gitignored and why `npx prisma generate` must run after every `npm install` and after every schema change. The `postinstall` script in `package.json` handles the install case automatically.

## Migrations

**WHAT:** A migration is a versioned SQL file describing how to move the database schema from one state to the next. They're committed to git and applied in order.

**WHY they matter:** Without migrations, "update the database" means someone manually running SQL on each environment and hoping they remember every step. With migrations, the database schema is reproducible from source control — a new developer runs one command and gets the exact right schema, and production gets the same changes that were tested in development.

**WHY `migrate dev` vs `migrate deploy`:**
- `prisma migrate dev` (development) — compares your schema to the database, generates a new migration file, applies it, and regenerates the client. It can also reset the database if things drift.
- `prisma migrate deploy` (production/CI) — only applies existing, already-reviewed migration files. It never generates new ones and never resets anything. This is what Phase 19's CI pipeline will use.

**Never edit an already-applied migration.** Once a migration has run anywhere beyond your own machine, changing it means different environments silently have different schemas. Create a new migration instead.

## Schema Design Decisions in This Phase

These are deliberate choices worth being able to explain in an interview:

**UUID primary keys instead of auto-incrementing integers.**
Sequential integer IDs leak information — `/users/1` tells an attacker you're the first user, and `/users/847` tells them roughly how many users exist. They're also enumerable: anyone can walk `/users/1`, `/users/2`, `/users/3`. UUIDs are unguessable, which matters a great deal for a multi-tenant product where IDs appear in URLs. The trade-off is slightly larger storage and slightly slower index performance — irrelevant at TaskForge's scale.

**snake_case table and column names, via `@@map` / `@map`.**
Prisma models use TypeScript conventions (`createdAt`), but PostgreSQL's convention is snake_case (`created_at`). The mapping layer gives us idiomatic naming on both sides. This isn't just cosmetic: camelCase identifiers in PostgreSQL must be double-quoted in every raw SQL query, which becomes genuinely painful in Phase 14 when we write full-text search queries by hand.

**Explicit column length limits (`VARCHAR(255)`, `VARCHAR(100)`).**
An unbounded `TEXT` column accepts a 10MB name. Limits at the database level are a last line of defence, and the DTO validators mirror them so users get a clean 400 rather than an opaque database error.

**A unique index on `email`, not just a validation check.**
This is the important one. The naive approach is "look up the email; if it doesn't exist, insert." That has a **race condition**: two simultaneous requests can both pass the lookup and both insert, producing duplicates. Only a database-level unique constraint can prevent this reliably, because the database serializes the check and the write. Our code leans on the constraint and translates the resulting error, rather than trying to prevent the situation in application code.

## Error Translation: Database Errors → HTTP Errors

Prisma throws errors with codes like `P2002` (unique constraint violated) and `P2025` (record not found). Those are *database* concepts. HTTP clients need *HTTP* concepts: 409 Conflict, 404 Not Found.

`UsersService` does that translation. This matters architecturally: the controller never imports Prisma and never knows a database exists. If TaskForge ever swapped its data layer, the controller wouldn't change at all. This is the separation of concerns principle doing real work rather than being an abstract slogan.

## Why `PrismaService` Is a Singleton

`PrismaClient` maintains a connection pool. PostgreSQL has a hard limit on simultaneous connections (typically 100). If every request created a new client, a modest amount of traffic would exhaust the database and everything would fail.

By wrapping it in an `@Injectable()` service inside a `@Global()` module, NestJS's DI container creates exactly one instance and shares it everywhere. The `OnModuleInit`/`OnModuleDestroy` hooks connect at startup and disconnect cleanly at shutdown — the latter matters in containers, where the orchestrator sends SIGTERM and expects the process to wind down gracefully rather than dropping in-flight queries.

## Why the Health Check Now Queries the Database

In Phase 01, `/health` only proved the Node process was running. That's a weak signal — the process can be perfectly alive while the database is unreachable, in which case every real request fails but the health check still reports "ok."

Now it runs `SELECT 1` (the cheapest query that proves a real round-trip) and returns **503 Service Unavailable** if that fails. The status code is the part that matters: Docker health checks and load balancers make routing decisions from the status code, not the response body.

## Unit Tests vs. E2E Tests, Revisited

This phase makes the distinction concrete:

- **Unit tests** (`users.service.spec.ts`) replace Prisma with a mock. They run in milliseconds, need no database, and verify the logic *we* wrote — specifically that `P2002` becomes a 409 and `P2025` becomes a 404. That translation is real business logic and deserves protection.
- **E2E tests** (`test/app.e2e-spec.ts`) boot the whole app against a **real PostgreSQL database**. They verify things a mock fundamentally cannot: that the unique index genuinely fires, that `ParseUUIDPipe` is actually wired to the route, that the global exception filter formats the 409 correctly, that data really persists.

Both matter. Mocks can lie — a mocked database will happily pretend a constraint exists when the real migration forgot to add it. Only the e2e test catches that.
