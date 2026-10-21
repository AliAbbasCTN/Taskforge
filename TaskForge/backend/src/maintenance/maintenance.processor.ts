import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { OrphanedFilesCleaner } from '../files/orphaned-files.cleaner';
import {
  MAINTENANCE_QUEUE,
  NOTIFICATION_RETENTION_DAYS,
  PURGE_OLD_NOTIFICATIONS_JOB,
  SWEEP_ORPHANED_FILES_JOB,
} from '../queues/queues.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * WHAT: The worker for the `maintenance` queue: housekeeping that nobody
 * should have to remember to do.
 *
 * Two jobs: `purge-old-notifications` and `sweep-orphaned-files` (see
 * `OrphanedFilesCleaner` for the second).
 *
 * `purge-old-notifications`: Notifications are a
 * per-user inbox that only ever grows; a notification someone read three
 * months ago is clutter and storage. Deleting READ notifications past the
 * retention window keeps the table (and its indexes) small. UNREAD ones are
 * never touched here - someone hasn't seen them yet.
 *
 * Maintenance jobs should be IDEMPOTENT: run it twice and the second run finds
 * nothing left to do. That is what makes it safe for the queue to retry it, and
 * safe if two instances happened to run it at once.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orphanedFiles: OrphanedFilesCleaner,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case PURGE_OLD_NOTIFICATIONS_JOB:
        return this.purgeOldNotifications();
      case SWEEP_ORPHANED_FILES_JOB:
        return this.orphanedFiles.sweep();
      default:
        // An unknown job will never succeed, so don't retry it.
        throw new UnrecoverableError(`Unknown maintenance job "${job.name}"`);
    }
  }

  /** Deletes notifications read more than the retention period ago. */
  async purgeOldNotifications(
    now: Date = new Date(),
  ): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);

    const { count } = await this.prisma.notification.deleteMany({
      // `lt` on a NULL readAt is never true, so unread notifications are
      // untouched by construction.
      where: { readAt: { lt: cutoff } },
    });

    this.logger.log(
      `Purged ${count} notification(s) read before ${cutoff.toISOString()}`,
    );
    return { deleted: count };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `Maintenance job ${job?.name ?? '(unknown)'} failed (attempt ${job?.attemptsMade ?? '?'}): ${error.message}`,
    );
  }
}
