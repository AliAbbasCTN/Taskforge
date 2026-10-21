import type { OpenAPIObject } from '@nestjs/swagger';
import { EXAMPLE_UUID } from './models/examples';

/**
 * WHAT: A pure function that fills in the documentation that is the SAME for
 * whole families of routes, after Nest has generated the document.
 *
 * WHY here and not as decorators on 85 routes: three facts hold for nearly every
 * route and follow mechanically from its shape -
 *   - a route with a bearer-token requirement can answer 401,
 *   - a route with path ids, a body or a query string can answer 400,
 *   - a route under `/organizations/{id}` answers 404 for an organization you
 *     are not in (see `OrganizationMembershipGuard`).
 * Repeating those on every handler is noise that drifts. Deriving them from the
 * document's structure keeps one rule in one place. Anything a route does
 * DIFFERENTLY (409, 422, a specific 404) is declared explicitly with
 * `@ApiEndpoint(...)`, and explicit declarations always win here.
 *
 * It is a plain function over plain data, so it is unit-tested without
 * starting Nest.
 */

interface ParameterLike {
  in?: string;
  name?: string;
  description?: string;
  example?: unknown;
  schema?: Record<string, unknown>;
}

interface OperationLike {
  security?: unknown[];
  parameters?: ParameterLike[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
const ERROR_SCHEMA_REF = { $ref: '#/components/schemas/ErrorResponseDto' };

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ERROR_SCHEMA_REF } },
});

/** What each path parameter means. `id` is ambiguous, so see `describeParam`. */
const PARAM_DESCRIPTIONS: Record<string, string> = {
  teamId: 'Team id',
  userId: 'User id',
  projectId: 'Project id',
  boardId: 'Board id',
  columnId: 'Column id',
  taskId: 'Task id',
  commentId: 'Comment id',
  attachmentId: 'Attachment id',
  labelId: 'Label id',
};

/**
 * The bare name `id` means a different thing depending on the controller: in
 * `/organizations/{id}/...` it is the organization (the guards read
 * `params.id`), in `/users/{id}` a user, in `/notifications/{id}/read` a
 * notification.
 */
export function describePathParam(path: string, name: string): string {
  if (name !== 'id') {
    return PARAM_DESCRIPTIONS[name] ?? name;
  }
  if (path.startsWith('/organizations')) return 'Organization id';
  if (path.startsWith('/users')) return 'User id';
  if (path.startsWith('/notifications')) return 'Notification id';
  return 'Resource id';
}

/** Names the deepest resource in a path, for the generic 404 message. */
function deepestResource(path: string): string | null {
  const order: Array<[string, string]> = [
    ['{attachmentId}', 'attachment'],
    ['{commentId}', 'comment'],
    ['{taskId}', 'task'],
    ['{columnId}', 'column'],
    ['{labelId}', 'label'],
    ['{boardId}', 'board'],
    ['{projectId}', 'project'],
    ['{teamId}', 'team'],
  ];
  for (const [token, resource] of order) {
    if (path.includes(token)) return resource;
  }
  return path.startsWith('/organizations/{id}') ? 'organization' : null;
}

export function enrichOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | OperationLike
        | undefined;
      if (!operation) continue;

      const parameters = operation.parameters ?? [];
      const responses = (operation.responses ??= {});

      // Path parameters: say what each id is, and that it is a UUID.
      for (const param of parameters) {
        if (param.in === 'path' && param.name) {
          param.description ??= describePathParam(path, param.name);
          param.schema = { ...param.schema, type: 'string', format: 'uuid' };
          param.example ??= EXAMPLE_UUID;
        }
      }

      const isSecured = (operation.security?.length ?? 0) > 0;
      const hasInput =
        parameters.some((p) => p.in === 'path' || p.in === 'query') ||
        operation.requestBody !== undefined;

      if (isSecured && !responses['401']) {
        responses['401'] = errorResponse(
          'Unauthorized - the access token is missing, malformed, expired or has an invalid signature.',
        );
      }

      if (hasInput && !responses['400']) {
        responses['400'] = errorResponse(
          'Bad request - a path id is not a valid UUID, or the body/query string failed validation. `message` lists each failed rule.',
        );
      }

      const resource = deepestResource(path);
      if (isSecured && resource && !responses['404']) {
        responses['404'] = errorResponse(
          `Not found - the ${resource} does not exist, is not in this organization, or you are not allowed to see it. TaskForge answers 404 (not 403) in these cases so that ids cannot be probed for existence.`,
        );
      }
    }
  }
  return document;
}
