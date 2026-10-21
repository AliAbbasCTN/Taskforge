import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import {
  BEARER_AUTH_NAME,
  ErrorResponseDto,
} from '../common/swagger';
import { enrichOpenApiDocument } from './openapi-enrichment';

/** Where the interactive UI is served. The JSON/YAML live beside it. */
export const DOCS_PATH = 'docs';
export const DOCS_JSON_PATH = 'docs-json';
export const DOCS_YAML_PATH = 'docs-yaml';

const API_DESCRIPTION = `
TaskForge is a multi-tenant project management API: **organizations** contain
**teams** and **projects**; projects contain **boards**, **columns** and
**tasks**.

## Authenticating

1. \`POST /auth/register\` or \`POST /auth/login\` returns an **access token**
   and a **refresh token**.
2. Send the access token on every other request:
   \`Authorization: Bearer <accessToken>\`. In this page, press **Authorize**
   and paste the token (without the word \`Bearer\`).
3. Access tokens are short-lived. When one expires (401), call
   \`POST /auth/refresh\` with the refresh token to get a NEW pair. Refresh
   tokens are single-use: the old one stops working.

## Errors

Every error has the same JSON shape (see **ErrorResponseDto**): \`statusCode\`,
\`message\`, \`error\`, \`path\`, \`timestamp\`. Validation failures (400) return
\`message\` as a list, one entry per failed rule.

| Status | Meaning |
|---|---|
| 400 | Invalid input: a malformed id, a missing or unknown field |
| 401 | Missing, invalid or expired access token |
| 403 | You can see the thing, but your role does not allow this action |
| 404 | It does not exist, **or you are not allowed to know it exists** |
| 409 | The request conflicts with the current state (duplicate, archived project, non-empty column) |
| 422 | The request is well-formed but cannot be applied (e.g. the user is not in the organization) |

## Multi-tenancy

Almost everything lives under \`/organizations/{id}\`. You only ever see data
from organizations you belong to. Resources you may not see answer **404**,
never 403, so ids cannot be probed.

## Pagination

Paginated routes accept \`page\` (from 1) and \`pageSize\` (up to 100) and
return \`{ items, total, page, pageSize, totalPages }\`.

## Permissions

Routes that need a specific permission list it in their **403** response and in
the \`x-required-permission\` extension. Routes that record an audit-trail entry
list it in \`x-activity-action\`.

## Real-time

Live updates use a Socket.IO WebSocket connection, which OpenAPI cannot
describe. See \`docs/phase-11-concepts.md\`.
`.trim();

/**
 * Tags group routes in the UI, in this order. The names must match the
 * `@ApiTags(...)` on each controller.
 */
const TAGS: Array<[string, string]> = [
  ['Health', 'Is the service, and what it depends on, working?'],
  ['Auth', 'Register, log in, refresh and log out.'],
  ['Users', 'User profiles. You can only change your own.'],
  ['Organizations', 'Tenants and their memberships.'],
  ['Teams', 'Working groups inside an organization.'],
  ['Projects', 'Projects, their lifecycle (archive/delete) and members.'],
  ['Boards', 'Kanban boards inside a project.'],
  ['Columns', 'The columns (statuses) of a board.'],
  ['Tasks', 'Tasks on a board: create, edit, move, label, list.'],
  ['Labels', 'A project\'s label vocabulary.'],
  ['Comments', 'Discussion on a task.'],
  ['Attachments', 'Files attached to a task.'],
  ['Search', 'Full-text search over a project\'s tasks.'],
  ['Activity', 'The project activity feed and the organization audit trail.'],
  ['Notifications', 'Your personal inbox.'],
];

/**
 * Builds the OpenAPI document from the running app's controllers and DTOs.
 * Exported separately from `setupSwagger` so tests can inspect the document
 * without serving it.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('TaskForge API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'The `accessToken` returned by `/auth/login` or `/auth/register`.',
      },
      BEARER_AUTH_NAME,
    );

  for (const [name, description] of TAGS) {
    builder.addTag(name, description);
  }

  const document = SwaggerModule.createDocument(app, builder.build(), {
    // ErrorResponseDto is only referenced by the post-processing step, so it
    // must be registered explicitly or the `$ref` would point at nothing.
    extraModels: [ErrorResponseDto],
    // `Tasks_list` instead of `TasksController_list`: shorter, and it becomes
    // the function name in generated API clients.
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  return enrichOpenApiDocument(document);
}

/**
 * Serves the interactive docs at `/docs`, plus the raw document at
 * `/docs-json` and `/docs-yaml`. Returns whether anything was mounted.
 * Call it BEFORE `app.listen()` / `app.init()`.
 */
export function setupSwagger(app: INestApplication, enabled: boolean): boolean {
  if (!enabled) {
    return false;
  }
  SwaggerModule.setup(DOCS_PATH, app, createOpenApiDocument(app), {
    jsonDocumentUrl: DOCS_JSON_PATH,
    yamlDocumentUrl: DOCS_YAML_PATH,
    customSiteTitle: 'TaskForge API',
    swaggerOptions: {
      // Keep the pasted token across page reloads while exploring.
      persistAuthorization: true,
      docExpansion: 'none',
    },
  });
  return true;
}
