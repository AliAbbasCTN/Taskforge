# TaskForge Backend

A NestJS + TypeScript backend. As of Phase 01, this is a real runnable application with:

- `GET /health` — liveness check
- `GET /examples`, `GET /examples/:id`, `POST /examples` — a small in-memory teaching module demonstrating controllers, services, DI, DTO validation, and testing (temporary — replaced by real domain modules starting Phase 02)
- A typed, validated configuration system (`src/config/`)
- A global exception filter producing consistent error responses (`src/common/filters/`)
- Global request validation (whitelist + reject unknown properties)

## Run locally

```bash
cp .env.example .env
npm install
npm run start:dev
```

## Test

```bash
npm run test       # unit tests
npm run test:e2e   # end-to-end tests
npm run lint
npm run build
```

## Structure

Domain module folders (`auth/`, `users/`, `organizations/`, `teams/`, `projects/`, `boards/`, `tasks/`, `comments/`, `notifications/`, `files/`, `search/`, `activity/`, `audit/`, `database/`) are currently empty placeholders (`.gitkeep`) — they're filled in as the roadmap reaches each one. See [`../docs/folder-structure.md`](../docs/folder-structure.md) and [`../docs/architecture.md`](../docs/architecture.md).
