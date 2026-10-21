import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { settleNotifications } from './helpers/queues';

/**
 * SEARCH end-to-end tests: the real PostgreSQL full-text index, trigger, ranking
 * and highlighting - none of which can be faked, which is why these matter.
 * (Needs Postgres with the Phase 14 migration applied, and Redis, like the
 * other e2e files.)
 */
jest.setTimeout(30_000);

describe('Search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createAppValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
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

  beforeEach(async () => {
    await settleNotifications(app);
    await wipe();
  });

  afterAll(async () => {
    if (app && prisma) {
      await settleNotifications(app);
      await wipe();
      await app.close();
    }
  });

  async function register(email: string, name: string) {
    const res = await api()
      .post('/auth/register')
      .send({ email, name, password: 'password1' })
      .expect(201);
    return { id: res.body.user.id as string, email, token: res.body.tokens.accessToken as string };
  }

  /** An organization with a lead, a plain member, an outsider, and one project + board. */
  async function world() {
    const lead = await register('lead@example.com', 'Lena Lead');
    const outsider = await register('outsider@example.com', 'Olga Outsider');
    const orgId = (
      await api().post('/organizations').set('Authorization', bearer(lead.token)).send({ name: 'Org' }).expect(201)
    ).body.id as string;

    const makeProject = async (name: string, description?: string) => {
      const projectId = (
        await api()
          .post(`/organizations/${orgId}/projects`)
          .set('Authorization', bearer(lead.token))
          .send({ name, description })
          .expect(201)
      ).body.id as string;
      const board = (
        await api()
          .post(`/organizations/${orgId}/projects/${projectId}/boards`)
          .set('Authorization', bearer(lead.token))
          .send({ name: 'Sprint' })
          .expect(201)
      ).body;
      const boardPath = `/organizations/${orgId}/projects/${projectId}/boards/${board.id}`;
      const createTask = async (
        title: string,
        extra: { description?: string; priority?: string; columnId?: string } = {},
      ) =>
        (
          await api()
            .post(`${boardPath}/tasks`)
            .set('Authorization', bearer(lead.token))
            .send({ columnId: extra.columnId ?? board.columns[0].id, title, ...extra })
            .expect(201)
        ).body.id as string;
      const search = (params: Record<string, string | number>, token = lead.token) =>
        api()
          .get(`/organizations/${orgId}/projects/${projectId}/search/tasks`)
          .query(params)
          .set('Authorization', bearer(token));
      return { projectId, board, boardPath, createTask, search };
    };

    return { lead, outsider, orgId, makeProject };
  }

  describe('finding tasks', () => {
    it('matches title and description, ranks a title match above a description match, and highlights', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      const inDescription = await p.createTask('Update docs', {
        description: 'The login flow is described here',
      });
      const inTitle = await p.createTask('Fix login redirect');
      await p.createTask('Unrelated chore', { description: 'Water the plants' });

      const res = await p.search({ q: 'login' }).expect(200);

      expect(res.body.total).toBe(2);
      // Title (weight A) outranks description (weight B).
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([inTitle, inDescription]);
      expect(res.body.items[0].score).toBeGreaterThan(res.body.items[1].score);
      // Highlight markers wrap the matched word; they are plain characters, not HTML.
      expect(res.body.items[0].titleHighlight).toBe('Fix ⟦login⟧ redirect');
      expect(res.body.items[1].snippet).toContain('⟦login⟧');
      expect(res.body.items[0].snippet).toBeNull();
      // Same task shape as the other endpoints, plus where it lives.
      expect(res.body.items[0]).toMatchObject({
        id: inTitle,
        labels: [],
        assignee: null,
        column: { id: p.board.columns[0].id, name: expect.any(String), boardId: p.board.id },
      });
    });

    it('stems words: "run" finds "running" and "runs"', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Running the migration');
      await p.createTask('Nightly job runs late');
      await p.createTask('Walk the dog');

      const res = await p.search({ q: 'run' }).expect(200);

      expect(res.body.total).toBe(2);
    });

    it('supports "quoted phrases" and -exclusions the way web search does', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Reset password email');
      await p.createTask('Email password policy');
      await p.createTask('Password reset page');

      const phrase = await p.search({ q: '"password reset"' }).expect(200);
      expect(phrase.body.items.map((i: { title: string }) => i.title)).toEqual(['Password reset page']);

      const excluded = await p.search({ q: 'password -email' }).expect(200);
      expect(excluded.body.items.map((i: { title: string }) => i.title)).toEqual(['Password reset page']);
    });

    it('keeps working when the title or description is edited (the trigger re-indexes)', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      const taskId = await p.createTask('Old wording');
      await p.search({ q: 'refactor' }).expect(200).expect((r) => expect(r.body.total).toBe(0));

      await api()
        .patch(`${p.boardPath}/tasks/${taskId}`)
        .set('Authorization', bearer(w.lead.token))
        .send({ title: 'Refactor the billing module' })
        .expect(200);

      await p.search({ q: 'refactor' }).expect(200).expect((r) => expect(r.body.total).toBe(1));
      await p.search({ q: 'wording' }).expect(200).expect((r) => expect(r.body.total).toBe(0));
    });

    it('is safe against hostile search text: no error, no matches, tables intact', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Normal task');

      for (const q of ["'; DROP TABLE tasks; --", '"unterminated', '((( & | !', "login') OR 1=1 --"]) {
        const res = await p.search({ q }).expect(200);
        expect(res.body.items).toEqual([]);
      }
      await p.search({ q: 'normal' }).expect(200).expect((r) => expect(r.body.total).toBe(1));
    });
  });

  describe('filters, sorting and paging', () => {
    it('combines the text match with filters (priority, column, board)', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Deploy hotfix', { priority: 'URGENT' });
      await p.createTask('Deploy docs', { priority: 'LOW' });
      await p.createTask('Deploy tooling', {
        priority: 'URGENT',
        columnId: p.board.columns[1].id,
      });

      const urgent = await p.search({ q: 'deploy', priority: 'URGENT' }).expect(200);
      expect(urgent.body.total).toBe(2);

      const urgentInFirstColumn = await p
        .search({ q: 'deploy', priority: 'URGENT', columnId: p.board.columns[0].id })
        .expect(200);
      expect(urgentInFirstColumn.body.items.map((i: { title: string }) => i.title)).toEqual(['Deploy hotfix']);

      const wrongBoard = await p
        .search({ q: 'deploy', boardId: '00000000-0000-4000-8000-000000000000' })
        .expect(200);
      expect(wrongBoard.body.total).toBe(0);
    });

    it('sorts by a column instead of relevance', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Report charlie');
      await p.createTask('Report alpha');
      await p.createTask('Report bravo');

      const asc = await p.search({ q: 'report', sortBy: 'title', sortOrder: 'asc' }).expect(200);
      expect(asc.body.items.map((i: { title: string }) => i.title)).toEqual([
        'Report alpha',
        'Report bravo',
        'Report charlie',
      ]);
    });

    it('paginates with a stable order: pages are disjoint and complete, and the total is exact', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      for (let i = 1; i <= 5; i += 1) {
        await p.createTask(`Quarterly report ${i}`);
      }

      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await p.search({ q: 'report', pageSize: 2, page }).expect(200);
        expect(res.body).toMatchObject({ total: 5, page, pageSize: 2, totalPages: 3 });
        seen.push(...res.body.items.map((i: { id: string }) => i.id));
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);

      const beyond = await p.search({ q: 'report', pageSize: 2, page: 9 }).expect(200);
      expect(beyond.body).toMatchObject({ items: [], total: 5 });
    });
  });

  describe('authorization and tenant isolation', () => {
    it('only searches the requested project, never another one', async () => {
      const w = await world();
      const a = await w.makeProject('Project A');
      const b = await w.makeProject('Project B');
      await a.createTask('Shared keyword in A');
      await b.createTask('Shared keyword in B');

      const res = await a.search({ q: 'keyword' }).expect(200);

      expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(['Shared keyword in A']);
    });

    it('401 without a token; 404 for someone outside the organization', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Secret roadmap');

      await api()
        .get(`/organizations/${w.orgId}/projects/${p.projectId}/search/tasks`)
        .query({ q: 'secret' })
        .expect(401);
      await p.search({ q: 'secret' }, w.outsider.token).expect(404);
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing q', {}],
      ['an empty q', { q: '   ' }],
      ['a q over 100 characters', { q: 'x'.repeat(101) }],
      ['an unknown sort field', { q: 'a', sortBy: 'password' }],
      ['a pageSize over the maximum', { q: 'a', pageSize: 1000 }],
      ['page 0', { q: 'a', page: 0 }],
      ['a malformed columnId', { q: 'a', columnId: 'nope' }],
      ['an unknown priority', { q: 'a', priority: 'EXTREME' }],
    ])('400 for %s', async (_label, params) => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.search(params as Record<string, string | number>).expect(400);
    });
  });

  describe('project search (GET /organizations/:id/projects?search=)', () => {
    const list = (app_: INestApplication, orgId: string, token: string, search: string) =>
      request(app_.getHttpServer())
        .get(`/organizations/${orgId}/projects`)
        .query({ search })
        .set('Authorization', bearer(token));

    it('matches name or description, case-insensitively', async () => {
      const w = await world();
      await w.makeProject('Apollo Mission');
      await w.makeProject('Website', 'Rebuild for the APOLLO launch');
      await w.makeProject('Unrelated');

      const res = await list(app, w.orgId, w.lead.token, 'apollo').expect(200);

      expect(res.body.map((p: { name: string }) => p.name).sort()).toEqual(['Apollo Mission', 'Website']);
    });

    it('treats % and _ as ordinary characters, not wildcards', async () => {
      const w = await world();
      await w.makeProject('Q4 100% done');
      await w.makeProject('Q4 1000 done');

      const res = await list(app, w.orgId, w.lead.token, '100%').expect(200);

      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Q4 100% done']);
    });

    it('never reveals a project the requester could not already list', async () => {
      const w = await world();
      const member = await register('member@example.com', 'Max Member');
      await api()
        .post(`/organizations/${w.orgId}/members`)
        .set('Authorization', bearer(w.lead.token))
        .send({ email: member.email })
        .expect(201);
      await w.makeProject('Private apollo'); // member is NOT on this project

      const res = await list(app, w.orgId, member.token, 'apollo').expect(200);

      expect(res.body).toEqual([]);
    });
  });
});
