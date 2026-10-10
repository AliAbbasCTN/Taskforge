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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublishesChanges } from '../realtime/realtime.decorators';
import { Permission } from '../common/authorization/permission.enum';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { LabelsService } from './labels.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

/**
 * WHAT: HTTP routes for a project's labels. Reading is open to anyone who can
 * see the project (they need the list to display and filter by labels);
 * defining the vocabulary is project STRUCTURE, so it needs
 * `project:boards:manage` (project LEAD, or org ADMIN/MANAGER).
 *
 * WHERE (prefix `/organizations/:id/projects/:projectId/labels`):
 *   GET    /           - the project's labels, by name
 *   POST   /           - create (409 if the name is taken)
 *   PATCH  /:labelId   - rename and/or recolour
 *   DELETE /:labelId   - delete (detaches it from tasks)
 *
 * Attaching labels to a TASK is a task edit (`PUT .../tasks/:taskId/labels`),
 * which any project member may do.
 */
@PublishesChanges('labels')
@Controller('organizations/:id/projects/:projectId/labels')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard)
export class LabelsController {
  constructor(private readonly labelsService: LabelsService) {}

  @Get()
  list(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.labelsService.list(projectId);
  }

  @Post()
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.labelsService.create(projectId, dto);
  }

  @Patch(':labelId')
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labelsService.update(projectId, labelId, dto);
  }

  @Delete(':labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectBoardsManage)
  @UseGuards(ProjectPermissionGuard, ProjectActiveGuard)
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    return this.labelsService.remove(projectId, labelId);
  }
}
