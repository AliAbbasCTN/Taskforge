import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

/**
 * Scheduled housekeeping. The queue comes from the global `QueuesModule`;
 * `FilesModule` supplies the orphan-file cleaner.
 */
@Module({
  imports: [FilesModule],
  providers: [MaintenanceProcessor, MaintenanceScheduler],
})
export class MaintenanceModule {}
