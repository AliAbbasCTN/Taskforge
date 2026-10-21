import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { withTimeout } from '../common/utils/with-timeout';
import { MAINTENANCE_QUEUE, NOTIFICATIONS_QUEUE } from './queues.constants';

export interface QueueCounts {
  /** Jobs waiting for a worker. A number that keeps growing means workers can't keep up. */
  waiting: number;
  /** Jobs being processed right now. */
  active: number;
  /** Jobs scheduled for later: retries waiting out their backoff, and scheduled runs. */
  delayed: number;
  /** Jobs that exhausted their retries. Kept for a week; should normally be 0. */
  failed: number;
}

export interface QueueSnapshot {
  redis: 'up' | 'down';
  queues: { notifications: QueueCounts; maintenance: QueueCounts } | null;
}

const SNAPSHOT_TIMEOUT_MS = 2000;

/**
 * WHAT: Answers "is Redis reachable, and what state are the queues in?" for the
 * health endpoint.
 *
 * MONITORING A SYSTEM WHOSE WORK HAPPENS OUT OF SIGHT: when work moves into a
 * background queue, failures stop being visible - there is no user staring at
 * an error. A job can fail silently for days. So the strategy has layers:
 *   1. LOGS - every failed attempt is logged by the processor, and a job that
 *      has given up is logged at error level (see the processors).
 *   2. COUNTS - this service. The numbers to watch: `failed` should be ~0, and
 *      `waiting` should not grow without bound. Exposed on `/health` so an
 *      uptime monitor or an alert rule can read them.
 *   3. RETENTION - failed jobs are kept for a week (see queues.constants.ts),
 *      so someone can still inspect what went wrong after the alert fires.
 *   4. A DASHBOARD - Bull Board or Taskforce.sh give a UI over exactly this
 *      data. Not added here (a dashboard is an admin tool and must sit behind
 *      authentication) - see docs/phase-12-concepts.md.
 */
@Injectable()
export class QueueMonitorService {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notifications: Queue,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly maintenance: Queue,
  ) {}

  async snapshot(): Promise<QueueSnapshot> {
    try {
      const [notifications, maintenance] = await withTimeout(
        Promise.all([this.counts(this.notifications), this.counts(this.maintenance)]),
        SNAPSHOT_TIMEOUT_MS,
        'Queue snapshot',
      );
      return { redis: 'up', queues: { notifications, maintenance } };
    } catch {
      return { redis: 'down', queues: null };
    }
  }

  private async counts(queue: Queue): Promise<QueueCounts> {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
  }
}
