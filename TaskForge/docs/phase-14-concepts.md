# Phase 14 — Search & Filtering: Concepts

## The Problem

By Phase 10 you could *filter* tasks (priority, assignee, label, overdue) and *sort* and *page* them, one board at a time. What you could not do is **find a task by what it says** — "where was that login bug?" — across a whole project. That needs text search, and text search is a different kind of problem from filtering.

## 1. Why `LIKE '%login%'` Is Not Enough

The obvious approach is `WHERE title ILIKE '%login%'`. It breaks down in three ways:

1. **It is slow.** A pattern starting with `%` cannot use an ordinary index, so PostgreSQL reads *every row*. Fine for 100 tasks, painful for 1,000,000.
2. **It is literal.** "running" will not find "run"; "login" will not find "logging in".
3. **It cannot rank.** Every match is equal, so the best result is not first.

**Full-text search (FTS)** solves all three. PostgreSQL has it built in — no Elasticsearch needed.

## 2. How PostgreSQL Full-Text Search Works

Two special types and one operator:

| Piece | What it is | Example |
|---|---|---|
| `tsvector` | A document reduced to a sorted list of **lexemes** (word stems) with positions | `'fix':1 'login':2 'redirect':3` |
| `tsquery` | A search expression over lexemes | `'login' & 'redirect'` |
| `@@` | "does this vector match this query?" | `search_vector @@ query` |

Turning text into lexemes uses a **language configuration** (we use `'english'`). It lower-cases, drops **stop-words** ("the", "a"), and **stems**: "running", "runs" and "ran" all become `run`. Searching "run" therefore finds all of them.

**Weights.** We build the document as `setweight(title, 'A') || setweight(description, 'B')`. When ranking, an `A` match counts more than a `B` match, so a task *titled* "login" outranks one that merely *mentions* login in its description.

## 3. Making It Fast: the GIN Index

A **GIN** ("generalized inverted index") works like the index at the back of a book: for each word, the list of rows containing it. A query for "login" looks up one entry instead of reading every task. That is the whole reason full-text search scales. TaskForge declares it in the Prisma schema (`@@index([searchVector], type: Gin)`) and creates it in the migration.

**See it work.** In `psql`, on a database with many tasks:

```sql
EXPLAIN ANALYZE
SELECT id FROM tasks
WHERE search_vector @@ websearch_to_tsquery('english', 'login');
```

Look for `Bitmap Index Scan on tasks_search_vector_idx`. **Honest caveat:** on a table of a few dozen rows PostgreSQL deliberately ignores the index — reading the whole tiny table is cheaper — and shows `Seq Scan`. To see the index used on small data, run `SET enable_seqscan = off;` first. An index is an investment that pays off with size, which is also why we did not index things that don't need it.

## 4. Keeping the Search Document Up to Date: a Trigger

Where does the `search_vector` column come from? Prisma's schema language cannot describe `tsvector` columns, generated columns or expression indexes. If we had created any of them by hand, `prisma migrate dev` would see them as *drift* from the schema and try to delete them in the next migration.

So we use a design Prisma cannot trip over:

- a plain nullable column, declared in `schema.prisma` as `Unsupported("tsvector")?` (the Prisma client simply ignores it);
- a **database trigger** that recomputes it whenever a task is inserted or its title/description is updated. Triggers and functions are invisible to Prisma's diffing.

Because the **database** keeps it current, *every* write path — the API, a script, a future import — stays searchable automatically. The application cannot forget to update the index. The trigger fires only when `title` or `description` changes, so moving a task between columns costs nothing extra. The migration also **backfills** existing tasks.

*Trade-off:* the logic now lives in SQL, not TypeScript, so it must be read in the migration (`20261017120000_add_task_full_text_search`). That is the standard price of trigger-maintained search vectors.

## 5. Safe Raw SQL

Prisma's query builder cannot express `@@`, `ts_rank_cd` or `ts_headline`, so search is the **one place** TaskForge uses raw SQL. Raw SQL is where injection happens, so the rules are strict (and tested in `task-search.sql.spec.ts`):

- Every request-derived value is a **bound parameter**: `${term}` inside Prisma's `sql` tag does *not* paste the text into the query; PostgreSQL receives the SQL text and the values **separately**. The SQL text is therefore constant.
- The only client choice that changes the SQL's *shape* — the sort field — is looked up in a `switch` of fixed fragments. A client string is never turned into SQL.
- User-typed text goes through **`websearch_to_tsquery`**, PostgreSQL's parser for end-user input. It supports `"exact phrases"`, `or`, and `-excluded` words — and *never throws a syntax error*, whatever is typed. (Its older sibling `to_tsquery` raises errors on input like `login &`.)
- IDs are cast (`${id}::uuid`): `$queryRaw` sends strings as text, and PostgreSQL will not compare a `uuid` column to text without the cast.

## 6. Two Phases: Raw SQL Finds, Prisma Loads

`SearchService` splits the work:

1. **Raw SQL** returns, for the requested page only, the matching task *ids in display order* plus relevance score and highlighted fragments.
2. **Prisma** then loads those tasks with their assignee, labels and column in **one** query (`id IN (...)`), reusing the same shapes as every other task endpoint, and the rows are put back in search order.

This avoids both extremes: not rebuilding task serialization by hand in SQL, and not an N+1 (one query per result).

**Why highlights are computed late.** `ts_headline` is expensive. The query numbers every match with `row_number()`, and only the outer query — filtered to the requested window — calls `ts_headline`, so it runs for at most `pageSize` rows, not for every match.

**Ranking.** `ts_rank_cd` scores matches (rewarding terms that appear close together, and the A/B weights above). Relevance sort is `score DESC, created_at DESC, id ASC` — the final `id` makes the order **total**, so a task can never appear on two pages or none while paging (the same reason Phase 10's sorts end in `id`).

## 7. Highlighting Without Opening an XSS Hole

Showing "Fix **login** redirect" needs the matched words marked. The tempting route — have the server return `Fix <mark>login</mark> redirect` and render it with `dangerouslySetInnerHTML` — is a classic **cross-site-scripting (XSS)** trap: titles are typed by users, and one unescaped `<script>` in a task title would run in every searcher's browser.

Instead the server marks matches with plain characters (`⟦` and `⟧`). The frontend's `splitHighlight` turns the string into parts, and React renders every part as *text* (automatically escaped); only parts flagged as matches are wrapped in a `<mark>` element that **we** create. User text never becomes markup.

## 8. Combining Search with Filters, Sorting and Paging

The search endpoint reuses Phase 10's `TaskFilterDto` — priority, assignee, label, overdue — and its pagination rules (`page`, `pageSize` capped at 100). All conditions combine with `AND`. Sorting offers `relevance` (default) plus the Phase 10 columns. Validation is strict: an unknown sort field, an oversized page, a non-UUID id, an empty or over-long query are all `400`s.

```
GET /organizations/:id/projects/:projectId/search/tasks
      ?q=login redirect&priority=HIGH&overdue=true&sortBy=relevance&page=1&pageSize=20
```

Authorization is the same chain as every project read (JWT → organization membership → project access), and the SQL is scoped to the project (`b.project_id`). Another project's — or organization's — tasks can never appear. A project you cannot see is a `404`.

## 9. Project Search: the Right Tool for a Different Job

`GET /organizations/:id/projects?search=apollo` does **not** use full-text search, deliberately:

- an organization's *visible projects* are a short list (tens, not millions) — no index is needed;
- people search project **names**, often by **fragments** ("apo" → "Apollo"). FTS matches whole stems, so "apo" would find nothing. A case-insensitive substring match is simply what people expect here.

So it is Prisma's `contains` with `mode: insensitive`. Two details worth knowing: the search is ANDed with the visibility rules (it can never reveal a project you could not already list), and `%` and `_` — which are *wildcards* inside a `LIKE` pattern — are escaped (`escapeLike`) so searching `100%` means the literal text. **Choosing the simplest tool that fits** is the lesson; if the list grew large, the upgrade path is the `pg_trgm` extension, which indexes fragment matching.

## 10. Other Fixes Made in This Phase

Running the app without Redis exposed a Phase 12 bug: the backend **crashed** about ten seconds after start with `MaxRetriesPerRequestError`.

- **Cause.** The Socket.IO Redis adapter sends `SUBSCRIBE` commands once at startup. By default the Redis client gives up on a command after 20 failed reconnects and *rejects* its promise — and nothing handled that promise. An unhandled promise rejection terminates a Node.js process. A dependency being down was therefore fatal instead of degrading features.
- **Fix.** The adapter's connections now use `maxRetriesPerRequest: null` (commands *wait* for Redis rather than failing) and a capped reconnect delay. Until Redis is back, real-time works in single-instance mode; when it returns, ioredis re-subscribes automatically.
- **Quieter logs.** The same outage printed several lines per second, with an *empty* message (Node reports connecting to `localhost` over IPv6+IPv4 as an `AggregateError` with no `message`). `watchRedisClient` now logs the first error, at most one reminder every 30 s, and a line when the connection is restored — and it guarantees an `error` listener exists (an `EventEmitter` with no `error` listener throws).
- **Scheduler retry.** `MaintenanceScheduler` registered the nightly jobs only once, at startup; if Redis was down then, they would silently never be scheduled until the next restart. It now retries every 30 s until it succeeds, and stops cleanly on shutdown.

## Known Limitations and Future Hardening

- **English only.** The `'english'` configuration decides stemming and stop-words. Multi-language content would need a per-row language column or the `simple` configuration.
- **Whole words, not prefixes.** Searching "log" does not find "login" (they stem differently). Type-ahead search needs prefix queries (`'log':*`) or `pg_trgm`.
- **Tasks only.** Comments and attachment names are not searched yet; adding comments means a second vector (or a combined view) and is a natural extension.
- **Offset pagination.** As in Phase 10, rows can shift between pages if tasks change while someone pages. Fine here; cursor pagination is the alternative.
- **Not in real time.** Search results refresh when you search again or reload; they are not pushed over WebSockets.
- **No rate limiting yet.** Search is one of the more expensive endpoints; a rate limiter is planned for Phase 20 (production hardening).
- **Stop-words-only queries** ("the") parse to an empty query and return no results.

## Where to Look

| Concern | File |
|---|---|
| The trigger, column, GIN index | `backend/prisma/migrations/20261017120000_add_task_full_text_search/migration.sql` |
| The safe SQL builder | `backend/src/search/task-search.sql.ts` |
| The two-phase search | `backend/src/search/search.service.ts` |
| Query validation | `backend/src/search/dto/search-tasks-query.dto.ts` |
| Project search | `backend/src/projects/projects.service.ts` (`findAllVisible`), `backend/src/common/utils/escape-like.ts` |
| Redis crash fix | `backend/src/queues/redis-config.ts`, `redis-connection-logger.ts`, `backend/src/realtime/socket-io.adapter.ts` |
| Scheduler retry | `backend/src/maintenance/maintenance.scheduler.ts` |
| Search UI | `frontend/src/pages/SearchPage.tsx`, `components/Highlighted.tsx`, `utils/highlight.ts` |
