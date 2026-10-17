import type { JobsOptions } from 'bullmq';

/** Queue names. A QUEUE is a named list of jobs waiting to be processed. */
export const NOTIFICATIONS_QUEUE = 'notifications';
export const MAINTENANCE_QUEUE = 'maintenance';

/** Job names (a queue can carry several kinds of job). */
export const DELIVER_NOTIFICATION_JOB = 'deliver-notification';
export const PURGE_OLD_NOTIFICATIONS_JOB = 'purge-old-notifications';

/** The id of the repeating schedule that enqueues the purge job. */
export const PURGE_SCHEDULE_ID = 'purge-old-notifications';

/** Nightly at 03:00 server time ("minute hour day-of-month month day-of-week"). */
export const PURGE_CRON = '0 3 * * *';

/** Read notifications older than this are deleted by the nightly purge. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/** Deletes stored files that no attachment row refers to any more. */
export const SWEEP_ORPHANED_FILES_JOB = 'sweep-orphaned-files';

/** Fixed schedule id (so restarts update it rather than duplicate it). */
export const SWEEP_SCHEDULE_ID = 'sweep-orphaned-files';

/** Every night at 03:30 - after the 03:00 notification purge. */
export const SWEEP_CRON = '30 3 * * *';

/**
 * How long to wait for Redis to accept a new job before giving up on the queue
 * and doing the work inline instead. Short on purpose: this wait happens inside
 * a user's HTTP request.
 */
export const ENQUEUE_TIMEOUT_MS = 2000;

/**
 * RETRY POLICY for notification delivery.
 *
 *  - `attempts: 5`  - try up to five times in total.
 *  - `backoff: exponential, 1s` - wait 1s, 2s, 4s, 8s between attempts.
 *    Waiting longer each time matters: most failures are a dependency that is
 *    briefly overloaded or restarting, and hammering it with instant retries
 *    makes that worse. Exponential backoff gives it room to recover.
 *  - `removeOnComplete` - successful jobs are only bookkeeping; keep an hour
 *    (or the last 1000) so recent activity is inspectable, then let Redis
 *    free the memory.
 *  - `removeOnFail` - failed jobs are KEPT for a week. A job that exhausted
 *    its retries is the one thing you most need to look at (the "dead-letter"
 *    pile), and it must not vanish before anyone notices.
 */
export const NOTIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Maintenance jobs are idempotent and run rarely: a couple of tries is plenty. */
export const MAINTENANCE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 50 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
