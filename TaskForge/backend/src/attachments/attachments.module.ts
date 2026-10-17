import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { BoardGuard } from '../boards/guards/board.guard';
import { FilesModule } from '../files/files.module';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * WHAT: Files attached to tasks.
 *
 * `MulterModule` is NestJS's wrapper around Multer, the library that parses
 * `multipart/form-data` (the format browsers use to upload files). With no
 * `dest`/`storage` option Multer holds the upload IN MEMORY as a Buffer - which
 * is what we want: we must inspect the file's bytes before deciding to keep it,
 * and the size limit below caps how much memory one upload can use.
 *
 * Limits are applied BY MULTER WHILE PARSING, so an oversized upload is cut
 * off early (HTTP 413) instead of being fully received first:
 *   - fileSize: UPLOAD_MAX_FILE_SIZE_MB (default 10)
 *   - files: exactly one file per request
 *   - fields: no meaningful text fields are expected; a few are tolerated.
 */
@Module({
  imports: [
    FilesModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<number>('storage.maxFileSizeBytes'),
          files: 1,
          fields: 5,
        },
      }),
    }),
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    OrganizationMembershipGuard,
    ProjectGuard,
    ProjectPermissionGuard,
    ProjectActiveGuard,
    BoardGuard,
  ],
})
export class AttachmentsModule {}
