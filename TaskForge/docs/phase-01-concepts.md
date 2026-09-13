# Phase 01 — Backend Fundamentals: Concepts

## Node.js & TypeScript

**WHAT:** Node.js runs JavaScript outside the browser (on the server). TypeScript adds static types on top of JavaScript, checked at compile time.

**WHY:** Types catch a whole category of bugs (wrong argument types, typos in property names, forgetting a field) before the code ever runs, and make refactoring large codebases far safer.

**WHERE:** The entire TaskForge backend is written in TypeScript, compiled to JavaScript by the TypeScript compiler (invoked here via `nest build`), then run by Node.

## NestJS

**WHAT:** NestJS is a backend framework built on top of Express (by default) that provides structure: modules, controllers, services, dependency injection, decorators, and a testing framework, out of the box.

**WHY:** Without a framework's opinions, every developer organizes an Express app differently, and it's easy to end up with tangled, hard-to-test code. NestJS enforces separation of concerns and is heavily inspired by Angular's architecture, which maps well onto how professional backend teams structure large applications.

**WHERE:** Everything in `backend/src/`.

## Modules, Controllers, Services, Dependency Injection

**WHAT:**
- A **Module** (`@Module()`) groups related controllers and providers (services) together, and declares what it imports/exports.
- A **Controller** (`@Controller()`) defines HTTP routes and translates requests/responses.
- A **Service** (`@Injectable()`) contains the actual business logic.
- **Dependency Injection (DI)** means a class doesn't construct its own dependencies — it declares what it needs in its constructor, and NestJS's DI container supplies (injects) the right instance automatically.

**WHY:** This separation means:
- Controllers stay thin and easy to read.
- Services can be tested in complete isolation, without spinning up HTTP at all (see `example.service.spec.ts`).
- Swapping an implementation (e.g. a real database service instead of an in-memory array) means changing what gets injected, not rewriting the controller.

**WHERE:** See `src/example/` — `ExampleController` declares `constructor(private readonly exampleService: ExampleService)`. Nest sees `ExampleModule`'s `providers: [ExampleService]` and automatically constructs and injects an `ExampleService` instance when it builds `ExampleController`.

**HOW:** You never write `new ExampleService()` yourself. Nest's DI container reads the constructor's type information (via TypeScript's `emitDecoratorMetadata`) and the module's declared providers, and wires everything together at startup.

## Configuration & Environment Variables

**WHAT:** `@nestjs/config`'s `ConfigModule` loads `.env` file values into `process.env`, and our `configuration.ts` factory groups them into a typed, namespaced object (`app.port`, `cors.origin`, etc.) accessed via `ConfigService`.

**WHY:** Hard-coding values like the port number or allowed CORS origin directly in code means every environment (your laptop, CI, production) needs a different code change to run correctly. Environment variables let the same code run differently based on where it's deployed, without any code changes — and keep secrets (later: database passwords, JWT secrets) out of source control entirely.

**WHERE:** `src/config/configuration.ts`, `src/config/env.validation.ts`, `src/config/config.module.ts`. Consumed via `ConfigService` (see `HealthController`, `main.ts`).

**HOW:** `env.validation.ts` uses `class-validator` to check that environment variables are the right shape *before* the app finishes starting — if `PORT` were set to something nonsensical, the app would refuse to start with a clear error rather than failing confusingly later.

## Global Validation Pipe

**WHAT:** A `ValidationPipe`, applied globally in `main.ts`, that runs every incoming request body/query through its DTO's `class-validator` rules before the controller method ever executes.

**WHY:** "Never trust client input" is a core security and correctness principle. Without this, a controller would need to manually check every field of every request — tedious and easy to get wrong or forget.

**WHERE:** Configured once in `main.ts`, applied to every route in the application. Exercised by `CreateExampleDto` in the example module.

**HOW:** `whitelist: true` strips any properties not declared on the DTO; `forbidNonWhitelisted: true` goes further and rejects the whole request with a 400 if it contains undeclared properties (this is what the e2e test `POST /examples rejects unknown properties` verifies).

## Global Exception Filter

**WHAT:** `AllExceptionsFilter`, applied globally in `main.ts`, intercepts every thrown error (deliberate `HttpException`s and unexpected bugs alike) and formats them into one consistent JSON response shape.

**WHY:** Consistency matters for API consumers (including our own future frontend) — every error should look the same shape regardless of what went wrong internally. It's also a security boundary: unexpected errors are logged in full server-side, but the client only ever sees a safe, generic message — never a stack trace or raw exception details.

**WHERE:** `src/common/filters/all-exceptions.filter.ts`.

## Testing: Unit vs. E2E

**WHAT:** Unit tests (`*.spec.ts`, run via `npm run test`) test a single class in isolation (e.g. `ExampleService` with no HTTP involved at all). End-to-end tests (`test/*.e2e-spec.ts`, run via `npm run test:e2e`) boot the *entire* application and make real HTTP requests against it using `supertest`.

**WHY:** Unit tests are fast and pinpoint exactly which piece of logic broke. E2E tests catch integration problems that unit tests can't see — e.g. that the `ValidationPipe` is actually wired up globally, that routes are mapped correctly, that the exception filter actually produces the response shape we expect.

**WHERE:** `src/example/example.service.spec.ts`, `src/health/health.controller.spec.ts` (unit); `test/app.e2e-spec.ts` (e2e).

## Why the "Example" Module Is Temporary

The `example` module has no place in TaskForge's real domain model (there's no `Organization` → `Example` relationship in `docs/database-plan.md`). It exists purely so Phase 01 has *something real* to route requests to and test, before Phase 02 introduces a database and the first genuine domain module (`users`). It will be deleted once `users` exists and demonstrates the same patterns against real persisted data.
