# TaskForge — Folder Structure

## Repository Root

```
TaskForge/
├── backend/
├── frontend/
├── docker/
├── .github/
│   └── workflows/
├── docs/
├── docker-compose.yml
├── .gitignore
├── README.md
└── LICENSE
```

## Backend (`backend/src/`)

Each business domain is its own NestJS module. As of Phase 00 these are empty placeholder directories — real files land as each phase needs them.

```
backend/
├── src/
│   ├── auth/            # Phase 03 — registration, login, tokens, guards
│   ├── users/           # Phase 02/03 — user entity, profile
│   ├── organizations/   # Phase 04 — tenants
│   ├── teams/           # Phase 05
│   ├── projects/        # Phase 07
│   ├── boards/          # Phase 08 — boards, columns
│   ├── tasks/           # Phase 08
│   ├── comments/        # Phase 10
│   ├── notifications/   # Phase 11/12
│   ├── files/           # Phase 13
│   ├── search/          # Phase 14
│   ├── activity/        # Phase 15
│   ├── audit/           # Phase 15
│   ├── common/          # guards, interceptors, filters, decorators, pipes (Phase 01+)
│   ├── config/          # environment/config module (Phase 01)
│   ├── database/        # Prisma service/module (Phase 02)
│   ├── app.module.ts
│   └── main.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/                # e2e tests
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

Each module (once it exists) will typically look like:

```
projects/
├── dto/
│   ├── create-project.dto.ts
│   └── update-project.dto.ts
├── projects.controller.ts
├── projects.service.ts
├── projects.module.ts
└── projects.service.spec.ts
```

## Frontend (`frontend/src/`)

Introduced in Phase 09. Placeholder structure created now for planning purposes:

```
frontend/
├── src/
│   ├── components/   # reusable, presentation-focused UI pieces
│   ├── pages/         # route-level views
│   ├── layouts/       # shared page shells (e.g. AuthLayout, DashboardLayout)
│   ├── hooks/         # custom React hooks
│   ├── services/      # API client functions
│   ├── contexts/      # React context providers (e.g. AuthContext)
│   ├── types/         # shared TypeScript types
│   └── utils/         # helper functions
├── public/
├── package.json
└── .env.example
```

## Infrastructure

```
docker/                 # Dockerfiles (backend, frontend) — Phase 18
.github/workflows/      # CI/CD pipeline definitions — Phase 19
docker-compose.yml      # local orchestration (Postgres, Redis, backend, frontend) — Phase 18
```

## Why Placeholder Folders Now?

Creating the empty module folders in Phase 00 (with `.gitkeep` files) establishes the target structure up front, so later phases are additive (filling in folders that already exist) rather than restructuring the repo repeatedly. The folders contain no code yet — only the shape of where code will go.
