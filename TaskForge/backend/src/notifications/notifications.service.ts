import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPaginated, toSkipTake } from '../common/pagination/pagination';
import { RealtimeService } from '../realtime/realtime.service';
import { NOTIFICATION_CREATED } from '../realtime/realtime.events';
import { SAFE_USER_SELECT } from '../users/users.service';
import { buildNotificationMessage } from './notification-message';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/** A notification comes back with who caused it and where (project name, and
 * the organization id the UI needs to build a link). */
const NOTIFICATION_INCLUDE = {
  actor: { select: SAFE_USER_SELECT },
  project: { select: { id: true, name: true, organizationId: true } },
} satisfies Prisma.NotificationInclude;

export interface NotifyInput {
  recipientId: string;
  /** Who caused it. If it equals the recipient, nothing is sent. */
  actorId: string | null;
  type: NotificationType;
  projectId: string;
  boardId?: string;
  taskId?: string;
  /** The task title or project name the sentence is about. */
  subject: string;
}

/**
 * WHAT: Creating, reading and clearing a user's notifications.
 *
 * THE FLOW when something notifiable happens:
 *   1. a row is written to the `notifications` table (durable - this IS the
 *      notification, and survives reloads, offline users, and sockets
 *      dropping), then
 *   2. a `notification:created` event is pushed to the recipient's `user:<id>`
 *      room as a live HINT that the badge should update.
 * The socket is an optimisation, never the source of truth: a user who was
 * offline still finds the row waiting when they next load the page.
 *
 * `notify()` is BEST-EFFORT: it never throws. Assigning a task is the real
 * operation; failing to tell someone about it must not undo or fail it. (The
 * stronger approach - guaranteeing the notification is created exactly once
 * even if the server crashes mid-request - is a background job with retries,
 * which is what Phase 12 (BullMQ) is for.)
 *
 * Every read is scoped to `userId` (`WHERE user_id = <requester>`), so you can
 * only ever see or change YOUR notifications; someone else's id is a 404.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    // Telling people about their OWN actions is noise.
    if (input.actorId && input.recipientId === input.actorId) {
      return;
    }

    try {
      const actor = input.actorId
        ? await this.prisma.user.findUnique({
            where: { id: input.actorId },
            select: { name: true },
          })
        : null;

      const notification = await this.prisma.notification.create({
        data: {
          userId: input.recipientId,
          actorId: input.actorId,
          type: input.type,
          message: buildNotificationMessage(
            input.type,
            actor?.name ?? null,
            input.subject,
          ),
          projectId: input.projectId,
          boardId: input.boardId,
          taskId: input.taskId,
        },
        include: NOTIFICATION_INCLUDE,
      });

      this.realtime.emitToUser(
        input.recipientId,
        NOTIFICATION_CREATED,
        notification,
      );
    } catch (error) {
      this.logger.warn(`Could not create notification: ${String(error)}`);
    }
  }

  async list(userId: string, query: ListNotificationsQueryDto) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        // `id` as a tie-breaker keeps paging stable for equal timestamps.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(query.page, query.pageSize),
        include: NOTIFICATION_INCLUDE,
      }),
    ]);

    return toPaginated(items, total, query.page, query.pageSize);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Notification not found');
    }
    if (existing.readAt) {
      return this.prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
        include: NOTIFICATION_INCLUDE,
      });
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
      include: NOTIFICATION_INCLUDE,
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
