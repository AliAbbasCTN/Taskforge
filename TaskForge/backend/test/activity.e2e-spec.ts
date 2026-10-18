import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { settleNotifications } from './helpers/queues';

/**
 * ACTIVITY LOG / AUDIT TRAIL end-to-end tests. They drive real actions through
 * the API and then read the feed back, so they cover the whole chain:
 * decorator -> interceptor -> snapshot -> describer -> database -> feed.
 * (Needs Postgres with the Phase 15 migration applied, and Redis.)
 */
jest.setTimeout(30_000);

describe('Activity log (e2e)', () => {
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
    return {
      id: res.body.user.id as string,
      email,
      name,
      token: res.body.tokens.accessToken as string,
    };
  }

  /** lead (org ADMIN + project LEAD), member (org MEMBER + project MEMBER), outsider (no org). */
  async function world() {
    const lead = await register('lead@example.com', 'Lena Lead');
    const member = await register('member@example.com', 'Max Member');
    const outsider = await register('outsider@example.com', 'Olga Outsider');
    const orgId = (
      await api()
        .post('/organizations')
        .set('Authorization', bearer(lead.token))
        .send({ name: 'Org' })
        .expect(201)
    ).body.id as string;
    await api()
      .post(`/organizations/${orgId}/members`)
      .set('Authorization', bearer(lead.token))
      .send({ email: member.email })
      .expect(201);

    const as = (user: { token: string }) => ({
      get: (url: string) =>
        api().get(url).set('Authorization', bearer(user.token)),
      post: (url: string) =>
        api().post(url).set('Authorization', bearer(user.token)),
      patch: (url: string) =>
        api().patch(url).set('Authorization', bearer(user.token)),
      put: (url: string) =>
        api().put(url).set('Authorization', bearer(user.token)),
      del: (url: string) =>
        api().delete(url).set('Authorization', bearer(user.token)),
    });

    const makeProject = async (name: string) => {
      const projectId = (
        await as(lead)
          .post(`/organizations/${orgId}/projects`)
          .send({ name })
          .expect(201)
      ).body.id as string;
      await as(lead)
        .post(`/organizations/${orgId}/projects/${projectId}/members`)
        .send({ email: member.email })
        .expect(201);
      const board = (
        await as(lead)
          .post(`/organizations/${orgId}/projects/${projectId}/boards`)
          .send({ name: 'Sprint' })
          .expect(201)
      ).body;
      const projectPath = `/organizations/${orgId}/projects/${projectId}`;
      const boardPath = `${projectPath}/boards/${board.id}`;
      const createTask = async (title: string) =>
        (
          await as(lead)
            .post(`${boardPath}/tasks`)
            .send({ columnId: board.columns[0].id, title })
            .expect(201)
        ).body.id as string;
      const feed = (
        params: Record<string, string | number> = {},
        user: { token: string } = lead,
      ) => as(user).get(`${projectPath}/activity`).query(params);
      return { projectId, projectPath, board, boardPath, createTask, feed };
    };

    return {
      lead,
      member,
      outsider,
      orgId,
      as,
      makeProject,
      auditPath: `/organizations/${orgId}/audit-log`,
    };
  }

  const messages = (res: request.Response) =>
    (res.body.items as { actorName: string; message: string }[]).map(
      (i) => `${i.actorName} ${i.message}`,
    );

  describe('recording', () => {
    it("records a task's whole life, newest first, with names that survive deletion", async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      const [todo, inProgress] = p.board.columns as {
        id: string;
        name: string;
      }[];

      const taskId = await p.createTask('Fix login');
      await w
        .as(w.lead)
        .patch(`${p.boardPath}/tasks/${taskId}`)
        .send({ title: 'Fix login redirect', assigneeId: w.member.id })
        .expect(200);
      await w
        .as(w.lead)
        .post(`${p.boardPath}/tasks/${taskId}/move`)
        .send({ columnId: inProgress.id, position: 0 })
        .expect(200);
      await w
        .as(w.member)
        .post(`${p.boardPath}/tasks/${taskId}/comments`)
        .send({ body: 'On it' })
        .expect(201);
      await w.as(w.lead).del(`${p.boardPath}/tasks/${taskId}`).expect(204);

      const res = await p.feed().expect(200);

      // Newest first. The task is DELETED, yet every entry still names it.
      expect(messages(res)).toEqual([
        'Lena Lead deleted task “Fix login redirect”',
        'Max Member commented on task “Fix login redirect”',
        `Lena Lead moved task “Fix login redirect” from ${todo.name} to ${inProgress.name}`,
        'Lena Lead assigned task “Fix login redirect” to Max Member',
        'Lena Lead updated task “Fix login redirect” (title), previously “Fix login”',
        'Lena Lead created task “Fix login”',
        'Lena Lead created board “Sprint”',
        'Lena Lead added Max Member to the project as member',
        'Lena Lead created project “Apollo”',
      ]);
      expect(res.body.total).toBe(9);
    });

    it('does NOT record a request that failed, or a reorder inside one column', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      const taskId = await p.createTask('Task');
      await p.createTask('Other');
      const before = (await p.feed().expect(200)).body.total;

      await w
        .as(w.lead)
        .patch(`${p.boardPath}/tasks/${taskId}`)
        .send({})
        .expect(400); // nothing to update
      await w
        .as(w.lead)
        .del(`${p.boardPath}/tasks/00000000-0000-4000-8000-000000000000`)
        .expect(404);
      await w
        .as(w.lead)
        .post(`${p.boardPath}/tasks/${taskId}/move`)
        .send({ columnId: p.board.columns[0].id, position: 1 })
        .expect(200); // same column

      expect((await p.feed().expect(200)).body.total).toBe(before);
    });

    it('records membership and organization events in the audit trail', async () => {
      const w = await world();
      await w
        .as(w.lead)
        .patch(`/organizations/${w.orgId}/members/${w.member.id}`)
        .send({ role: 'MANAGER' })
        .expect(200);
      await w
        .as(w.lead)
        .patch(`/organizations/${w.orgId}`)
        .send({ name: 'Org Renamed' })
        .expect(200);
      await w
        .as(w.lead)
        .del(`/organizations/${w.orgId}/members/${w.member.id}`)
        .expect(204);

      const res = await w.as(w.lead).get(w.auditPath).expect(200);

      expect(messages(res)).toEqual([
        'Lena Lead removed Max Member from the organization',
        'Lena Lead updated the organization settings (name)',
        'Lena Lead changed Max Member’s organization role from member to manager',
        'Lena Lead added Max Member to the organization as member',
        'Lena Lead created the organization “Org”',
      ]);
    });
  });

  describe('the project feed', () => {
    it("can show one task's timeline", async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      const a = await p.createTask('Task A');
      const b = await p.createTask('Task B');
      await w
        .as(w.member)
        .post(`${p.boardPath}/tasks/${a}/comments`)
        .send({ body: 'hi' })
        .expect(201);

      const res = await p.feed({ taskId: a }).expect(200);

      expect(messages(res)).toEqual([
        'Max Member commented on task “Task A”',
        'Lena Lead created task “Task A”',
      ]);
      expect((await p.feed({ taskId: b }).expect(200)).body.total).toBe(1);
    });

    it('filters by action and paginates with a stable order', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
        await p.createTask(title);
      }

      const created = await p
        .feed({ action: 'task.created', pageSize: 2, page: 1 })
        .expect(200);
      expect(created.body).toMatchObject({ total: 5, totalPages: 3 });

      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await p
          .feed({ action: 'task.created', pageSize: 2, page })
          .expect(200);
        seen.push(...(res.body.items as { id: string }[]).map((i) => i.id));
      }
      expect(new Set(seen).size).toBe(5);
    });

    it("shows only that project's events, and is private to people who can see the project", async () => {
      const w = await world();
      const a = await w.makeProject('Project A');
      const b = await w.makeProject('Project B');
      await b.createTask('Secret B task');

      const res = await a.feed().expect(200);
      expect(messages(res).join('\n')).not.toContain('Secret B task');

      await a.feed({}, w.outsider).expect(404);
      await api().get(`${a.projectPath}/activity`).expect(401);
    });

    it('rejects invalid filters with 400', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.feed({ action: 'task.exploded' }).expect(400);
      await p.feed({ taskId: 'nope' }).expect(400);
      await p.feed({ from: 'yesterday-ish' }).expect(400);
      await p.feed({ pageSize: 5000 }).expect(400);
    });
  });

  describe('the audit trail', () => {
    it('is ADMIN only: a plain member gets 403, an outsider 404, no token 401', async () => {
      const w = await world();

      await w.as(w.lead).get(w.auditPath).expect(200);
      await w.as(w.member).get(w.auditPath).expect(403);
      await w.as(w.outsider).get(w.auditPath).expect(404);
      await api().get(w.auditPath).expect(401);
    });

    it('spans every project, and filters by project, actor, action and date', async () => {
      const w = await world();
      const a = await w.makeProject('Project A');
      const b = await w.makeProject('Project B');
      await a.createTask('In A');
      await w
        .as(w.member)
        .post(`${b.boardPath}/tasks`)
        .send({ columnId: b.board.columns[0].id, title: 'In B' })
        .expect(201);

      const all = await w
        .as(w.lead)
        .get(w.auditPath)
        .query({ action: 'task.created' })
        .expect(200);
      expect(messages(all).sort()).toEqual([
        'Lena Lead created task “In A”',
        'Max Member created task “In B”',
      ]);

      const byProject = await w
        .as(w.lead)
        .get(w.auditPath)
        .query({ projectId: b.projectId, action: 'task.created' })
        .expect(200);
      expect(messages(byProject)).toEqual(['Max Member created task “In B”']);

      const byActor = await w
        .as(w.lead)
        .get(w.auditPath)
        .query({ actorId: w.member.id, action: 'task.created' })
        .expect(200);
      expect(byActor.body.total).toBe(1);

      const future = await w
        .as(w.lead)
        .get(w.auditPath)
        .query({ from: '2999-01-01' })
        .expect(200);
      expect(future.body.total).toBe(0);
    });

    it("is tenant-isolated: another organization's admin cannot read it", async () => {
      const w = await world();
      const other = await register('other-admin@example.com', 'Other Admin');
      await api()
        .post('/organizations')
        .set('Authorization', bearer(other.token))
        .send({ name: 'Other Org' })
        .expect(201);

      await w.as(other).get(w.auditPath).expect(404);
    });
  });

  describe('durability and immutability', () => {
    it('history survives deleting the project it describes', async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      await p.createTask('Fix login');

      // A project must be archived before it can be deleted permanently.
      await w.as(w.lead).post(`${p.projectPath}/archive`).expect(200);
      await w.as(w.lead).del(p.projectPath).expect(204);

      const res = await w.as(w.lead).get(w.auditPath).expect(200);
      const texts = messages(res);
      expect(texts.slice(0, 2)).toEqual([
        'Lena Lead deleted project “Apollo”',
        'Lena Lead archived project “Apollo”',
      ]);
      expect(texts).toContain('Lena Lead created task “Fix login”');
      expect(texts).toContain('Lena Lead created project “Apollo”');
    });

    it("stays attributable after the actor's account is deleted", async () => {
      const w = await world();
      const p = await w.makeProject('Apollo');
      const taskId = await p.createTask('Task');
      await w
        .as(w.member)
        .post(`${p.boardPath}/tasks/${taskId}/comments`)
        .send({ body: 'hi' })
        .expect(201);

      await prisma.user.delete({ where: { id: w.member.id } });

      const res = await w
        .as(w.lead)
        .get(w.auditPath)
        .query({ action: 'comment.created' })
        .expect(200);
      expect(res.body.items[0]).toMatchObject({
        actorId: null,
        actorName: 'Max Member',
      });
    });

    it('the database itself refuses to edit an entry', async () => {
      const w = await world();
      await w.makeProject('Apollo');
      const entry = await prisma.activityLog.findFirstOrThrow();

      await expect(
        prisma.$executeRaw`UPDATE activity_logs SET action = 'task.deleted' WHERE id = ${entry.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      expect(
        (
          await prisma.activityLog.findUniqueOrThrow({
            where: { id: entry.id },
          })
        ).action,
      ).toBe(entry.action);
    });
  });
});
