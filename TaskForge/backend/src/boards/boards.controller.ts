import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEndpoint, BEARER_AUTH_NAME } from '../common/swagger';
import {
  BoardDetailResponse,
  BoardResponse,
  BoardSummaryResponse,
  BoardWithColumnsResponse,
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublishesChanges } from '../realtime/realtime.decorators';
import { Permission } from '../common/authorization/permission.enum';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { BoardGuard } from './guards/board.guard';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { TaskFilterDto } from '../tasks/dto/task-filter.dto';
import { LogsActivity } from '../activity/activity.decorator';

/**
 * WHAT: HTTP routes for boards, nested under the project they belong to.
 *
 * WHERE (prefix `/organizations/:id/projects/:projectId/boards`):
 *   POST   /            - create a board with default columns (project:boards:manage)
 *   GET    /            - list the project's boards (anyone who can see the project)
 *   GET    /:boardId    - the full board view: columns, tasks, assignees, labels;
 *                         optional task filters ?priority=&assigneeId=&labelId=&overdue= (same)
 *   PATCH  /:boardId    - rename (project:boards:manage)
 *   DELETE /:boardId    - delete, with its columns and tasks (project:boards:manage)
 *
 * GUARD ORDER - four levels deep now, each relying on the one before:
 *   `JwtAuthGuard`                -> who are you?
 *   `OrganizationMembershipGuard` -> are you in this organization?   (404)
 *   `ProjectGuard`                -> may you see this project?       (404)
 *   `BoardGuard` (routes with :boardId) -> is this board in it?      (404)
 * and then, on write routes only:
 *   `ProjectPermissionGuard`      -> may you do this?                (403)
 *   `ProjectActiveGuard`          -> is the project writable?        (409)
 * Nest runs controller-level guards before method-level ones, so reads need
 * no extra decoration and writes can only add checks, never skip any.
 */
@ApiTags('Boards')
@ApiBearerAuth(BEARER_AUTH_NAME)
@PublishesChanges('boards')
@Controller('organizations/:id/projects/:projectId/boards')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  @LogsActivity('board.created')
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Create a board',
    description: 'New boards start with three columns: To Do, In Progress and Done.',
    created: BoardWithColumnsResponse,
    conflict: 'The project is archived (read-only).',
  })
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBoardDto,
  ) {
    return this.boardsService.create(projectId, dto.name);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List a project\'s boards',
    ok: [BoardSummaryResponse],
  })
  findAll(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.boardsService.findAll(projectId);
  }

  @Get(':boardId')
  @UseGuards(BoardGuard)
  @ApiEndpoint({
    summary: 'Get the board view',
    description: 'The whole kanban board in one call: columns in order, each with its tasks in order, with assignees and labels. Accepts the task filters `priority`, `assigneeId`, `labelId` and `overdue`; columns are always returned, only their tasks are filtered.',
    ok: BoardDetailResponse,
  })
  findOne(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() filter: TaskFilterDto,
  ) {
    return this.boardsService.findOne(boardId, filter);
  }

  @Patch(':boardId')
  @LogsActivity('board.updated')
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(BoardGuard, ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Rename a board',
    ok: BoardResponse,
    conflict: 'The project is archived (read-only).',
  })
  update(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: UpdateBoardDto,
  ) {
    return this.boardsService.update(boardId, dto.name);
  }

  @Delete(':boardId')
  @LogsActivity('board.deleted')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(BoardGuard, ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Delete a board',
    description: '**Irreversible.** Also deletes the board\'s columns and tasks.',
    noContent: 'Board deleted.',
    conflict: 'The project is archived (read-only).',
  })
  remove(@Param('boardId', ParseUUIDPipe) boardId: string) {
    return this.boardsService.remove(boardId);
  }
}
