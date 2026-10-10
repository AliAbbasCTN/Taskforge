# Phase 11 — WebSockets: Concepts

## The Problem HTTP Can't Solve

Every phase so far was **request/response**: the client asks, the server answers, the conversation is over. The client always speaks first. So when a teammate moves a task, nothing tells *your* browser — you'd see it only by reloading, or by the browser asking over and over ("polling"), which is wasteful and still laggy.

A **WebSocket** is a single long-lived, two-way connection. After an initial HTTP "upgrade" handshake, *either* side can send a message at any moment. That's what lets the server push.

**Socket.IO** is a library on top of WebSockets that adds what the raw protocol lacks: **named events** (`project:changed`), **automatic reconnection**, **rooms**, and **acknowledgements** (a reply to one specific message). NestJS has first-class support for it (`@WebSocketGateway`, `@SubscribeMessage`).

## The Central Design Decision: Events Carry IDs, Not Data

When a task changes, the server emits:

```json
{ "resource": "tasks", "projectId": "…", "boardId": "…", "taskId": "…", "actorId": "…", "at": "…" }
```

No title, no description, no comment text. The event means *"this changed — go and look."* Clients then **refetch over the normal authenticated HTTP API**. This is called **invalidation-based** real-time, and it is a deliberate choice:

1. **Authorization lives in one place.** The socket never has to re-implement "who may see this task?". It can't leak what it never carries. (A test even asserts a task title never appears in an event.)
2. **No second serializer.** Pushing the *data* would mean building and maintaining a second copy of every response shape that must match the HTTP one.
3. **Self-healing.** A missed event just means one stale screen until the next refetch — nothing is *wrong*, only *late*. The socket is an optimisation over a system that already works without it.

The frontend side is `queryKeysForChange(event)`: a pure function that maps "what kind of thing changed" to "which cached queries are now stale". TanStack Query then refetches the ones currently on screen.

The alternative — pushing full data and patching the client cache — gives snappier updates but duplicates logic and makes authorization much harder. Worth knowing it exists; wrong for this app.

## Rooms: Who Hears What

A **room** is a named group of sockets on the server; "send to everyone in room X" is one call. TaskForge uses two:

| Room | Contains | Used for |
|---|---|---|
| `user:<id>` | every tab/device of one user | notifications meant for one person |
| `project:<id>` | every socket currently watching a project | live board updates |

Clients never name rooms. They ask to **join a project**, and the server decides.

## Authentication and Authorization on a Long-Lived Connection

This is the part that is genuinely different from HTTP, and the part most real-time tutorials skip.

**Authenticate at the handshake, before the connection exists.** A Socket.IO *middleware* verifies the access token (same secret, same rules as the HTTP `JwtStrategy`). A socket with a bad token never reaches any handler; the client just sees `connect_error: unauthorized` — the same vague message for every failure. Browsers can't set an `Authorization` header on a WebSocket, so the token travels in the handshake's `auth` object.

**Authorize each room join with the same rule as HTTP.** `RealtimeAccessService.canAccessProject` is the socket twin of `OrganizationMembershipGuard` + `ProjectGuard`: you must be in the organization, then be a project member *or* hold org-wide oversight. Refusals use one answer for "doesn't exist", "not yours" and "malformed id" — the 404-not-403 rule, applied to sockets. A socket may join at most 25 project rooms, so a buggy or hostile client can't exhaust server memory.

**Permissions change while a socket is open — and a socket doesn't re-check.** HTTP re-authorizes *every request*. A socket authorizes the *join*, then stays in the room. So without more work, removing someone from a project would leave their already-open tab quietly receiving that project's events until they closed it. That is a real authorization hole that HTTP does not have.

The fix: `RealtimeService.revalidateUser(userId)` re-asks the access question for every project room a user's sockets are in, and removes them from rooms they no longer qualify for. It's triggered, by decorator, after the routes that can take access away: removing a project member, removing an organization member, and changing an organization role (losing ADMIN/MANAGER oversight). Two details matter:
- It re-checks **everything** rather than being told "remove them from project X", so *one* function covers every way access can be lost.
- The HTTP response is **held until the sockets are cleaned up**, so by the time the caller sees "204 removed", the removed person's live connection is already cut off. And in the interceptor, revocation runs **before** the change is announced, so the removed person doesn't even hear about their own removal (a bug I caught in review; there's a test for the order).

**An access token lives 15 minutes; a socket can live for days.** A connection that outlived its token would be a session the server can no longer vouch for. So each socket is closed when its token expires. Socket.IO does *not* reconnect after a server-initiated close, so the client refreshes its session and reconnects itself — the `auth` option is a **function**, so each connection attempt reads the *current* token. It gives up after two consecutive rejections rather than burning refresh tokens in a loop.

**Logout closes the user's sockets** (all tabs and devices), server-side.

## One Interceptor, Not Sprinkled Publish Calls

How does a task update turn into an event? Not by remembering to call `publish()` in 15 services — someone would forget on the 16th route. Instead:

- Controllers declare what they manage: `@PublishesChanges('tasks')`.
- One global **interceptor** wraps every route. If the route is a write (not `GET`) and **succeeded**, it announces it; routes marked `@RevalidatesUserRooms()` also revoke first.

An **interceptor** wraps a handler: code before `next.handle()` runs first, and operators on the returned stream (`tap`, `mergeMap`) see the result. Because it only sees *successful* results, a rejected or forbidden write announces nothing — a test proves it.

Two behaviours, deliberately different: **publishing is fire-and-forget** (a failure to notify must never fail a write that already succeeded), while **revoking is awaited** (a failure to revoke is safer to report than to hide, but must be finished before the response).

The services stay free of any knowledge that sockets exist. `RealtimeService` is a harmless no-op when no server is attached, which is also why all existing unit and HTTP tests run unchanged.

## Notifications: Durable First, Live Second

Notifications ("Ada assigned you *Fix login*") are a table, not just a socket message. The flow:

1. A row is written to `notifications` — **this is the notification**. It survives reloads, offline users and dropped sockets.
2. A `notification:created` event is pushed to the recipient's `user:<id>` room as a live hint that the badge should update.

So the socket is never the source of truth: a user who was offline simply finds the row waiting. (A test checks an offline user's inbox.)

Details worth knowing:
- **You're never notified about your own actions** — assigning a task to yourself or commenting on your own task tells no one.
- **Only a *change* is news.** Re-saving the same assignee, or clearing it, sends nothing.
- **The message is a snapshot**, built and stored server-side. If the task is renamed later, the notification still reads as it did when it happened, like an email.
- **`boardId`/`taskId` are plain columns, not foreign keys.** Deleting a task must not silently delete the record of having been told about it; the link just leads to "not found". The project *is* a real foreign key, so deleting a project removes its notifications.
- **Best-effort:** `notify()` never throws. Failing to tell someone must not undo the real action. The *robust* version — guaranteed exactly-once delivery even if the server crashes mid-request — is a background job with retries, which is exactly what **Phase 12 (Redis + BullMQ)** is for.
- **Scoping:** every read filters `WHERE user_id = <requester>`, so someone else's notification is a 404, not a 403.

## What the Frontend Does

- `services/realtime.ts` — one shared connection, opened after login and closed on logout. It tracks **which rooms the UI wants** with a reference count (two screens watching the same project share one join; the room is left when the *last* stops) and **re-joins them after any reconnect**, because rooms live per-connection on the server — a fresh connection starts in none.
- `useProjectRealtime(projectId)` — joins on mount, refetches on events, leaves on unmount. It deliberately does *not* ignore your own changes: that would also hide changes you make in another browser tab.
- A **connection indicator** (Live / Connecting / Offline), because "nothing changed" and "I stopped receiving changes" must look different.
- The **bell** and **inbox**, kept current by the same events.

## Trade-offs, Honestly

- **Rooms live in one process's memory.** With several server instances behind a load balancer, an event emitted on instance A won't reach sockets on instance B. The standard fix is the **Socket.IO Redis adapter**, which relays events between instances; it arrives with Redis in Phase 12. Today's design is correct for one instance.
- **The optimistic board update (Phase 10) and live events can briefly disagree.** If another user's event triggers a refetch in the instant between your drop and the server's reply, the card may flicker back and then settle. The `onSettled` refetch always converges on the truth.
- **No presence ("Ada is viewing this board") or typing indicators.** The room structure would support them; not on the roadmap.
- **Organization-level changes aren't live.** Rooms are per project, so a *new project* appearing in someone's project list needs a refresh. (A per-organization room would add it.)

## Dependencies — Why Each One

| Package | Where | Why TaskForge needs it |
|---|---|---|
| `@nestjs/websockets` | backend | the gateway decorators (`@WebSocketGateway`, `@SubscribeMessage`) |
| `@nestjs/platform-socket.io` | backend | Nest's Socket.IO adapter |
| `socket.io` | backend | the server library itself |
| `socket.io-client` | frontend, and backend dev | the browser client; also the real clients in the e2e tests |

## Testing

- **Unit:** the access decision table; room revocation (only rooms no longer allowed, every tab); the gateway (token handling, expiry timer, join validation, room cap); the interceptor (publish only on success, never on reads, ids only, revoke-before-announce); the notification rules.
- **E2E (`realtime.e2e-spec.ts`):** real Socket.IO clients against a really listening server — refused handshakes, join rules, live delivery with ids only, nothing leaking to refused sockets or other projects, **access cut off on removal/demotion/logout**, and the full notification flow.
- The e2e files now run **one at a time** (`maxWorkers: 1`), because both share a database and each wipes it between tests.

## What's Deferred

- **Redis adapter / horizontal scaling** and **durable notification delivery** — Phase 12.
- **Email / push notifications** — would reuse `buildNotificationMessage`; not on the roadmap.
- **Presence and typing indicators**, **per-organization rooms**.
- **@mentions** — would be a new notification type.
