# Phase 09 — React Frontend: Concepts

## The Big Idea: The Browser Is Untrusted

Everything before this phase ran on a server you control. A frontend is different: **its code runs on the user's machine, and the user can read it, change it, and send any request they like with dev tools or `curl`.** So the frontend can never be the thing that protects data.

That shapes every decision below, and it is the single most important idea in this phase:

- Hiding a button (`canManageProject`) is a **courtesy** — it stops people being offered actions that will fail. The backend's guards (Phases 03–08) are what actually refuse.
- A `ProtectedRoute` decides which **screen** to show, not who may see **data**. The data is protected because the API refuses requests without a valid token.
- `required` / `minLength` on inputs give instant feedback, but the backend validates again and its messages are shown to the user.

Every one of those rules is mirrored on the server. If the frontend and backend ever disagree, the backend wins — by design.

## React in Five Ideas

**1. Components** are functions that return UI. `TaskCard` takes a task and returns the markup for one card. You build screens by nesting components, the way you build a program by calling functions.

**2. Props** are a component's inputs — the arguments to that function. `<TaskCard task={task} canMove={canWrite} />`. Data flows **down** (parent → child); a child tells its parent something happened by calling a function the parent passed in (`onMove`).

**3. State** is memory that survives between renders. `const [title, setTitle] = useState('')` gives a variable plus a setter. Calling the setter makes React **re-render** the component with the new value. You never edit the page directly; you change state and React updates the page to match. In a form, an input wired as `value={title} onChange={...}` is *controlled*: React owns what it contains.

**4. Hooks** are the `use...` functions (`useState`, `useEffect`, `useParams`, our own `useBoard`). They let a function component have state and side effects. Two rules: call them at the top level (never inside an `if` or loop), and only from components or other hooks. That's why, in `ProjectPage`, **all hooks are called before any early `return`**.

**5. Effects** (`useEffect`) run code *after* rendering, for things outside React — here, restoring a saved session on first load. Most data fetching does *not* use raw effects in this project; TanStack Query handles it (below).

React re-runs a component whenever its state, props, or context change. That's the whole model: **UI = f(state)**.

## How the Code Is Layered

```
pages/        what a screen shows            ─┐
hooks/        fetch & change server data      │  each layer only talks
services/api  one function per endpoint       │  to the one below it
services/http fetch, auth header, refresh    ─┘
```

Components never see a URL. When an endpoint changes there is one file to edit. `http.ts` knows nothing about React, so it can be (and is) unit-tested without a browser.

## Authentication on the Frontend

### Where the tokens live

| Token | Where | Why |
|---|---|---|
| Access (15 min) | A JavaScript variable | Short-lived; a page reload clears it; nothing can read it from storage |
| Refresh (7 days) | `localStorage` | Must survive a reload or users would log in again on every refresh |

**The honest trade-off:** anything in `localStorage` can be read by any script running on the page, so a successful XSS attack could steal the refresh token. The standard hardening is an `httpOnly` cookie — invisible to JavaScript — but that needs backend changes (cookie handling, CSRF protection). We deliberately did not rewrite Phase 03's design inside a frontend phase; it is scheduled for **Phase 20's security review**. What limits the damage today: refresh tokens **rotate** (a stolen one stops working once the real user refreshes), and React escapes everything it renders, which closes the most common XSS route.

### Silent refresh, and why it must be single-flight

When an access token expires, the API answers `401`. The HTTP client catches that, calls `/auth/refresh`, and **replays the original request** — the user never notices.

The subtle part: the backend **rotates** refresh tokens and remembers only the latest. Suppose three requests all get a 401 at once and each sends a refresh. The first succeeds and rotates the token; the second and third now present an *already-used* token — which the server cannot tell apart from a **stolen token being replayed** — so they are rejected, and the user is logged out for no reason.

So `refreshTokens()` is *single-flight*: while one refresh is in progress, everyone who needs one **shares that same promise**. The unit tests prove it (three concurrent 401s → exactly one refresh call). It also matters on page load: React's `StrictMode` runs effects twice in development, which would otherwise burn the rotating token twice.

A second guard: if a request fails with 401 but the access token has *already changed* since it was sent, another request refreshed the session in the meantime — so it just replays instead of refreshing again.

### Session restore, logout, and the three-state status

On a page reload the user *is* logged in, but the app can't know until it uses the saved refresh token. So auth status has **three** values — `loading`, `authenticated`, `unauthenticated` — not two. Treating "don't know yet" as "logged out" would flash the login page at every logged-in user on every reload.

Logging out tells the server, clears the tokens, **and clears the entire query cache** — so the next person to use that browser can never glimpse the previous user's cached data. Even if the server can't be reached, the local session is cleared regardless: the user asked to log out.

## Routing and Protected Routes

React Router maps URLs to components. Routes **nest**: a `ProtectedRoute` with no path of its own wraps every logged-in page, and `AppLayout` inside it supplies the sidebar; pages render into its `<Outlet />`.

The **current organization is not stored in state** — it is whatever `/orgs/:orgId` says in the URL. Switching organizations is just navigating. Back button, bookmarks and shared links all work, and there is no second copy of "which org am I in" that could disagree with the URL.

Remember: the URL is input from the user. If you type an organization ID you don't belong to, the page asks the backend and displays its `404`. The frontend does not (and could not) decide who may see what.

## Server State vs. Client State

Two different kinds of data live in a React app:

- **Client state** — things only the UI knows: what's typed in a field, which tab is selected. `useState`.
- **Server state** — data that *lives on the server* and the UI shows a copy of: organizations, projects, the board. This is harder than it looks, because the copy can go stale, requests can fail, three components may ask for the same thing, and loading/error states are needed everywhere.

Hand-rolling that with `useState` + `useEffect` + `fetch` means re-solving caching, de-duplication, loading, errors and refetching for every request. **TanStack Query** solves it once:

- A **query** (`useQuery`) reads data, identified by its `queryKey` — same key, same cache entry.
- A **mutation** (`useMutation`) changes data. On success we **invalidate** the affected keys, which marks them stale and refetches.

On the board, the client **never treats its own copy as truth** (Phase 10 adds optimistic updates for moves, which show a *guess* until the server's answer replaces it). Moving a task calls the API, then refetches the board, and React renders what the server says — including the renumbered positions, which the server computes and the client deliberately does not try to reproduce. The UI can't drift from the truth.

It's also why retries are limited: `retry` is off for any `4xx` (a 403 or 404 will give the same answer again; retrying only delays the error message) and on, twice, for network blips and 500s.

## The Types Are a Promise

`types/api.ts` describes the JSON the backend sends. TypeScript checks it *inside* the frontend, but **cannot see across the network**: if the backend renames a field, nothing here fails to compile — the UI just breaks at runtime. That is the cost of a hand-written contract. Phase 16's OpenAPI document is what lets these types be generated instead.

## Design Decisions

- **Plain CSS with tokens**, no framework: the stylesheet is one file you can read top to bottom, and the dependency list stays short.
- **The board is the one bold place.** Lanes carry a top rule that shifts from slate to green along the workflow, so colour encodes *how far along* work is. Everything else is flat, with 1px borders and one small radius.
- **A "Move to" menu instead of drag-and-drop** (Phase 10). It's a native `<select>`, so it already works with a keyboard and screen reader, and it calls the same endpoint drag-and-drop will.
- **Accessibility floor:** every input has a label, focus is always visible, `prefers-reduced-motion` is respected, the layout works down to phone width, and loading/error messages use `role="status"` / `role="alert"` so screen readers announce them.
- **Copy:** buttons say what they do ("Archive project", not "Submit"); empty states say what to do next; errors say what went wrong.

## Dependencies — Why Each One

| Package | Why TaskForge needs it |
|---|---|
| `react`, `react-dom` | The UI library |
| `react-router-dom` | URL → screen mapping, nested layouts, protected routes |
| `@tanstack/react-query` | Server-state caching, loading/error states, invalidation |
| `vite`, `@vitejs/plugin-react` | Dev server with hot reload, production bundling |
| `typescript`, `@types/react*` | Type checking |
| `vitest` | Unit tests (reuses Vite's config) |

No state-management library (Redux, Zustand): the only global client state is "who is logged in", which React Context handles. Adding a library for one value would be the kind of unnecessary abstraction the project rules warn against.

## What's Deferred

- **Task details, comments, labels, drag-and-drop, filtering** — Phase 10. The board already renders priority, due date and assignee; Phase 10 adds editing them.
- **Real-time updates** — done in Phase 11 (see `phase-11-concepts.md`). In this phase another user's change appeared only on reload or refetch.
- **Member and team management screens** — the backend supports them (Phases 04–07); the UI shows who is on a project but cannot yet add or remove people. Not on the Phase 09 list.
- **`httpOnly`-cookie refresh tokens** — Phase 20.
- **Frontend linting and component tests** — ESLint arrives with CI in Phase 19; broader testing is Phase 17. Phase 09 tests the logic most likely to be wrong (token refresh, permission hints, formatting).
- **A Dockerfile** — Phase 18.
- **Known limitation: one session per user.** The backend stores a single refresh-token hash per user, so logging in on a second device signs the first one out. That's a Phase 03 design decision, now visible in the UI.
