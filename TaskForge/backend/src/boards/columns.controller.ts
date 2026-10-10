import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

/**
 * WHAT: HTTP routes for a board's columns (structure, so every route needs
 * `project:boards:manage`). There is deliberately no `GET` here: columns are
 * read as part of the board view (`GET .../boards/:boardId`), which returns
 * them already ordered and with their tasks.
 *
 * WHERE (prefix `/organizations/:id/projects/:projectId/boards/:boardId/columns`):
 *   POST   /            - add a column (at the end, or at `position`)
 *   PATCH  /:columnId   - rename and/or move to `position`
 *   DELETE /:columnId   - delete an EMPTY column (409 if it still has tasks)
 */
@PublishesChanges('columns')
@Controller('organizations/:id/projects/:projectId/boards/:boardId/columns')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard, BoardGuard)
export class ColumnsController {
  constructor(private readonly columnsService: ColumnsService) {}

  @Post()
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  create(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: CreateColumnDto,
  ) {
    return this.columnsService.create(boardId, dto);
  }

  @Patch(':columnId')
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  update(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() dto: UpdateColumnDto,
  ) {
    return this.columnsService.update(boardId, columnId, dto);
  }

  @Delete(':columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  remove(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
  ) {
    return this.columnsService.remove(boardId, columnId);
  }
}
