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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Permission } from '../common/authorization/permission.enum';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import { BoardGuard } from '../boards/guards/board.guard';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SetTaskLabelsDto } from './dto/set-task-labels.dto';

/**
 * WHAT: HTTP routes for tasks (project CONTENT, so every write needs
 * `project:tasks:write`, which both project LEADs and MEMBERs hold; org
 * ADMIN/MANAGER have it through organization-wide oversight).
 *
 * Two ways to read tasks: the BOARD VIEW (`GET .../boards/:boardId`) returns
 * every column with its tasks in order - ideal for the kanban board - while
 * `GET .../tasks` (below) is a flat, paginated, sortable list for list-style
 * screens. Full-text search arrives in Phase 14.
 *
 * WHERE (prefix `/organizations/:id/projects/:projectId/boards/:boardId/tasks`):
 *   GET    /                - paginated list: filter, sort, page
 *   POST   /                - create a task in `columnId`
 *   GET    /:taskId         - one task (with assignee and labels)
 *   PATCH  /:taskId         - edit title/description/priority/dueDate/assignee
 *   PUT    /:taskId/labels  - replace the task's labels
 *   POST   /:taskId/move    - move to another column and/or position
 *   DELETE /:taskId         - delete
 */
@Controller('organizations/:id/projects/:projectId/boards/:boardId/tasks')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard, BoardGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksService.list(boardId, query);
  }

  @Post()
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(projectId, boardId, dto);
  }

  @Get(':taskId')
  findOne(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.tasksService.findOne(boardId, taskId);
  }

  @Patch(':taskId')
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(projectId, boardId, taskId, dto);
  }

  @Put(':taskId/labels')
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  setLabels(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: SetTaskLabelsDto,
  ) {
    return this.tasksService.setLabels(
      projectId,
      boardId,
      taskId,
      dto.labelIds,
    );
  }

  @Post(':taskId/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  move(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: MoveTaskDto,
  ) {
    return this.tasksService.move(boardId, taskId, dto);
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectTasksWrite)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  remove(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.tasksService.remove(boardId, taskId);
  }
}
