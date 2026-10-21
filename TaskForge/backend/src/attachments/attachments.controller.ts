import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiEndpoint,
  BEARER_AUTH_NAME,
  ErrorResponseDto,
} from '../common/swagger';
import {
  AttachmentResponse,
} from '../docs/models';
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectMembership } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Permission } from '../common/authorization/permission.enum';
import { canActOnProject } from '../common/authorization/project-access';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import { BoardGuard } from '../boards/guards/board.guard';
import { contentDispositionAttachment } from '../files/file-names';
import { PublishesChanges } from '../realtime/realtime.decorators';
import {
  CurrentMembership,
  RequestMembership,
} from '../organizations/decorators/current-membership.decorator';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { CurrentProjectMembership } from '../projects/decorators/current-project-membership.decorator';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { AttachmentsService } from './attachments.service';
import { LogsActivity } from '../activity/activity.decorator';

/**
 * WHAT: HTTP routes for a task's attachments.
 *
 * WHERE (prefix `.../boards/:boardId/tasks/:taskId/attachments`):
 *   GET    /                      - the task's attachments (anyone who can see the project)
 *   POST   /                      - upload ONE file, multipart field "file" (project:tasks:write)
 *   GET    /:attachmentId/download - the file itself (anyone who can see the project)
 *   DELETE /:attachmentId         - delete YOUR upload, or any if you manage the project
 *
 * ORDER OF EVENTS on an upload matters for security: guards run BEFORE
 * interceptors in NestJS, so authentication, organisation membership, project
 * access and the write permission are all checked before the multipart body is
 * parsed. An outsider cannot make the server buffer a 10 MB body.
 *
 * DOWNLOADS go through the API rather than straight from storage, so the
 * permission check happens on every download and a file URL is never a
 * shareable "anyone with the link" address. The response is forced to a
 * download with `nosniff` and a locked-down CSP so that - even in the unlikely
 * event something malicious were stored - a browser will not run it as part of
 * TaskForge.
 */
@ApiTags('Attachments')
@ApiBearerAuth(BEARER_AUTH_NAME)
@PublishesChanges('attachments')
@Controller(
  'organizations/:id/projects/:projectId/boards/:boardId/tasks/:taskId/attachments',
)
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard, BoardGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List a task\'s attachments',
    description: 'Oldest first. Metadata only; use the download route for the file.',
    ok: [AttachmentResponse],
    notFound: 'The task is not on this board.',
  })
  list(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.attachmentsService.list(boardId, taskId);
  }

  @Post()
  @LogsActivity('attachment.added')
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  // Size and count limits come from `MulterModule.registerAsync` in
  // AttachmentsModule, so they follow UPLOAD_MAX_FILE_SIZE_MB.
  @UseInterceptors(FileInterceptor('file'))
  @ApiEndpoint({
    summary: 'Upload an attachment',
    description: 'Send ONE file as `multipart/form-data` in a field named `file`. The server checks the file\'s real type from its content (not the client\'s header or extension), enforces the size limit (`UPLOAD_MAX_FILE_SIZE_MB`, default 10 MB) and stores it under a server-generated name.',
    created: AttachmentResponse,
    notFound: 'The task is not on this board.',
    conflict: 'The task already has the maximum number of attachments, or the project is archived.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 413,
    description: 'The file is larger than the upload limit.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 415,
    description: 'The file type is not allowed.',
    type: ErrorResponseDto,
  })
  upload(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachmentsService.upload(
      { organizationId, projectId, boardId, taskId },
      user.id,
      file,
    );
  }

  @Get(':attachmentId/download')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Header('Cache-Control', 'private, no-store')
  @ApiEndpoint({
    summary: 'Download an attachment',
    description: 'Streams the file as a forced download (`Content-Disposition: attachment`) with `nosniff` and a locked-down CSP. Permission is checked on EVERY download, so a file URL is never a shareable link.',
    notFound: 'No such attachment on this task, or its file is gone.',
  })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    description: 'The file contents.',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async download(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    const file = await this.attachmentsService.openForDownload(
      boardId,
      taskId,
      attachmentId,
    );
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: contentDispositionAttachment(file.fileName),
      length: file.sizeBytes,
    });
  }

  @Delete(':attachmentId')
  @LogsActivity('attachment.removed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Delete an attachment',
    description: 'The uploader can delete their own upload; project leads and organization ADMIN/MANAGERs can delete any.',
    noContent: 'Attachment deleted.',
    notFound: 'No such attachment on this task.',
    conflict: 'The project is archived (read-only).',
  })
  @ApiForbiddenResponse({
    description: 'It is not your upload and you do not manage the project.',
    type: ErrorResponseDto,
  })
  remove(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() orgMembership: RequestMembership,
    @CurrentProjectMembership() projectMembership: ProjectMembership | null,
  ) {
    const canModerate = canActOnProject(
      orgMembership.role,
      projectMembership?.role,
      Permission.ProjectManage,
    );
    return this.attachmentsService.remove(
      boardId,
      taskId,
      attachmentId,
      user.id,
      canModerate,
    );
  }
}
