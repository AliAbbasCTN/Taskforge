import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiEndpoint,
  BEARER_AUTH_NAME,
  ErrorResponseDto,
} from '../common/swagger';
import {
  CommentResponse,
} from '../docs/models';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { CommentsService } from './comments.service';
import { CommentBodyDto } from './dto/comment-body.dto';
import { LogsActivity } from '../activity/activity.decorator';

/**
 * WHAT: HTTP routes for a task's comments.
 *
 * WHERE (prefix `.../boards/:boardId/tasks/:taskId/comments`):
 *   GET    /             - the task's comments, oldest first (anyone who can see the project)
 *   POST   /             - add a comment (project:tasks:write)
 *   PATCH  /:commentId   - edit YOUR comment (project:tasks:write; author only)
 *   DELETE /:commentId   - delete YOUR comment, or any comment if you manage the project
 *
 * The task itself is verified inside `CommentsService` (scoped to the board),
 * the same way columns and tasks are - see its class comment.
 */
@ApiTags('Comments')
@ApiBearerAuth(BEARER_AUTH_NAME)
@PublishesChanges('comments')
@Controller(
  'organizations/:id/projects/:projectId/boards/:boardId/tasks/:taskId/comments',
)
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard, BoardGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List a task\'s comments',
    description: 'Oldest first.',
    ok: [CommentResponse],
    notFound: 'The task is not on this board.',
  })
  list(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.commentsService.list(boardId, taskId);
  }

  @Post()
  @LogsActivity('comment.created')
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Add a comment',
    description: 'Comment text is plain text and never rendered as HTML.',
    created: CommentResponse,
    notFound: 'The task is not on this board.',
    conflict: 'The project is archived (read-only).',
  })
  create(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CommentBodyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commentsService.create(boardId, taskId, user.id, dto.body);
  }

  @Patch(':commentId')
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Edit your comment',
    description: 'Only the author can edit a comment - not even a project lead can put words in someone else\'s mouth.',
    ok: CommentResponse,
    notFound: 'No such comment on this task.',
    conflict: 'The project is archived (read-only).',
  })
  update(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CommentBodyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commentsService.update(
      boardId,
      taskId,
      commentId,
      user.id,
      dto.body,
    );
  }

  @Delete(':commentId')
  @LogsActivity('comment.deleted')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Delete a comment',
    description: 'The author can delete their own comment; project leads and organization ADMIN/MANAGERs can delete any (moderation).',
    noContent: 'Comment deleted.',
    notFound: 'No such comment on this task.',
    conflict: 'The project is archived (read-only).',
  })
  @ApiForbiddenResponse({
    description: 'It is not your comment and you do not manage the project.',
    type: ErrorResponseDto,
  })
  remove(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() orgMembership: RequestMembership,
    @CurrentProjectMembership() projectMembership: ProjectMembership | null,
  ) {
    const canModerate = canActOnProject(
      orgMembership.role,
      projectMembership?.role,
      Permission.ProjectManage,
    );
    return this.commentsService.remove(
      boardId,
      taskId,
      commentId,
      user.id,
      canModerate,
    );
  }
}
