import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { setupSwagger } from '../src/docs/swagger';
import { settleNotifications } from './helpers/queues';
import { arrayOf, modelRef, schemaMismatches } from './helpers/openapi';

/**
 * API DOCUMENTATION end-to-end tests. Two kinds:
 *
 *  1. COVERAGE: the generated OpenAPI document describes every route properly
 *     (summary, tag, success response, security) - so a route added in a later
 *     phase without documentation fails the build instead of silently shipping.
 *  2. CONTRACT: real responses match the published response models, in both
 *     directions (nothing undocumented, nothing documented that is not sent).
 *
 * (Needs Postgres and Redis, like the other e2e files.)
 */
jest.setTimeout(30_000);

type Operation = {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, unknown>;
  'x-required-permission'?: string;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Routes that are deliberately open to anyone. Everything else needs a token. */
const PUBLIC_ROUTES = new Set([
  'get /health',
  'post /auth/register',
  'post /auth/login',
  'post /auth/refresh',
]);

describe('API documentation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let doc: OpenAPIObject;

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => `Bearer ${token}`;

  const operations = (): Array<{ key: string; op: Operation }> =>
    Object.entries(doc.paths).flatMap(([path, item]) =>
      METHODS.filter((m) => (item as Record<string, unknown>)[m]).map((m) => ({
        key: `${m} ${path}`,
        op: (item as Record<string, Operation>)[m],
      })),
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createAppValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    // Must run BEFORE init(): routes added afterwards miss Nest's 404 handler.
    setupSwagger(app, true);
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    doc = res.body as OpenAPIObject;
  });

  const wipe = async () => {
    await prisma.notification.deleteMany();
    await prisma.task.deleteMany();
    await prisma.boardColumn.deleteMany();
    await prisma.board.deleteMany();
    await prisma.projectMembership.deleteMany();
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  };

  afterAll(async () => {
    if (app && prisma) {
      await settleNotifications(app);
      await wipe();
      await app.close();
    }
  });

  describe('the served documentation', () => {
    it('serves the interactive UI and the raw document', async () => {
      const ui = await api().get('/docs').expect(200);
      expect(ui.headers['content-type']).toContain('text/html');
      await api().get('/docs-yaml').expect(200);
    });

    it('describes the API and declares the bearer scheme', () => {
      expect(doc.info.title).toBe('TaskForge API');
      expect(doc.components?.securitySchemes).toHaveProperty('access-token');
    });
  });

  describe('coverage: every route is documented', () => {
    it('documents a decent number of routes', () => {
      expect(operations().length).toBeGreaterThanOrEqual(71);
    });

    it('uses only tags that are declared (and described) in the document', () => {
      const declared = new Set((doc.tags ?? []).map((t) => t.name));
      const used = new Set(operations().flatMap(({ op }) => op.tags ?? []));
      expect([...used].filter((tag) => !declared.has(tag))).toEqual([]);
    });

    it('gives every route a summary, a tag and a unique operationId', () => {
      const missing: string[] = [];
      const ids = new Set<string>();
      for (const { key, op } of operations()) {
        if (!op.summary) missing.push(`${key}: no summary`);
        if (!op.tags?.length) missing.push(`${key}: no tag`);
        if (!op.operationId) missing.push(`${key}: no operationId`);
        else if (ids.has(op.operationId)) missing.push(`${key}: duplicate operationId`);
        else ids.add(op.operationId);
      }
      expect(missing).toEqual([]);
    });

    it('requires a bearer token on every route except the public ones', () => {
      const wrong: string[] = [];
      for (const { key, op } of operations()) {
        const secured = (op.security?.length ?? 0) > 0;
        if (PUBLIC_ROUTES.has(key) && secured) wrong.push(`${key}: should be public`);
        if (!PUBLIC_ROUTES.has(key) && !secured) wrong.push(`${key}: not marked as secured`);
      }
      expect(wrong).toEqual([]);
    });

    it('documents a success response and the standard error responses', () => {
      const problems: string[] = [];
      for (const { key, op } of operations()) {
        const codes = Object.keys(op.responses ?? {});
        if (!codes.some((c) => c.startsWith('2'))) problems.push(`${key}: no 2xx response`);
        if (!PUBLIC_ROUTES.has(key) && !codes.includes('401')) {
          problems.push(`${key}: no 401`);
        }
        if (op['x-required-permission'] && !codes.includes('403')) {
          problems.push(`${key}: has a required permission but no 403`);
        }
      }
      expect(problems).toEqual([]);
    });

    it('describes every path parameter as a UUID', () => {
      const problems: string[] = [];
      for (const [path, item] of Object.entries(doc.paths)) {
        for (const m of METHODS) {
          const op = (item as Record<string, { parameters?: Array<Record<string, any>> }>)[m];
          for (const p of op?.parameters ?? []) {
            if (p.in === 'path' && (p.schema?.format !== 'uuid' || !p.description)) {
              problems.push(`${m} ${path}: {${p.name}}`);
            }
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it('documents permissions that really exist', () => {
      const permissions = new Set(
        operations()
          .map(({ op }) => op['x-required-permission'])
          .filter(Boolean),
      );
      expect(permissions.has('project:manage')).toBe(true);
      expect(permissions.has('organization:audit:read')).toBe(true);
    });
  });

  describe('contract: real responses match the documented models', () => {
    async function register(email: string, name: string) {
      const res = await api()
        .post('/auth/register')
        .send({ email, name, password: 'password1' })
        .expect(201);
      return { res, token: res.body.tokens.accessToken as string };
    }

    const matches = (schema: ReturnType<typeof modelRef>, body: unknown) =>
      expect(schemaMismatches(doc, schema, body)).toEqual([]);

    it('identity, organization and project responses', async () => {
      await wipe();
      const { res: registered, token } = await register('ada@example.com', 'Ada');
      matches(modelRef('AuthResponse'), registered.body);

      matches(
        modelRef('UserResponse'),
        (await api().get('/auth/me').set('Authorization', bearer(token)).expect(200)).body,
      );

      const org = await api()
        .post('/organizations')
        .set('Authorization', bearer(token))
        .send({ name: 'Acme' })
        .expect(201);
      matches(modelRef('OrganizationWithRoleResponse'), org.body);
      const orgId = org.body.id as string;

      matches(
        arrayOf('OrganizationMemberResponse'),
        (await api().get(`/organizations/${orgId}/members`).set('Authorization', bearer(token)).expect(200)).body,
      );

      const project = await api()
        .post(`/organizations/${orgId}/projects`)
        .set('Authorization', bearer(token))
        .send({ name: 'Site', description: 'Relaunch' })
        .expect(201);
      matches(modelRef('ProjectResponse'), project.body);

      matches(
        arrayOf('ProjectSummaryResponse'),
        (await api().get(`/organizations/${orgId}/projects`).set('Authorization', bearer(token)).expect(200)).body,
      );
      await settleNotifications(app);
    });

    it('board, task, comment, activity, notification and health responses', async () => {
      await wipe();
      const { token } = await register('lena@example.com', 'Lena');
      const auth = { Authorization: bearer(token) };
      const orgId = (await api().post('/organizations').set(auth).send({ name: 'Org' }).expect(201)).body.id as string;
      const projectId = (
        await api().post(`/organizations/${orgId}/projects`).set(auth).send({ name: 'Proj' }).expect(201)
      ).body.id as string;
      const base = `/organizations/${orgId}/projects/${projectId}`;

      const board = await api().post(`${base}/boards`).set(auth).send({ name: 'Board' }).expect(201);
      matches(modelRef('BoardWithColumnsResponse'), board.body);
      const boardId = board.body.id as string;
      const columnId = board.body.columns[0].id as string;

      const task = await api()
        .post(`${base}/boards/${boardId}/tasks`)
        .set(auth)
        .send({ columnId, title: 'Fix login', description: 'It redirects wrongly' })
        .expect(201);
      matches(modelRef('TaskResponse'), task.body);
      const taskId = task.body.id as string;

      matches(
        modelRef('BoardDetailResponse'),
        (await api().get(`${base}/boards/${boardId}`).set(auth).expect(200)).body,
      );
      matches(
        modelRef('PaginatedTaskListResponse'),
        (await api().get(`${base}/boards/${boardId}/tasks`).set(auth).expect(200)).body,
      );

      matches(
        modelRef('CommentResponse'),
        (
          await api()
            .post(`${base}/boards/${boardId}/tasks/${taskId}/comments`)
            .set(auth)
            .send({ body: 'Looks wrong' })
            .expect(201)
        ).body,
      );

      matches(
        modelRef('PaginatedSearchResponse'),
        (await api().get(`${base}/search/tasks`).query({ q: 'login' }).set(auth).expect(200)).body,
      );
      matches(
        modelRef('PaginatedActivityResponse'),
        (await api().get(`${base}/activity`).set(auth).expect(200)).body,
      );
      matches(
        modelRef('PaginatedNotificationResponse'),
        (await api().get('/notifications').set(auth).expect(200)).body,
      );
      matches(
        modelRef('UnreadCountResponse'),
        (await api().get('/notifications/unread-count').set(auth).expect(200)).body,
      );

      const health = await api().get('/health');
      matches(modelRef('HealthResponse'), health.body);
      await settleNotifications(app);
    });
  });
});
