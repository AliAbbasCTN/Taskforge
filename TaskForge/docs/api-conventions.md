# TaskForge — API Conventions

## Style

- REST over HTTP/JSON. WebSockets are added later (Phase 11) for real-time events only, not as a replacement for REST.
- Resource-oriented URLs, plural nouns: `/projects`, `/tasks`, not `/getProjects`.
- Nesting reflects ownership only where it aids clarity, e.g. `/organizations/:orgId/teams`. Avoid excessive nesting (no `/organizations/:orgId/projects/:projectId/boards/:boardId/columns/:columnId/tasks/:taskId/comments/:commentId/...` — flatten where reasonable and rely on IDs + authorization checks instead).

## Example Route Shape (indicative, not final)

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /organizations
POST   /organizations
GET    /organizations/:id
PATCH  /organizations/:id

GET    /organizations/:orgId/teams
POST   /organizations/:orgId/teams

GET    /projects
POST   /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id

GET    /projects/:id/boards
POST   /projects/:id/boards

GET    /boards/:id/columns
POST   /tasks
PATCH  /tasks/:id
DELETE /tasks/:id

POST   /tasks/:id/comments
```

Exact routes will be finalized as each module is built — this is a guide, not a contract.

## Request Validation

- Every incoming request body is validated via a **DTO** (Data Transfer Object) class using `class-validator` decorators.
- Validation happens via a global `ValidationPipe` (whitelist + forbid unknown properties) — introduced in Phase 01.
- Query parameters (pagination, filters, sorting) are validated the same way, not read as raw strings and trusted.

## Response Shape

Successful responses return the resource (or array of resources) directly, with consistent shapes for lists:

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 143
  }
}
```

Single-resource responses return the object directly (no unnecessary wrapper).

## Error Responses

Errors follow NestJS's standard HTTP exception shape, kept consistent across the app:

```json
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

Rules:
- Never leak stack traces, SQL errors, or internal details in production responses.
- Use the most specific status code that applies (see below).
- Validation errors return `400` with a message per invalid field.

## HTTP Status Codes Used

| Code | Meaning | Example |
|---|---|---|
| 200 | OK | Successful GET/PATCH |
| 201 | Created | Successful POST creating a resource |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation failure |
| 401 | Unauthorized | Missing/invalid/expired token |
| 403 | Forbidden | Authenticated but not authorized for this resource |
| 404 | Not Found | Resource doesn't exist (or isn't visible to this tenant) |
| 409 | Conflict | Duplicate resource (e.g. email already registered) |
| 422 | Unprocessable Entity | Semantically invalid data that passes basic validation |
| 500 | Internal Server Error | Unexpected failure |

Note: a resource that exists but belongs to another organization returns **404**, not 403 — this avoids leaking the existence of other tenants' data.

## Pagination, Filtering, Sorting (introduced Phase 08/14)

Query parameters, all optional with sane defaults:

```
GET /tasks?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc&status=IN_PROGRESS&assigneeId=...
```

## Documentation

Every endpoint is documented in the OpenAPI document served at `/docs` (Phase 16). The rules for keeping it that way:

- Every route has `@ApiEndpoint({ summary, description?, ok | created | noContent, ... })` and its controller has `@ApiTags(...)` and `@ApiBearerAuth(BEARER_AUTH_NAME)` unless it is public.
- Every request DTO property has `@ApiProperty` / `@ApiPropertyOptional` with a realistic `example`.
- Every response has a model class in `src/docs/models/`.
- Permissions are documented by `@RequirePermission(...)` itself, and audit entries by `@LogsActivity(...)` - never repeat them by hand.
- `test/docs.e2e-spec.ts` fails if a route is added without a summary/tag/security, or if a real response stops matching its model.
