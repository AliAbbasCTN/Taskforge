import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPaginated, toSkipTake } from '../common/pagination/pagination';
import { withTimeout } from '../common/utils/with-timeout';
import {
  DELIVER_NOTIFICATION_JOB,
  ENQUEUE_TIMEOUT_MS,
  NOTIFICATIONS_QUEUE,
} from '../queues/queues.constants';
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
 * What travels through the queue: the request, plus an id chosen NOW (at
 * enqueue time) for the notification that will be created. Deciding the id up
 * front is what makes delivery safe to retry - see `deliver()`.
 */
export interface NotificationJobData extends NotifyInput {
  notificationId: string;
}

/**
 * WHAT: Creating, reading and clearing a user's notifications.
 *
 * HOW A NOTIFICATION IS CREATED (changed in Phase 12):
 *
 *   request  -> notify() -> adds a JOB to the Redis queue -> returns at once
 *                                  |
 *   worker   <- takes the job -----+
 *   worker   -> deliver(): write the `notifications` row, then push
 *               `notification:created` to the recipient's socket room
 *
 * In Phase 11 this all happened inside the request. Moving it to a queue gives
 * three things: the request returns faster; a failed delivery is RETRIED with
 * backoff instead of lost; and the work no longer depends on the process that
 * handled the request staying alive.
 *
 * AT-LEAST-ONCE DELIVERY AND IDEMPOTENCY: a queue cannot promise a job runs
 * exactly once. If a worker crashes after doing the work but before telling
 * Redis, the job is retried - so it can run twice. The practical answer is not
 * to chase "exactly once" but to make running twice harmless: an IDEMPOTENT
 * operation. `deliver()` is idempotent because the notification's id is chosen
 * at enqueue time and used as the row's primary key - a second attempt finds
 * the row already there and creates nothing new.
 *
 * Every READ is scoped to `userId` (`WHERE user_id = <requester>`), so you can
 * only ever see or change YOUR notifications; someone else's id is a 404.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Asks for a notification to be created. Never throws: failing to tell
   * someone must not undo or fail the real operation (the assignment, the
   * comment) that triggered it.
   *
   * GRACEFUL DEGRADATION: if Redis is unreachable the job cannot be queued, so
   * the notification is delivered INLINE, exactly as in Phase 11. The feature
   * gets slower and loses its retries, but keeps working - a Redis outage
   * degrades the app instead of breaking it.
   *
   * KNOWN LIMIT (the "dual-write problem"): the assignment is saved to
   * PostgreSQL, THEN the job is added to Redis - two systems, no shared
   * transaction. If the server dies in the gap, the task is assigned but no job
   * exists, and the notification is silently lost. The textbook fix is the
   * TRANSACTIONAL OUTBOX: write the "to notify" record in the SAME database
   * transaction as the assignment, and have a worker forward outbox rows to the
   * queue. Not built here (it would touch every call site); see
   * docs/phase-12-concepts.md.
   */
  async notify(input: NotifyInput): Promise<void> {
    // Telling people about their OWN actions is noise.
    if (input.actorId && input.recipientId === input.actorId) {
      return;
    }

    const data: NotificationJobData = { ...input, notificationId: randomUUID() };

    try {
      await withTimeout(
        // `jobId` makes the queue itself refuse a duplicate of the same id.
        this.queue.add(DELIVER_NOTIFICATION_JOB, data, {
          jobId: data.notificationId,
        }),
        ENQUEUE_TIMEOUT_MS,
        'Enqueueing notification',
      );
    } catch (error) {
      this.logger.warn(
        `Queue unavailable (${String(error)}); delivering notification inline`,
      );
      try {
        await this.deliver(data);
      } catch (inlineError) {
        this.logger.warn(`Inline delivery failed: ${String(inlineError)}`);
      }
    }
  }

  /**
   * Does the actual work: stores the notification and pushes it live. Called by
   * the queue worker (with retries) and by the inline fallback above.
   *
   * It THROWS on failure, on purpose - that is how the queue knows to retry.
   * It is IDEMPOTENT (see the class comment): safe to call again for the same
   * `notificationId`, including after a timed-out enqueue that actually
   * succeeded, which can produce both a queued job and an inline delivery.
   */
  async deliver(data: NotificationJobData): Promise<void> {
    const actor = data.actorId
      ? await this.prisma.user.findUnique({
          where: { id: data.actorId },
          select: { name: true },
        })
      : null;

    let notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          id: data.notificationId,
          userId: data.recipientId,
          actorId: data.actorId,
          type: data.type,
          message: buildNotificationMessage(
            data.type,
            actor?.name ?? null,
            data.subject,
          ),
          projectId: data.projectId,
          boardId: data.boardId,
          taskId: data.taskId,
        },
        include: NOTIFICATION_INCLUDE,
      });
    } catch (error) {
      // P2002 = unique constraint: this id already exists, so an earlier
      // attempt created the row. That attempt may have died before pushing
      // the live event, so load it and push (a duplicate push is harmless:
      // the client just refetches).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        notification = await this.prisma.notification.findUniqueOrThrow({
          where: { id: data.notificationId },
          include: NOTIFICATION_INCLUDE,
        });
      } else {
        throw error;
      }
    }

    this.realtime.emitToUser(
      data.recipientId,
      NOTIFICATION_CREATED,
      notification,
    );
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
