import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  MAINTENANCE_JOB_OPTIONS,
  MAINTENANCE_QUEUE,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_JOB_OPTIONS,
} from './queues.constants';
import { QueueMonitorService } from './queue-monitor.service';
import { parseRedisUrl } from './redis-config';
import type { JobsOptions } from 'bullmq';

/**
 * Builds a queue registration. The `connection` given here is used by the
 * QUEUE (the producer side - code that adds jobs); it turns off the Redis
 * client's "offline queue".
 *
 * WHY: by default a Redis client that has lost its connection quietly holds
 * every command in memory until it reconnects. For a producer that means
 * `queue.add(...)` simply never returns while Redis is down - and since
 * adding a job happens inside an HTTP request, the request would hang. With
 * the offline queue off, the call FAILS FAST instead, and the caller can fall
 * back (see `NotificationsService.notify`).
 *
 * Workers (the consumer side) deliberately use the shared root connection
 * below instead: a worker SHOULD wait patiently for Redis to come back.
 */
const queue = (name: string, defaultJobOptions: JobsOptions) =>
  BullModule.registerQueueAsync({
    name,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
      connection: {
        ...parseRedisUrl(config.getOrThrow<string>('redis.url')),
        enableOfflineQueue: false,
      },
      defaultJobOptions,
    }),
  });

/**
 * WHAT: Connects the application to Redis for background jobs and declares the
 * queues.
 *
 * `@Global()` + re-exporting `BullModule` means any module can inject a queue
 * with `@InjectQueue('notifications')` without importing anything - the same
 * convenience `DatabaseModule` gives for Prisma.
 *
 * A MESSAGE QUEUE, IN SHORT: a producer (an HTTP request) adds a job - a small
 * JSON message describing work - to a named list in Redis and moves on. A
 * separate WORKER takes jobs off the list and does them. The two are decoupled
 * in time (the work can happen later), in failure (a job that fails can be
 * retried without the user ever noticing), and in speed (slow work doesn't make
 * requests slow). BullMQ implements this on top of Redis.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisUrl(config.getOrThrow<string>('redis.url')),
      }),
    }),
    queue(NOTIFICATIONS_QUEUE, NOTIFICATION_JOB_OPTIONS),
    queue(MAINTENANCE_QUEUE, MAINTENANCE_JOB_OPTIONS),
  ],
  providers: [QueueMonitorService],
  exports: [BullModule, QueueMonitorService],
})
export class QueuesModule {}
