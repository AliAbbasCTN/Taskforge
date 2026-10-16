import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { NOTIFICATIONS_QUEUE } from '../queues/queues.constants';
import {
  NotificationJobData,
  NotificationsService,
} from './notifications.service';

/**
 * WHAT: The WORKER for the `notifications` queue - the consumer side. BullMQ
 * calls `process()` for each job; if it returns, the job is done; if it
 * throws, the job is retried according to the queue's retry policy.
 *
 * `concurrency: 5` lets one process work on five notifications at once (they
 * mostly wait on the database, so this is cheap parallelism).
 *
 * Workers run inside this same NestJS process today. They don't have to: the
 * identical class could run in a separate "worker" process (same code, started
 * without the HTTP server) so that heavy jobs can't slow down requests. Both
 * would read from the same Redis queue - that decoupling is the point of using
 * a queue.
 */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    try {
      await this.notifications.deliver(job.data);
    } catch (error) {
      // P2003 = a foreign key points at something that no longer exists: the
      // recipient's account or the project was deleted after the job was
      // queued. Retrying can never fix that, so say so - UnrecoverableError
      // tells BullMQ to stop retrying immediately.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new UnrecoverableError(
          'The notification recipient or project no longer exists',
        );
      }
      throw error; // anything else: let the retry policy handle it
    }
  }

  /**
   * MONITORING HOOK: runs on every failed attempt. Intermediate failures are
   * warnings (a retry is coming); the final one - retries exhausted, or an
   * unrecoverable error - is an ERROR, because at that point a person must
   * look at it. The job stays in Redis for a week for exactly that.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined, error: Error): void {
    if (!job) {
      this.logger.error(`A notification job failed: ${error.message}`);
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    const exhausted =
      error instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;

    const summary = `Notification job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`;
    if (exhausted) {
      this.logger.error(`${summary} - GIVING UP; kept in the failed set`);
    } else {
      this.logger.warn(`${summary} - will retry`);
    }
  }
}
