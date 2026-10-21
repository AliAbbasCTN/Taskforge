import { NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let realtime: { emitToUser: jest.Mock };
  let queue: { add: jest.Mock };
  let prisma: {
    user: { findUnique: jest.Mock };
    notification: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const me = 'user-me';
  const other = 'user-other';

  const input = (overrides = {}) => ({
    recipientId: other,
    actorId: me,
    type: NotificationType.TASK_ASSIGNED,
    projectId: 'project-1',
    boardId: 'board-1',
    taskId: 'task-1',
    subject: 'Fix login',
    ...overrides,
  });

  beforeEach(() => {
    realtime = { emitToUser: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue({}) };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Ada' }) },
      notification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
      queue as unknown as Queue,
    );
  });

  const jobData = (overrides = {}) => ({
    notificationId: 'notif-1',
    ...input(),
    ...overrides,
  });

  describe('notify (enqueue)', () => {
    it('adds a job to the queue - and does NOT write to the database itself', async () => {
      await service.notify(input());

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, data, options] = queue.add.mock.calls[0];
      expect(name).toBe('deliver-notification');
      expect(data).toMatchObject(input());
      // The id is chosen NOW, and doubles as the queue's own de-duplication key.
      expect(data.notificationId).toEqual(expect.any(String));
      expect(options).toEqual({ jobId: data.notificationId });
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('never queues a notification about your own action', async () => {
      await service.notify(input({ recipientId: me, actorId: me }));

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('falls back to INLINE delivery when the queue is unavailable (Redis down)', async () => {
      queue.add.mockRejectedValue(new Error('ECONNREFUSED'));
      const created = { id: 'n1' };
      prisma.notification.create.mockResolvedValue(created);

      await service.notify(input());

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        other,
        'notification:created',
        created,
      );
    });

    it('falls back too when the queue just never answers (bounded wait, not a hung request)', async () => {
      jest.useFakeTimers();
      try {
        queue.add.mockReturnValue(new Promise(() => undefined));
        prisma.notification.create.mockResolvedValue({ id: 'n1' });

        const pending = service.notify(input());
        await jest.advanceTimersByTimeAsync(2000);
        await pending;

        expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('never throws: if even the inline fallback fails it only logs', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      prisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.notify(input())).resolves.toBeUndefined();
    });
  });

  describe('deliver (what the worker runs)', () => {
    it('stores the notification under the id chosen at enqueue time, then pushes it live', async () => {
      const created = { id: 'notif-1', message: 'Ada assigned you "Fix login"' };
      prisma.notification.create.mockResolvedValue(created);

      await service.deliver(jobData());

      expect(prisma.notification.create.mock.calls[0][0].data).toEqual({
        id: 'notif-1',
        userId: other,
        actorId: me,
        type: NotificationType.TASK_ASSIGNED,
        message: 'Ada assigned you "Fix login"',
        projectId: 'project-1',
        boardId: 'board-1',
        taskId: 'task-1',
      });
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        other,
        'notification:created',
        created,
      );
    });

    it('is IDEMPOTENT: a retry of an already-created notification creates nothing new, and still pushes', async () => {
      prisma.notification.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const existing = { id: 'notif-1' };
      prisma.notification.findUniqueOrThrow.mockResolvedValue(existing);

      await expect(service.deliver(jobData())).resolves.toBeUndefined();

      expect(prisma.notification.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'notif-1' } }),
      );
      // The earlier attempt may have died before the live push, so push again.
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        other,
        'notification:created',
        existing,
      );
    });

    it('THROWS on any other failure, so the queue retries it - and pushes nothing', async () => {
      prisma.notification.create.mockRejectedValue(new Error('db timeout'));

      await expect(service.deliver(jobData())).rejects.toThrow('db timeout');
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('words the message without an actor name when the actor is unknown', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'n' });

      await service.deliver(jobData({ actorId: null }));

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.notification.create.mock.calls[0][0].data.message).toBe(
        'Someone assigned you "Fix login"',
      );
    });
  });

  describe('reading', () => {
    const query = (overrides: Partial<ListNotificationsQueryDto> = {}) =>
      Object.assign(new ListNotificationsQueryDto(), overrides);

    it('only ever lists the requester\'s own notifications', async () => {
      await service.list(me, query());

      expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
        userId: me,
      });
      expect(prisma.notification.count.mock.calls[0][0].where).toEqual({
        userId: me,
      });
    });

    it('narrows to unread when asked, and pages', async () => {
      prisma.notification.count.mockResolvedValue(25);

      const result = await service.list(
        me,
        query({ unread: true, page: 2, pageSize: 10 }),
      );

      const args = prisma.notification.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ userId: me, readAt: null });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(result.totalPages).toBe(3);
    });

    it('counts unread for the badge, scoped to the requester', async () => {
      prisma.notification.count.mockResolvedValue(4);

      await expect(service.unreadCount(me)).resolves.toEqual({ count: 4 });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: me, readAt: null },
      });
    });
  });

  describe('marking read', () => {
    it('404s for a notification that belongs to someone else (or does not exist)', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead(me, 'n-foreign')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n-foreign', userId: me },
      });
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('stamps readAt on an unread notification', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', readAt: null });
      prisma.notification.update.mockResolvedValue({ id: 'n1' });

      await service.markRead(me, 'n1');

      const { data } = prisma.notification.update.mock.calls[0][0];
      expect(data.readAt).toBeInstanceOf(Date);
    });

    it('leaves an already-read notification untouched (idempotent)', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'n1',
        readAt: new Date(),
      });
      prisma.notification.findUniqueOrThrow.mockResolvedValue({ id: 'n1' });

      await service.markRead(me, 'n1');

      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('marks only the requester\'s own unread notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.markAllRead(me)).resolves.toEqual({ updated: 3 });
      expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({
        userId: me,
        readAt: null,
      });
    });
  });
});
