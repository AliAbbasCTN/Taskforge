import { Module } from '@nestjs/common';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

/** Scheduled housekeeping. The queue comes from the global `QueuesModule`. */
@Module({
  providers: [MaintenanceProcessor, MaintenanceScheduler],
})
export class MaintenanceModule {}
