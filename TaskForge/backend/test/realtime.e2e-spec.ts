import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';

/**
 * REAL-TIME end-to-end tests. Unlike the HTTP e2e file, this boots an app that
 * actually LISTENS on a port, and connects genuine Socket.IO clients to it -
 * the only honest way to test "does my teammate's change reach my screen, and
 * does a removed member stop receiving it?". (jest-e2e.json runs e2e files one
 * at a time, because both files share one database.)
 */
// Each test builds a small world over real HTTP and bcrypt-hashes several
// passwords, so give them more than Jest's default 5 seconds.
jest.setTimeout(30_000);

describe('Realtime (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const openSockets: Socket[] = [];

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createAppValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
  });

  const wipe = async () => {
    await prisma.notification.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.taskLabel.deleteMany();
    await prisma.label.deleteMany();
    await prisma.task.deleteMany();
    await prisma.boardColumn.deleteMany();
    await prisma.board.deleteMany();
    await prisma.projectMembership.deleteMany();
    await prisma.project.deleteMany();
    await prisma.teamMembership.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.team.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  };

  beforeEach(wipe);

  afterEach(() => {
    openSockets.splice(0).forEach((socket) => socket.close());
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  // ------------------------------------------------------------------ socket helpers

  /** Opens a socket; resolves once connected, rejects if the server refuses. */
  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      openSockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (error) => reject(error));
    });
  }

  /** Resolves with the next payload of `event`, or rejects after `ms`. */
  function waitFor<T = any>(
    socket: Socket,
    event: string,
    ms = 2000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`Timed out waiting for "${event}"`));
      }, ms);
      const handler = (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      };
      socket.once(event, handler);
    });
  }

  /**
   * Resolves with the next `project:changed` event for `resource`, ignoring
   * others. Matching on the resource avoids a race: an earlier write's event
   * can still be in flight when the next wait begins.
   */
  function waitForChange(socket: Socket, resource: string, ms = 2000) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('project:changed', handler);
        reject(new Error(`Timed out waiting for a "${resource}" change`));
      }, ms);
      const handler = (payload: { resource: string }) => {
        if (payload.resource === resource) {
          clearTimeout(timer);
          socket.off('project:changed', handler);
          resolve(payload);
        }
      };
      socket.on('project:changed', handler);
    });
  }

  /** Asserts that `event` does NOT arrive within `ms`. */
  async function expectNoEvent(socket: Socket, event: string, ms = 500) {
    const received: unknown[] = [];
    const handler = (payload: unknown) => received.push(payload);
    socket.on(event, handler);
    await new Promise((resolve) => setTimeout(resolve, ms));
    socket.off(event, handler);
    expect(received).toEqual([]);
  }

  const join = (socket: Socket, projectId: unknown) =>
    socket.emitWithAck('project:join', { projectId });

  // ------------------------------------------------------------------ HTTP helpers

  async function register(email: string, name: string) {
    const res = await api()
      .post('/auth/register')
      .send({ email, name, password: 'password1' })
      .expect(201);
    return {
      id: res.body.user.id as string,
      email,
      token: res.body.tokens.accessToken as string,
    };
  }

  /**
   * An organization with: an ADMIN (founder), a project LEAD, a project MEMBER
   * and a STRANGER (org member who is NOT on the private project). The lead
   * created the project and one board.
   */
  async function world() {
    const admin = await register('admin@example.com', 'Alice Admin');
    const lead = await register('lead@example.com', 'Lena Lead');
    const member = await register('member@example.com', 'Max Member');
    const stranger = await register('stranger@example.com', 'Sam Stranger');

    const org = await api()
      .post('/organizations')
      .set('Authorization', bearer(admin.token))
      .send({ name: 'Org' })
      .expect(201);
    const orgId = org.body.id as string;
    for (const user of [lead, member, stranger]) {
      await api()
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', bearer(admin.token))
        .send({ email: user.email })
        .expect(201);
    }

    const projectId = (
      await api()
        .post(`/organizations/${orgId}/projects`)
        .set('Authorization', bearer(lead.token))
        .send({ name: 'Apollo' })
        .expect(201)
    ).body.id as string;
    await api()
      .post(`/organizations/${orgId}/projects/${projectId}/members`)
      .set('Authorization', bearer(lead.token))
      .send({ email: member.email })
      .expect(201);

    const board = (
      await api()
        .post(`/organizations/${orgId}/projects/${projectId}/boards`)
        .set('Authorization', bearer(lead.token))
        .send({ name: 'Sprint' })
        .expect(201)
    ).body;

      await prisma.notification.deleteMany();

    return {
      admin,
      lead,
      member,
      stranger,
      orgId,
      projectId,
      boardId: board.id as string,
      columnId: board.columns[0].id as string,
      projectUrl: `/organizations/${orgId}/projects/${projectId}`,
    };
  }

  const createTask = (
    w: Awaited<ReturnType<typeof world>>,
    token: string,
    body: object,
  ) =>
    api()
      .post(`${w.projectUrl}/boards/${w.boardId}/tasks`)
      .set('Authorization', bearer(token))
      .send({ columnId: w.columnId, title: 'A task', ...body });

  // ------------------------------------------------------------------ connection

  describe('connecting', () => {
    it('refuses a connection with no token, or a forged one, saying only "unauthorized"', async () => {
      await expect(connect(undefined)).rejects.toMatchObject({
        message: 'unauthorized',
      });
      await expect(connect('not.a.jwt')).rejects.toMatchObject({
        message: 'unauthorized',
      });
    });

    it('accepts a valid access token', async () => {
      const user = await register('ada@example.com', 'Ada');

      const socket = await connect(user.token);

      expect(socket.connected).toBe(true);
    });
  });

  describe('joining a project room', () => {
    it('admits project members and org-wide oversight, and refuses everyone else with the same answer', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      const admin = await connect(w.admin.token);
      const stranger = await connect(w.stranger.token);

      expect(await join(member, w.projectId)).toEqual({ ok: true });
      // An org ADMIN oversees every project without being on it.
      expect(await join(admin, w.projectId)).toEqual({ ok: true });

      // A plain org member who isn't on the private project...
      const denied = await join(stranger, w.projectId);
      expect(denied).toEqual({ ok: false, error: 'Project not found' });
      // ...gets exactly the same answer as for a project that doesn't exist...
      expect(
        await join(stranger, '11111111-1111-4111-8111-111111111111'),
      ).toEqual(denied);
      // ...or garbage.
      expect(await join(stranger, 'not-a-uuid')).toEqual(denied);
      expect(await join(stranger, 42)).toEqual(denied);
    });
  });

  // ------------------------------------------------------------------ live updates

  describe('live project updates', () => {
    it('tells everyone watching, with IDS ONLY - no titles or content', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      await join(member, w.projectId);

      const arrived = waitForChange(member, 'tasks');
      const created = await createTask(w, w.lead.token, {
        title: 'Top secret launch plan',
      }).expect(201);
      const event = await arrived;

      expect(event).toEqual({
        resource: 'tasks',
        projectId: w.projectId,
        boardId: w.boardId,
        actorId: w.lead.id,
        at: expect.any(String),
        taskId: undefined,
      });
      // POST /tasks has no :taskId in its URL; an edit does:
      const edited = waitForChange(member, 'tasks');
      await api()
        .patch(`${w.projectUrl}/boards/${w.boardId}/tasks/${created.body.id}`)
        .set('Authorization', bearer(w.lead.token))
        .send({ priority: 'HIGH' })
        .expect(200);
      expect(await edited).toMatchObject({
        resource: 'tasks',
        taskId: created.body.id,
      });
      expect(JSON.stringify(event)).not.toContain('Top secret');
    });

    it('announces each kind of change under its own resource name', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      await join(member, w.projectId);
      const task = (await createTask(w, w.lead.token, {}).expect(201)).body;

      const comment = waitForChange(member, 'comments');
      await api()
        .post(`${w.projectUrl}/boards/${w.boardId}/tasks/${task.id}/comments`)
        .set('Authorization', bearer(w.lead.token))
        .send({ body: 'hello' })
        .expect(201);
      expect((await comment).resource).toBe('comments');

      const label = waitForChange(member, 'labels');
      await api()
        .post(`${w.projectUrl}/labels`)
        .set('Authorization', bearer(w.lead.token))
        .send({ name: 'Bug', color: '#d92d20' })
        .expect(201);
      expect((await label).resource).toBe('labels');

      const column = waitForChange(member, 'columns');
      await api()
        .post(`${w.projectUrl}/boards/${w.boardId}/columns`)
        .set('Authorization', bearer(w.lead.token))
        .send({ name: 'Review' })
        .expect(201);
      expect((await column).resource).toBe('columns');

      const project = waitForChange(member, 'project');
      await api()
        .patch(w.projectUrl)
        .set('Authorization', bearer(w.lead.token))
        .send({ description: 'New description' })
        .expect(200);
      expect((await project).resource).toBe('project');
    });

    it('delivers nothing to a socket that was refused entry', async () => {
      const w = await world();
      const stranger = await connect(w.stranger.token);
      await join(stranger, w.projectId); // refused

      await createTask(w, w.lead.token, {}).expect(201);

      await expectNoEvent(stranger, 'project:changed');
    });

    it('delivers nothing from a project you are not watching', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      await join(member, w.projectId);

      // The lead creates a SECOND project (member is not on it) and writes there.
      const other = (
        await api()
          .post(`/organizations/${w.orgId}/projects`)
          .set('Authorization', bearer(w.lead.token))
          .send({ name: 'Secret other project' })
          .expect(201)
      ).body.id;
      await api()
        .post(`/organizations/${w.orgId}/projects/${other}/boards`)
        .set('Authorization', bearer(w.lead.token))
        .send({ name: 'Hidden board' })
        .expect(201);

      await expectNoEvent(member, 'project:changed');
    });

    it('announces nothing for a write that was refused', async () => {
      const w = await world();
      const watcher = await connect(w.lead.token);
      await join(watcher, w.projectId);

      // A plain project MEMBER may not create boards: 403, so nothing changed.
      await api()
        .post(`${w.projectUrl}/boards`)
        .set('Authorization', bearer(w.member.token))
        .send({ name: 'Nope' })
        .expect(403);

      await expectNoEvent(watcher, 'project:changed');
    });
  });

  // ------------------------------------------------------------------ losing access

  describe('losing access while connected', () => {
    it('cuts off a member removed from the project - before the removal response returns', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      await join(member, w.projectId);

      await api()
        .delete(`${w.projectUrl}/members/${w.member.id}`)
        .set('Authorization', bearer(w.lead.token))
        .expect(204);

      // Their socket is still CONNECTED, but no longer in the room.
      expect(member.connected).toBe(true);
      await createTask(w, w.lead.token, {}).expect(201);
      await expectNoEvent(member, 'project:changed');
      expect(await join(member, w.projectId)).toEqual({
        ok: false,
        error: 'Project not found',
      });
    });

    it('cuts off a member removed from the whole organization', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      await join(member, w.projectId);

      await api()
        .delete(`/organizations/${w.orgId}/members/${w.member.id}`)
        .set('Authorization', bearer(w.admin.token))
        .expect(204);

      await createTask(w, w.lead.token, {}).expect(201);
      await expectNoEvent(member, 'project:changed');
    });

    it('cuts off a manager who is demoted and so loses organization-wide oversight', async () => {
      const w = await world();
      const members = `/organizations/${w.orgId}/members/${w.stranger.id}`;
      await api()
        .patch(members)
        .set('Authorization', bearer(w.admin.token))
        .send({ role: 'MANAGER' })
        .expect(200);
      const stranger = await connect(w.stranger.token);
      expect(await join(stranger, w.projectId)).toEqual({ ok: true });

      await api()
        .patch(members)
        .set('Authorization', bearer(w.admin.token))
        .send({ role: 'MEMBER' })
        .expect(200);

      await createTask(w, w.lead.token, {}).expect(201);
      await expectNoEvent(stranger, 'project:changed');
    });

    it("closes all of a user's connections when they log out", async () => {
      const w = await world();
      const tab1 = await connect(w.member.token);
      const tab2 = await connect(w.member.token);
      const closed = Promise.all([
        waitFor(tab1, 'disconnect'),
        waitFor(tab2, 'disconnect'),
      ]);

      await api()
        .post('/auth/logout')
        .set('Authorization', bearer(w.member.token))
        .expect(204);

      await closed;
      expect(tab1.connected).toBe(false);
      expect(tab2.connected).toBe(false);
    });
  });

  // ------------------------------------------------------------------ notifications

  describe('notifications', () => {
    const unreadCount = async (token: string) =>
      (
        await api()
          .get('/notifications/unread-count')
          .set('Authorization', bearer(token))
          .expect(200)
      ).body.count as number;

    it('requires authentication', async () => {
      await api().get('/notifications').expect(401);
      await api().get('/notifications/unread-count').expect(401);
      await api().post('/notifications/read-all').expect(401);
    });

    it('stores a notification AND pushes it live when you are assigned a task', async () => {
      const w = await world();
      const member = await connect(w.member.token);
      const arrived = waitFor(member, 'notification:created');

      await createTask(w, w.lead.token, {
        title: 'Fix login',
        assigneeId: w.member.id,
      }).expect(201);
      const pushed = await arrived;

      expect(pushed).toMatchObject({
        type: 'TASK_ASSIGNED',
        message: 'Lena Lead assigned you "Fix login"',
        projectId: w.projectId,
        boardId: w.boardId,
        readAt: null,
        project: { organizationId: w.orgId, name: 'Apollo' },
      });
      expect(JSON.stringify(pushed)).not.toContain('passwordHash');

      // It is durable: the same notification is in the inbox over plain HTTP.
      expect(await unreadCount(w.member.token)).toBe(1);
      const inbox = await api()
        .get('/notifications')
        .set('Authorization', bearer(w.member.token))
        .expect(200);
      expect(inbox.body.total).toBe(1);
      expect(inbox.body.items[0].id).toBe(pushed.id);
    });

    it('works for an offline user too: it is waiting in the inbox', async () => {
      const w = await world(); // nobody is connected

      await createTask(w, w.lead.token, { assigneeId: w.member.id }).expect(
        201,
      );

      expect(await unreadCount(w.member.token)).toBe(1);
    });

    it('never notifies you about your own actions', async () => {
      const w = await world();
      const lead = await connect(w.lead.token);

      await createTask(w, w.lead.token, { assigneeId: w.lead.id }).expect(201);

      await expectNoEvent(lead, 'notification:created');
      expect(await unreadCount(w.lead.token)).toBe(0);
    });

    it('notifies only when the assignee actually CHANGES', async () => {
      const w = await world();
      const task = (
        await createTask(w, w.lead.token, { assigneeId: w.member.id }).expect(
          201,
        )
      ).body;
      const url = `${w.projectUrl}/boards/${w.boardId}/tasks/${task.id}`;

      // Re-saving the same assignee, or editing something else, is not news.
      await api()
        .patch(url)
        .set('Authorization', bearer(w.lead.token))
        .send({ assigneeId: w.member.id, priority: 'HIGH' })
        .expect(200);
      expect(await unreadCount(w.member.token)).toBe(1);

      // Clearing it isn't either.
      await api()
        .patch(url)
        .set('Authorization', bearer(w.lead.token))
        .send({ assigneeId: null })
        .expect(200);
      expect(await unreadCount(w.member.token)).toBe(1);
    });

    it('notifies the assignee about comments (but not the commenter themself)', async () => {
      const w = await world();
      const task = (
        await createTask(w, w.lead.token, { assigneeId: w.member.id }).expect(
          201,
        )
      ).body;
      const commentsUrl = `${w.projectUrl}/boards/${w.boardId}/tasks/${task.id}/comments`;

      await api()
        .post(commentsUrl)
        .set('Authorization', bearer(w.lead.token))
        .send({ body: 'Any update?' })
        .expect(201);
      // The assignee commenting on their own task tells no one new.
      await api()
        .post(commentsUrl)
        .set('Authorization', bearer(w.member.token))
        .send({ body: 'On it' })
        .expect(201);

      // Assigned + commented = 2 for the member; the lead hears nothing.
      expect(await unreadCount(w.member.token)).toBe(2);
      expect(await unreadCount(w.lead.token)).toBe(0);
      const inbox = await api()
        .get('/notifications')
        .set('Authorization', bearer(w.member.token))
        .expect(200);
      expect(
        inbox.body.items.map((n: { type: string }) => n.type).sort(),
      ).toEqual(['COMMENT_ADDED', 'TASK_ASSIGNED']);
    });

    it('tells someone when they are added to a project', async () => {
      const w = await world();
      const stranger = await connect(w.stranger.token);
      const arrived = waitFor(stranger, 'notification:created');

      await api()
        .post(`${w.projectUrl}/members`)
        .set('Authorization', bearer(w.lead.token))
        .send({ email: w.stranger.email })
        .expect(201);

      expect(await arrived).toMatchObject({
        type: 'ADDED_TO_PROJECT',
        message: 'Lena Lead added you to the project "Apollo"',
      });
    });

    it('marks read, one at a time and all at once - but only YOUR notifications', async () => {
      const w = await world();
      for (const title of ['One', 'Two', 'Three']) {
        await createTask(w, w.lead.token, {
          title,
          assigneeId: w.member.id,
        }).expect(201);
      }
      const inbox = await api()
        .get('/notifications')
        .set('Authorization', bearer(w.member.token))
        .expect(200);
      const [first] = inbox.body.items as { id: string }[];

      // Someone else cannot touch it (404, not 403: it is not theirs to know).
      await api()
        .post(`/notifications/${first.id}/read`)
        .set('Authorization', bearer(w.lead.token))
        .expect(404);
      expect(await unreadCount(w.member.token)).toBe(3);

      const read = await api()
        .post(`/notifications/${first.id}/read`)
        .set('Authorization', bearer(w.member.token))
        .expect(200);
      expect(read.body.readAt).toEqual(expect.any(String));
      expect(await unreadCount(w.member.token)).toBe(2);

      const all = await api()
        .post('/notifications/read-all')
        .set('Authorization', bearer(w.member.token))
        .expect(200);
      expect(all.body).toEqual({ updated: 2 });
      expect(await unreadCount(w.member.token)).toBe(0);
    });

    it('pages and filters the inbox, and treats unread=false as NO filter', async () => {
      const w = await world();
      for (const title of ['One', 'Two', 'Three']) {
        await createTask(w, w.lead.token, {
          title,
          assigneeId: w.member.id,
        }).expect(201);
      }
      const list = (query: string) =>
        api()
          .get(`/notifications?${query}`)
          .set('Authorization', bearer(w.member.token));

      const page = (await list('pageSize=2&page=2').expect(200)).body;
      expect(page).toMatchObject({
        total: 3,
        page: 2,
        pageSize: 2,
        totalPages: 2,
      });
      expect(page.items).toHaveLength(1);

      const first = (await list('pageSize=1').expect(200)).body.items[0];
      await api()
        .post(`/notifications/${first.id}/read`)
        .set('Authorization', bearer(w.member.token))
        .expect(200);
      expect((await list('unread=true').expect(200)).body.total).toBe(2);
      expect((await list('unread=false').expect(200)).body.total).toBe(3);

      await list('pageSize=101').expect(400);
      await list('unread=maybe').expect(400);
    });

    it("never shows you anyone else's notifications", async () => {
      const w = await world();
      await createTask(w, w.lead.token, { assigneeId: w.member.id }).expect(
        201,
      );

      const theirs = await api()
        .get('/notifications')
        .set('Authorization', bearer(w.stranger.token))
        .expect(200);

      expect(theirs.body.total).toBe(0);
    });
  });
});
