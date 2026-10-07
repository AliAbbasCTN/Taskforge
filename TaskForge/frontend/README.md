# TaskForge Frontend

The web client for TaskForge: React 19 + TypeScript + Vite.

## What exists (Phase 10)

- **Authentication:** register, log in, log out. The session survives a page reload, and an expired access token is refreshed silently.
- **Organizations:** your organizations on the dashboard, create a new one, and switch between them from the sidebar.
- **Projects:** browse an organization's active or archived projects, create one, archive / unarchive / delete it (project leads and org admins/managers).
- **Boards:** create boards, see the kanban board with its columns and tasks, add tasks, move a task to another column, add columns. Controls follow your role; archived projects are read-only.

- **Tasks (Phase 10):** click a task for its detail panel (edit fields, status, labels, comments); drag-and-drop between and within columns (with an accessible "Move to" menu); filters kept in the URL; a Board/List switch where the list is sortable and paginated; project leads manage labels on the project page.

Not built yet: real-time updates (Phase 11), member and team management screens, and a frontend linter (CI arrives in Phase 19).

## Run it

You need the backend running first (see the root README).

```bash
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

`npm install` also generates `package-lock.json` - commit it (CI will need it in Phase 19).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only |
| `npm run test` | Unit tests (Vitest) |

## Environment variables

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL of the backend API. **Public** - Vite embeds `VITE_` variables in the browser bundle, so never put a secret here. |

## Structure

```
src/
├── main.tsx          App entry: providers (query client, router, auth)
├── App.tsx           Route table
├── pages/            One component per screen
├── layouts/          AppLayout (sidebar), AuthLayout (login/register frame)
├── components/       Reusable UI: ProtectedRoute, FormField, Feedback, BoardLane, TaskCard
├── contexts/         AuthContext - who is logged in
├── hooks/            TanStack Query hooks, one file per resource
├── services/         http.ts (fetch wrapper + token refresh), api.ts (endpoints), tokenStore.ts
├── types/api.ts      Shapes of what the backend sends
├── utils/            errors, format, permissions
└── index.css         Design tokens and styles
```

Data flows one way: **page → hook → `api.ts` → `http.ts` → backend**. Components never see a URL, and `http.ts` knows nothing about React.

See [`../docs/phase-09-concepts.md`](../docs/phase-09-concepts.md) for the concepts behind these choices.
