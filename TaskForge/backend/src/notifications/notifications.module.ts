import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

/**
 * Exports the service so tasks, comments and projects can create
 * notifications. The processor is registered here too: it is the worker half
 * of the same feature. `RealtimeService` arrives via the global
 * `RealtimeModule`, and the queue via the global `QueuesModule`.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
