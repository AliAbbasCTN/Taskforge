import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
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
 * It is best-effort: if Redis is down at startup the schedule can't be saved,
 * which is logged loudly; it is registered the next time the app starts.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
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
    } catch (error) {
      this.logger.error(
        `Could not register the maintenance schedules (is Redis up?): ${String(error)}`,
      );
    }
  }
}
