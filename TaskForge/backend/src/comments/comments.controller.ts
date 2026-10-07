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
@Controller(
  'organizations/:id/projects/:projectId/boards/:boardId/tasks/:taskId/comments',
)
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard, BoardGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  list(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.commentsService.list(boardId, taskId);
  }

  @Post()
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
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
