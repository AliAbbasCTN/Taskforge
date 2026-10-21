import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEndpoint, BEARER_AUTH_NAME } from '../common/swagger';
import {
  ColumnResponse,
} from '../docs/models';
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
@ApiTags('Columns')
@ApiBearerAuth(BEARER_AUTH_NAME)
@PublishesChanges('columns')
@Controller('organizations/:id/projects/:projectId/boards/:boardId/columns')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard, BoardGuard)
export class ColumnsController {
  constructor(private readonly columnsService: ColumnsService) {}

  @Post()
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Add a column',
    description: 'Appended at the end unless `position` is given.',
    created: ColumnResponse,
    conflict: 'The project is archived (read-only).',
  })
  create(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: CreateColumnDto,
  ) {
    return this.columnsService.create(boardId, dto);
  }

  @Patch(':columnId')
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  @ApiEndpoint({
    summary: 'Rename or move a column',
    description: 'Send `name`, `position` or both.',
    ok: ColumnResponse,
    notFound: 'The column is not on this board.',
    conflict: 'The project is archived (read-only).',
  })
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
  @ApiEndpoint({
    summary: 'Delete a column',
    description: 'Only EMPTY columns can be deleted.',
    noContent: 'Column deleted.',
    notFound: 'The column is not on this board.',
    conflict: 'The column still has tasks, or the project is archived.',
  })
  remove(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
  ) {
    return this.columnsService.remove(boardId, columnId);
  }
}
