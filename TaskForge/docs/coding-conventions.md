# TaskForge — Coding Conventions

## Naming

- Files: `kebab-case` — `create-project.dto.ts`, `projects.service.ts`
- Classes: `PascalCase` — `ProjectsService`, `CreateProjectDto`
- Variables/functions: `camelCase`
- Constants that are truly fixed: `UPPER_SNAKE_CASE`
- Database tables/models: `PascalCase` singular in Prisma schema (`model Project`), Prisma maps to conventional Postgres table names automatically
- Enums: `PascalCase` type name, `UPPER_SNAKE_CASE` values — `enum MembershipRole { ADMIN, MANAGER, MEMBER }`

## NestJS Layering Rules

- **Controllers** only handle HTTP concerns: routing, request/response shape, calling the service, applying guards/decorators. No business logic.
- **Services** contain business logic and talk to the database (via Prisma) or other services. Services should be testable without spinning up HTTP.
- **DTOs** define and validate the shape of incoming data. Never trust `req.body` directly.
- **Guards** handle authentication/authorization checks before a request reaches a controller method.
- **Modules** wire everything together and declare what's exported for other modules to use.

## TypeScript

- `strict` mode enabled from Phase 01 onward.
- Avoid `any` — use proper types or `unknown` with narrowing.
- Prefer explicit return types on service methods and exported functions.
- Use Prisma's generated types instead of hand-writing duplicate interfaces where possible.

## Error Handling

- Throw NestJS's built-in HTTP exceptions (`NotFoundException`, `ForbiddenException`, `ConflictException`, etc.) from services — don't return raw `null`/`false` and check it inconsistently in controllers.
- Never expose internal error details (stack traces, DB errors) in API responses.

## Validation

- Every DTO uses `class-validator` decorators (`@IsEmail()`, `@IsString()`, `@MinLength()`, etc.).
- Global `ValidationPipe` configured with `whitelist: true` and `forbidNonWhitelisted: true`.

## Comments

- Code should be readable without excessive comments. Comment the **why**, not the **what**, when something isn't obvious from the code itself.

## Testing

- Unit tests live next to the code they test (`*.spec.ts`).
- E2E tests live in `backend/test/`.
- A phase isn't "done" until its tests pass and previous tests still pass.

## Git Commit Style

Conventional Commits format: `type(scope): description`

Common types used in TaskForge: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`.

Examples:
```
feat(auth): implement JWT authentication
feat(database): add initial Prisma schema
test(auth): add authentication test suite
ci: add GitHub Actions pipeline
```

## General Principles

- SOLID, DRY, KISS — applied pragmatically, not dogmatically. Don't introduce an abstraction (factory, strategy pattern, generic repository layer, etc.) until there's a real second use case that justifies it.
- Prefer boring, explicit code over clever code.
- A reviewer (or future you) should be able to understand a file without needing to run it.
