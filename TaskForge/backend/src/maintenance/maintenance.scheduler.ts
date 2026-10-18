import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { withTimeout } from '../common/utils/with-timeout';
import {
  MAINTENANCE_QUEUE,
  PURGE_CRON,
  PURGE_OLD_NOTIFICATIONS_JOB,
  PURGE_SCHEDULE_ID,
  SWEEP_CRON,
  SWEEP_ORPHANED_FILES_JOB,
  SWEEP_SCHEDULE_ID,
} from '../queues/queues.constants';

/**
 * WHAT: Registers the repeating schedule ("every night at 03:00, run the purge
 * job") when the application starts.
 *
 * WHY `upsertJobScheduler` and a fixed id: this code runs on EVERY start of
 * EVERY server instance. If it simply "added a repeating job" each time, ten
 * restarts (or ten instances) would create ten schedules and the purge would
 * run ten times a night. "Upsert" means create-or-update the schedule with this
 * id: after the first call, later calls change nothing. The schedule lives in
 * Redis, not in any one process, so exactly ONE job is produced per tick no
 * matter how many instances are running.
 *
 * If Redis is down at startup the schedules can't be saved. The app still
 * starts (the HTTP API doesn't need them), and registration is RETRIED in the
 * background every 30 seconds until it succeeds. Without the retry, a Redis
 * outage during a deploy would silently leave the nightly jobs unscheduled
 * until the next restart.
 */
@Injectable()
export class MaintenanceScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceScheduler.name);
  /** Public so tests can shorten it. */
  retryDelayMs = 30_000;
  private retryTimer?: NodeJS.Timeout;
  private stopped = false;
  private failures = 0;

  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.register();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  private async register(): Promise<void> {
    try {
      await withTimeout(
        Promise.all([
          this.queue.upsertJobScheduler(
            PURGE_SCHEDULE_ID,
            { pattern: PURGE_CRON },
            { name: PURGE_OLD_NOTIFICATIONS_JOB },
          ),
          this.queue.upsertJobScheduler(
            SWEEP_SCHEDULE_ID,
            { pattern: SWEEP_CRON },
            { name: SWEEP_ORPHANED_FILES_JOB },
          ),
        ]),
        5000,
        'Registering maintenance schedules',
      );
      this.logger.log(
        `Scheduled "${PURGE_OLD_NOTIFICATIONS_JOB}" ("${PURGE_CRON}") and "${SWEEP_ORPHANED_FILES_JOB}" ("${SWEEP_CRON}")`,
      );
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      // Loud the first time; later retries are a one-line reminder.
      const message = `Could not register the maintenance schedules (is Redis up?): ${String(error)}`;
      if (this.failures === 1) {
        this.logger.error(
          `${message}. Retrying every ${this.retryDelayMs / 1000}s.`,
        );
      } else {
        this.logger.warn(`${message} (attempt ${this.failures})`);
      }
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => void this.register(), this.retryDelayMs);
    // Never keep the process alive just to retry.
    this.retryTimer.unref();
  }
}
