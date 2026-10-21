import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { NotificationsService } from '../src/notifications/notifications.service';
import {
  eventually,
  maintenanceQueue,
  notificationsQueue,
  settleNotifications,
} from './helpers/queues';

/**
 * BACKGROUND JOB end-to-end tests - they need a real Redis (docker compose up -d).
 *
 * The queue and its worker run inside the app under test, exactly as in
 * production, so these tests exercise the real thing: a request adds a job,
 * a worker takes it, retries on failure, and degrades when Redis is down.
 */
describe('Background jobs (e2e)', () => {
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
    // Forget any jobs a previous (possibly crashed) run left behind.
    await notificationsQueue(app).drain(true);
    await wipe();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (!app || !prisma) {
      return;
    }
    await settleNotifications(app);
    await wipe();
    await app.close();
  });

  async function register(email: string, name: string) {
    const res = await api()
      .post('/auth/register')
      .send({ email, name, password: 'password1' })
      .expect(201);
    return { id: res.body.user.id as string, email, token: res.body.tokens.accessToken as string };
  }

  /** A lead who owns a project with one member and one board; inboxes start empty. */
  async function world() {
    const lead = await register('lead@example.com', 'Lena Lead');
    const member = await register('member@example.com', 'Max Member');
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

    await settleNotifications(app); // the "added to project" job
    await prisma.notification.deleteMany();

    const assignTask = (title = 'Fix login') =>
      api()
        .post(`/organizations/${orgId}/projects/${projectId}/boards/${board.id}/tasks`)
        .set('Authorization', bearer(lead.token))
        .send({ columnId: board.columns[0].id, title, assigneeId: member.id })
        .expect(201);

    return { lead, member, orgId, projectId, boardId: board.id as string, assignTask };
  }

  describe('notification delivery', () => {
    it('is delivered by a worker through the queue', async () => {
      const w = await world();

      await w.assignTask();
      await settleNotifications(app);

      const rows = await prisma.notification.findMany({
        where: { userId: w.member.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Lena Lead assigned you "Fix login"');
    });

    it('RETRIES a failed delivery with backoff, and still creates it exactly once', async () => {
      const w = await world();
      const deliver = jest
        .spyOn(app.get(NotificationsService), 'deliver')
        .mockRejectedValueOnce(new Error('transient database failure'));

      await w.assignTask();
      await settleNotifications(app); // waits out the ~1s backoff

      expect(deliver.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(
        await prisma.notification.count({ where: { userId: w.member.id } }),
      ).toBe(1);
    });

    it('is IDEMPOTENT: delivering the same job twice creates one notification', async () => {
      const w = await world();
      const service = app.get(NotificationsService);
      const job = {
        notificationId: '11111111-1111-4111-8111-111111111111',
        recipientId: w.member.id,
        actorId: w.lead.id,
        type: 'TASK_ASSIGNED' as const,
        projectId: w.projectId,
        boardId: w.boardId,
        subject: 'Same job, twice',
      };

      await service.deliver(job);
      await service.deliver(job); // a retry after a worker crash

      expect(
        await prisma.notification.count({ where: { userId: w.member.id } }),
      ).toBe(1);
    });

    it('DEGRADES instead of failing when Redis is unreachable: delivers inline', async () => {
      const w = await world();
      jest
        .spyOn(notificationsQueue(app), 'add')
        .mockRejectedValue(new Error('Redis is down'));

      await w.assignTask(); // the assignment itself must still succeed...

      // ...and the notification already exists - no worker involved.
      expect(
        await prisma.notification.count({ where: { userId: w.member.id } }),
      ).toBe(1);
    });
  });

  describe('maintenance', () => {
    it('purges notifications read more than 90 days ago, keeping recent and unread ones', async () => {
      const w = await world();
      const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
      const make = (message: string, readAt: Date | null, createdAt: Date) =>
        prisma.notification.create({
          data: {
            userId: w.member.id,
            type: 'TASK_ASSIGNED',
            message,
            projectId: w.projectId,
            readAt,
            createdAt,
          },
        });
      await make('old and read', days(100), days(120));
      await make('recent and read', days(1), days(2));
      await make('old but UNREAD', null, days(200));

      await maintenanceQueue(app).add('purge-old-notifications', {});

      await eventually(async () => {
        const remaining = await prisma.notification.findMany({
          orderBy: { createdAt: 'asc' },
        });
        expect(remaining.map((n) => n.message)).toEqual([
          'old but UNREAD',
          'recent and read',
        ]);
      });
    });

    it('has each nightly job scheduled exactly once, however many times the app has started', async () => {
      const schedulers = await maintenanceQueue(app).getJobSchedulers();

      // The notification purge (03:00) and the orphaned-file sweep (03:30).
      expect(schedulers.map((s) => s.pattern).sort()).toEqual([
        '0 3 * * *',
        '30 3 * * *',
      ]);
    });
  });

  describe('monitoring', () => {
    it('/health reports Redis and the queue counts', async () => {
      const res = await api().get('/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.dependencies).toEqual({ database: 'up', redis: 'up' });
      expect(res.body.queues.notifications).toEqual({
        waiting: expect.any(Number),
        active: expect.any(Number),
        delayed: expect.any(Number),
        failed: expect.any(Number),
      });
      expect(res.body.queues.maintenance).toBeDefined();
    });
  });
});
