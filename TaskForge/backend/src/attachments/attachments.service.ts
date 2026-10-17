import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Readable } from 'node:stream';
import { PrismaService } from '../database/prisma.service';
import { MAX_ATTACHMENTS_PER_TASK } from '../files/files.constants';
import { repairUtf8FileName, sanitizeFileName } from '../files/file-names';
import { validateFile } from '../files/file-validation';
import { buildStorageKey } from '../files/storage/storage-key';
import {
  StorageObjectNotFoundError,
  StorageService,
} from '../files/storage/storage.service';
import { SAFE_USER_SELECT } from '../users/users.service';

/**
 * What the API returns for an attachment. An explicit `select` (not
 * "everything") so that `storageKey` - the file's internal address - can never
 * leak into a response by accident, and uploaders come back without credentials.
 */
export const ATTACHMENT_SELECT = {
  id: true,
  taskId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploader: { select: SAFE_USER_SELECT },
} satisfies Prisma.AttachmentSelect;

/** The parts of an uploaded file this service needs (a subset of Multer's). */
export interface UploadedFileInput {
  originalname: string;
  buffer: Buffer;
}

/** Where an upload belongs: every id has been verified by the route guards. */
export interface AttachmentScope {
  organizationId: string;
  projectId: string;
  boardId: string;
  taskId: string;
}

/**
 * WHAT: Business logic for files attached to a task.
 *
 * WHERE: Injected into `AttachmentsController`. By the time a method runs, the
 * guards have established that the requester belongs to the organisation, can
 * see the project, that the board belongs to it, and (on writes) holds
 * `project:tasks:write` on a non-archived project. This service adds:
 *   - the task must exist ON THAT BOARD (so a task id from elsewhere is a 404);
 *   - the file must pass content validation;
 *   - the per-task attachment limit;
 *   - who may delete: the uploader, or a moderator (project lead / org
 *     admin or manager) - the same rule as comments.
 *
 * HOW an upload is kept consistent: bytes go to storage FIRST, the database row
 * second. If the row can't be written the bytes are removed again. The reverse
 * order would risk a row pointing at a file that was never saved - a broken
 * attachment a user can see. The residual risk (a crash between the two steps)
 * leaves only an invisible orphan file, which `OrphanedFilesCleaner` removes.
 *
 * Deleting works the other way round: the row first (so the attachment
 * disappears immediately and can never be a dangling reference), then the bytes.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(boardId: string, taskId: string) {
    await this.assertTaskOnBoard(boardId, taskId);
    return this.prisma.attachment.findMany({
      where: { taskId },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async upload(
    scope: AttachmentScope,
    uploaderId: string,
    file: UploadedFileInput | undefined,
  ) {
    await this.assertTaskOnBoard(scope.boardId, scope.taskId);

    if (!file) {
      throw new BadRequestException(
        'No file was uploaded. Send it as multipart/form-data in a field named "file"',
      );
    }

    // Clean the sender-chosen name first, then judge the file by the CLEAN name.
    const fileName = sanitizeFileName(repairUtf8FileName(file.originalname));
    const verdict = validateFile(fileName, file.buffer);
    if (!verdict.ok) {
      throw new UnsupportedMediaTypeException(verdict.reason);
    }

    const existing = await this.prisma.attachment.count({
      where: { taskId: scope.taskId },
    });
    if (existing >= MAX_ATTACHMENTS_PER_TASK) {
      throw new ConflictException(
        `A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments`,
      );
    }

    const storageKey = buildStorageKey({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      taskId: scope.taskId,
      extension: verdict.extension,
    });

    await this.storage.put(storageKey, file.buffer, verdict.mimeType);
    try {
      return await this.prisma.attachment.create({
        data: {
          taskId: scope.taskId,
          uploaderId,
          fileName,
          storageKey,
          // The type WE determined from the content - never the client's header.
          mimeType: verdict.mimeType,
          sizeBytes: file.buffer.length,
        },
        select: ATTACHMENT_SELECT,
      });
    } catch (error) {
      await this.discardStoredFile(storageKey);
      throw error;
    }
  }

  /** Looks up an attachment and opens its bytes for streaming to the client. */
  async openForDownload(boardId: string, taskId: string, attachmentId: string) {
    const attachment = await this.getScoped(boardId, taskId, attachmentId);
    let stream: Readable;
    try {
      stream = await this.storage.get(attachment.storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        // The row exists but the bytes are gone: an operational problem, worth
        // an error log, but the client just sees "not found".
        this.logger.error(
          `Attachment ${attachment.id} has no stored file (${attachment.storageKey})`,
        );
        throw new NotFoundException('The file is no longer available');
      }
      throw error;
    }
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      stream,
    };
  }

  async remove(
    boardId: string,
    taskId: string,
    attachmentId: string,
    requesterId: string,
    canModerate: boolean,
  ): Promise<void> {
    const attachment = await this.getScoped(boardId, taskId, attachmentId);
    if (attachment.uploaderId !== requesterId && !canModerate) {
      throw new ForbiddenException(
        'You can only delete your own attachments, unless you manage this project',
      );
    }
    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    await this.discardStoredFile(attachment.storageKey);
  }

  /** Best-effort removal of bytes; a failure only leaves an orphan for the sweep. */
  private async discardStoredFile(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.warn(
        `Could not delete stored file ${storageKey}; the orphan sweep will remove it: ${String(error)}`,
      );
    }
  }

  private async assertTaskOnBoard(boardId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, column: { boardId } },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
  }

  /** An attachment scoped by task AND board: from anywhere else it is a 404. */
  private async getScoped(
    boardId: string,
    taskId: string,
    attachmentId: string,
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, taskId, task: { column: { boardId } } },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }
}
