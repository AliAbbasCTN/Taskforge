# Phase 12 — Redis + BullMQ: Concepts

## The Problem: Work That Doesn't Belong in the Request

Until now every side effect happened *inside* the HTTP request that caused it. That is simple, but it has three weaknesses — and Phase 11 flagged all of them for notifications:

1. **Speed.** Slow work makes the user wait.
2. **Fragility.** If the work fails, it is simply lost — nobody retries it.
3. **Coupling to one process.** If the server dies mid-request, whatever hadn't finished is gone.

A **job queue** fixes this by separating *deciding that work is needed* from *doing it*.

## What a Message Queue Is

```
 HTTP request ──add job──▶ [ Redis list of jobs ] ──take job──▶ worker
   (returns at once)         durable, ordered                    (does the work,
                                                                  retries on failure)
```

- A **producer** (here: a request handler) adds a small JSON *job* to a named **queue** and moves on.
- A **worker** takes jobs off the queue and runs them. If it throws, the job is retried; if it succeeds, the job is done.
- The two are **decoupled** in time (the work can happen later), in failure (a failing job is retried without the user knowing), and in scale (add more workers without touching the web code).

**Redis** is an in-memory data store that is extremely fast at the list-and-lock operations a queue needs. **BullMQ** is a library that builds a reliable queue on top of it (retries, delays, schedules, concurrency, stalled-job recovery). **`@nestjs/bullmq`** wires it into NestJS with `@Processor` / `@InjectQueue`.

### Is it durable?
Redis keeps data in memory. By default it snapshots to disk occasionally, so a crash could lose the most recent jobs. `docker-compose.yml` therefore starts Redis with `--appendonly yes` — it logs every write to disk, so queued jobs survive a restart. Durability is a *setting*, not a given.

## What Moved Into the Queue: Notification Delivery

Phase 11's `notify()` wrote the row and pushed the socket event inline. Now:

| | Before (Phase 11) | Now |
|---|---|---|
| `notify()` | creates the row + pushes the event | adds a job and returns |
| Who creates the row | the request | a **worker** (`deliver()`) |
| On failure | lost, logged | **retried 5×** with exponential backoff |
| Redis down | n/a | **falls back to inline delivery** |

### Retries and exponential backoff
`attempts: 5, backoff: exponential 1s` retries after 1s, 2s, 4s, 8s. Most failures are a dependency that's briefly overloaded or restarting; retrying *instantly* hammers it and makes things worse, so each wait doubles. Failed jobs are **kept for a week** (`removeOnFail`) — the job that exhausted its retries is the one you most need to inspect, and it must not vanish before anyone notices. Successful jobs are only bookkeeping and are trimmed after an hour.

### Not every failure deserves a retry
If the recipient's account was deleted after the job was queued, retrying five times can never succeed. The processor recognises that case (a foreign-key error) and throws `UnrecoverableError`, which tells BullMQ to give up immediately and keep the job for inspection.

## The Idea That Matters Most: Idempotency

**A queue cannot promise a job runs exactly once.** If a worker finishes the work but crashes before telling Redis, the job is retried — so it can run *twice*. The honest guarantee is **at-least-once** delivery. The practical response isn't to chase "exactly once" but to make running twice **harmless**: an **idempotent** operation.

`deliver()` is idempotent by design:
- The notification's `id` is chosen when the job is **enqueued** (`randomUUID()`), and used as the row's **primary key**.
- A second attempt tries to insert the same id, hits the unique constraint, loads the existing row instead, and pushes the live event again (harmless: the client just refetches).
- The id is also the BullMQ `jobId`, so the queue itself refuses a duplicate of the same job.

This isn't academic: the **timeout fallback** below can legitimately produce *both* a queued job and an inline delivery. Idempotency is what makes that safe.

## Graceful Degradation: Redis Down ≠ App Down

If Redis is unreachable, `queue.add()` could hang for a long time — and it runs inside an HTTP request. Two defences:
1. The queue's Redis client has its **offline queue disabled**, so a disconnected client *fails fast* instead of silently buffering commands.
2. `withTimeout(…, 2s)` bounds the wait regardless.

On failure, `notify()` delivers **inline**, exactly as in Phase 11. The feature loses its retries but keeps working. `/health` then reports `degraded` (HTTP 200) rather than `error` (503): Redis is useful but not essential, so the app should keep serving — while *saying* something is wrong.

Workers get the *opposite* policy: a worker *should* wait patiently for Redis to come back, so it uses the shared connection with default behaviour.

## The Dual-Write Problem (a Known Limit)

Assigning a task saves to **PostgreSQL**, *then* adds a job to **Redis**. Two systems, no shared transaction. If the server dies in the gap, the task is assigned but no job exists — the notification is silently lost.

The textbook fix is the **transactional outbox**: write a "to notify" row in the *same database transaction* as the assignment, and let a worker forward outbox rows to the queue. The database guarantees both rows or neither. It is not built here — it would touch every call site — but it is the next step if notifications became critical, and it is a very common interview topic.

## Scheduled Jobs: the Nightly Purge

Notifications only ever grow. A read notification from months ago is clutter. A `maintenance` queue holds a **repeatable job**: every night at 03:00, delete notifications read more than 90 days ago. Unread ones are never touched (`readAt < cutoff` is never true for `NULL`).

**Why `upsertJobScheduler` with a fixed id:** the registration code runs on *every start of every instance*. If it simply "added a repeating job", ten restarts would create ten schedules and the purge would run ten times a night. *Upsert* means create-or-update the schedule with this id — after the first call, later calls change nothing. The schedule lives **in Redis, not in any process**, so exactly one job is produced per tick however many instances run. (A test starts the app repeatedly and asserts exactly one schedule exists.)

Maintenance jobs should themselves be idempotent: run it twice and the second finds nothing to do.

## Where Workers Run

Today the workers run **inside the web process**. They don't have to: the same processor classes could run in a separate "worker" process (same code, started without the HTTP server), so a heavy job can never slow down requests. Both would read the same Redis queue. That separation is the payoff of using a queue — it just isn't needed yet.

## Real-time at Scale: the Socket.IO Redis Adapter

Phase 11 noted that rooms live in one process's memory: with two server instances, an event emitted on instance B never reaches a browser connected to instance A. The **Redis adapter** relays every emit and room operation through Redis pub/sub, so all instances behave as one server. It also makes `fetchSockets()` — used to cut off someone removed from a project — see sockets on *every* instance, so access revocation stays correct when scaled out. (It needs two Redis connections because a connection that has subscribed can do nothing but listen.) It's enabled in `main.ts` only; tests use the default in-memory adapter.

## Monitoring Work You Can't See

When work moves to a background queue, **failures stop being visible** — no user is staring at an error, and a job can fail quietly for days. The strategy has layers:

1. **Logs.** A failed attempt that will be retried is a *warning*; the final failure (retries exhausted, or unrecoverable) is an *error*. The error is the moment a person must look.
2. **Counts.** `GET /health` now reports Redis status and, per queue, `waiting / active / delayed / failed`. Watch **`failed`** (should be ~0) and **`waiting`** (a number that keeps growing means workers can't keep up). An uptime monitor or alert rule can read this.
3. **Retention.** Failed jobs are kept for a week so there's something to inspect after the alert fires.
4. **A dashboard.** **Bull Board** or **Taskforce.sh** give a UI over exactly this data — retry or delete a job, see its error and payload. Not added here: it is an *admin* tool and must sit behind authentication (an unprotected dashboard would let anyone view and replay jobs). It's the natural next step.

## Testing Background Work

Work done by a worker happens **after the HTTP response**. A test that asserts "the notification exists" the instant the request returns is *racing the worker*. The fix is never a fixed sleep (too slow when the worker is fast, flaky when it's slow) but waiting for the actual condition:
- `settleNotifications(app)` waits until the queue has nothing waiting, running or scheduled (a retry waiting out its backoff counts).
- `eventually(assertion)` retries an assertion until it holds.

The e2e suite covers: delivery through the queue; **retry after a transient failure still creates exactly one notification**; idempotency; **inline fallback when the queue is down**; the purge (keeps recent and unread); exactly-one schedule; and the health report. These need a real Redis (`docker compose up -d`).

## Dependencies — Why Each One

| Package | Why TaskForge needs it |
|---|---|
| `bullmq` | the queue and worker engine |
| `@nestjs/bullmq` | NestJS integration (`@Processor`, `@InjectQueue`) |
| `ioredis` | the Redis client (BullMQ's own, and our adapter connections) |
| `@socket.io/redis-adapter` | relay real-time events between server instances |

## Configuration

One new variable, **`REDIS_URL`** (default `redis://localhost:6379`, matching the compose file). Use `rediss://` for TLS and `redis://:PASSWORD@host:6379` for a password.

## What's Deferred

- **Transactional outbox** — closes the dual-write gap (see above).
- **A queue dashboard** (Bull Board) behind admin authentication.
- **A separate worker process / container** — Phase 18 (Docker).
- **More job types** — a daily "due soon" reminder digest and email delivery are natural next jobs; both would reuse this machinery.
- **Rate limiting** (also Redis-backed) — Phase 20.
- **Metrics** (Prometheus counters for job durations and failures) — Phase 20.
