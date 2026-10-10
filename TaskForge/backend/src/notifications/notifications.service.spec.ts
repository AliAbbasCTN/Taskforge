import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let realtime: { emitToUser: jest.Mock };
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
    );
  });

  describe('notify', () => {
    it("stores the notification, then pushes it to the recipient's user room", async () => {
      const created = { id: 'n1', message: 'Ada assigned you "Fix login"' };
      prisma.notification.create.mockResolvedValue(created);

      await service.notify(input());

      expect(prisma.notification.create.mock.calls[0][0].data).toEqual({
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

    it('never notifies you about your own action', async () => {
      await service.notify(input({ recipientId: me, actorId: me }));

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('words the message without an actor name when the actor is unknown', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'n1' });

      await service.notify(input({ actorId: null }));

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.notification.create.mock.calls[0][0].data.message).toBe(
        'Someone assigned you "Fix login"',
      );
    });

    it('is best-effort: a failure is swallowed so it cannot fail the real operation', async () => {
      prisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.notify(input())).resolves.toBeUndefined();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });
  });

  describe('reading', () => {
    const query = (overrides: Partial<ListNotificationsQueryDto> = {}) =>
      Object.assign(new ListNotificationsQueryDto(), overrides);

    it("only ever lists the requester's own notifications", async () => {
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
      prisma.notification.findFirst.mockResolvedValue({
        id: 'n1',
        readAt: null,
      });
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

    it("marks only the requester's own unread notifications as read", async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.markAllRead(me)).resolves.toEqual({ updated: 3 });
      expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({
        userId: me,
        readAt: null,
      });
    });
  });
});
