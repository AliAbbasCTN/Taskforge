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
@Controller('organizations/:id/projects/:projectId/boards')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBoardDto,
  ) {
    return this.boardsService.create(projectId, dto.name);
  }

  @Get()
  findAll(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.boardsService.findAll(projectId);
  }

  @Get(':boardId')
  @UseGuards(BoardGuard)
  findOne(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() filter: TaskFilterDto,
  ) {
    return this.boardsService.findOne(boardId, filter);
  }

  @Patch(':boardId')
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(BoardGuard, ProjectPermissionGuard, ProjectActiveGuard)
  update(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: UpdateBoardDto,
  ) {
    return this.boardsService.update(boardId, dto.name);
  }

  @Delete(':boardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(BoardGuard, ProjectPermissionGuard, ProjectActiveGuard)
  remove(@Param('boardId', ParseUUIDPipe) boardId: string) {
    return this.boardsService.remove(boardId);
  }
}
