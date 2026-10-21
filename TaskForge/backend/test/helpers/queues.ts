import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  MAINTENANCE_QUEUE,
  NOTIFICATIONS_QUEUE,
} from '../../src/queues/queues.constants';

/**
 * Helpers for tests that involve BACKGROUND JOBS.
 *
 * The core difficulty: work done by a worker happens AFTER the HTTP response
 * returns. A test that asserts "the notification exists" the instant the
 * request finishes is racing the worker. The fix is never a fixed sleep (too
 * slow when the worker is fast, flaky when it is slow) but to wait for the
 * actual condition: `settleNotifications` waits until the queue has no work
 * left, and `eventually` retries an assertion until it holds.
 */

// The queues live in a nested module, hence `strict: false`.
export const notificationsQueue = (app: INestApplication) =>
  app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE), { strict: false });

export const maintenanceQueue = (app: INestApplication) =>
  app.get<Queue>(getQueueToken(MAINTENANCE_QUEUE), { strict: false });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once the notifications queue has nothing waiting, running, or
 * scheduled (a retry waiting out its backoff counts as scheduled).
 *
 * Only this queue is watched: the maintenance queue always holds a "delayed"
 * job - the next scheduled nightly run - so it would never look idle.
 */
export async function settleNotifications(
  app: INestApplication,
  timeoutMs = 20_000,
): Promise<void> {
  const queue = notificationsQueue(app);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
    if ((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) === 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Notifications queue did not settle within ${timeoutMs}ms: ${JSON.stringify(counts)}`,
      );
    }
    await sleep(50);
  }
}

/** Retries `assertion` until it stops throwing, or fails with its last error. */
export async function eventually(
  assertion: () => Promise<void>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await assertion();
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await sleep(100);
    }
  }
}
