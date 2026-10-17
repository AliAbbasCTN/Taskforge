import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrphanedFilesCleaner } from './orphaned-files.cleaner';
import { createStorage } from './storage/storage.factory';
import { StorageService } from './storage/storage.service';

/**
 * WHAT: The file-storage infrastructure: which backend stores bytes
 * (`StorageService`) and the housekeeping that keeps it tidy
 * (`OrphanedFilesCleaner`).
 *
 * This module knows nothing about tasks or attachments; features that store
 * files (today only `AttachmentsModule`) import it. `MaintenanceModule` imports
 * it too, for the nightly sweep. Nest creates the providers ONCE however many
 * modules import this one, so there is a single storage client.
 */
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: createStorage,
    },
    OrphanedFilesCleaner,
  ],
  exports: [StorageService, OrphanedFilesCleaner],
})
export class FilesModule {}
