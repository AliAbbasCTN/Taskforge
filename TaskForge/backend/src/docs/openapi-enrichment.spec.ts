import type { OpenAPIObject } from '@nestjs/swagger';
import { describePathParam, enrichOpenApiDocument } from './openapi-enrichment';

/** A minimal document: only the parts the enrichment looks at. */
const docWith = (paths: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths,
  }) as unknown as OpenAPIObject;

const SECURED = [{ 'access-token': [] }];

type Op = {
  parameters?: Array<Record<string, unknown>>;
  responses: Record<string, unknown>;
};
const operation = (doc: OpenAPIObject, path: string, method: string): Op =>
  (doc.paths[path] as unknown as Record<string, Op>)[method];

describe('enrichOpenApiDocument', () => {
  it('adds 401 to secured routes only', () => {
    const doc = enrichOpenApiDocument(
      docWith({
        '/health': { get: { responses: { '200': {} } } },
        '/auth/me': { get: { security: SECURED, responses: { '200': {} } } },
      }),
    );
    expect(operation(doc, '/health', 'get').responses['401']).toBeUndefined();
    expect(operation(doc, '/auth/me', 'get').responses['401']).toBeDefined();
  });

  it('adds 400 when a route takes path ids, a query string or a body', () => {
    const doc = enrichOpenApiDocument(
      docWith({
        '/auth/me': { get: { security: SECURED, responses: {} } },
        '/auth/login': { post: { requestBody: {}, responses: {} } },
        '/notifications': {
          get: {
            security: SECURED,
            parameters: [{ in: 'query', name: 'page' }],
            responses: {},
          },
        },
        '/users/{id}': {
          get: {
            security: SECURED,
            parameters: [{ in: 'path', name: 'id' }],
            responses: {},
          },
        },
      }),
    );
    expect(operation(doc, '/auth/me', 'get').responses['400']).toBeUndefined();
    expect(operation(doc, '/auth/login', 'post').responses['400']).toBeDefined();
    expect(operation(doc, '/notifications', 'get').responses['400']).toBeDefined();
    expect(operation(doc, '/users/{id}', 'get').responses['400']).toBeDefined();
  });

  it('adds a resource-specific 404 under /organizations/{id}', () => {
    const doc = enrichOpenApiDocument(
      docWith({
        '/organizations': { get: { security: SECURED, responses: {} } },
        '/organizations/{id}/projects/{projectId}': {
          get: { security: SECURED, responses: {} },
        },
      }),
    );
    expect(operation(doc, '/organizations', 'get').responses['404']).toBeUndefined();
    const nf = operation(doc, '/organizations/{id}/projects/{projectId}', 'get')
      .responses['404'] as { description: string };
    expect(nf.description).toContain('the project');
    expect(nf.description).toContain('not 403');
  });

  it('never overwrites a response a route declared itself', () => {
    const custom = { description: 'custom 404' };
    const doc = enrichOpenApiDocument(
      docWith({
        '/organizations/{id}/members/{userId}': {
          delete: { security: SECURED, responses: { '404': custom } },
        },
      }),
    );
    expect(
      operation(doc, '/organizations/{id}/members/{userId}', 'delete').responses['404'],
    ).toBe(custom);
  });

  it('describes path parameters as UUIDs with a meaningful description', () => {
    const doc = enrichOpenApiDocument(
      docWith({
        '/organizations/{id}/teams/{teamId}': {
          get: {
            security: SECURED,
            parameters: [
              { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
              { in: 'path', name: 'teamId', required: true, schema: { type: 'string' } },
            ],
            responses: {},
          },
        },
      }),
    );
    const [org, team] = operation(doc, '/organizations/{id}/teams/{teamId}', 'get')
      .parameters as Array<{
      description: string;
      schema: { format: string };
      example: string;
    }>;
    expect(org.description).toBe('Organization id');
    expect(team.description).toBe('Team id');
    expect(org.schema.format).toBe('uuid');
    expect(team.example).toEqual(expect.any(String));
  });
});

describe('describePathParam', () => {
  it('reads the ambiguous `id` from the controller it belongs to', () => {
    expect(describePathParam('/organizations/{id}', 'id')).toBe('Organization id');
    expect(describePathParam('/users/{id}', 'id')).toBe('User id');
    expect(describePathParam('/notifications/{id}/read', 'id')).toBe('Notification id');
  });
});
