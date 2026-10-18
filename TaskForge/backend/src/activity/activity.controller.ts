import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Permission } from '../common/authorization/permission.enum';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { OrganizationPermissionGuard } from '../organizations/guards/organization-permission.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ActivityService } from './activity.service';
import { ListActivityQueryDto } from './dto/list-activity-query.dto';

/**
 * WHAT: A project's activity feed - "what has been happening here".
 *
 *   GET /organizations/:id/projects/:projectId/activity?taskId=...&action=...
 *
 * Anyone who can see the project can read it (the same guard chain as the
 * project itself; a project you cannot see is a 404). `taskId` narrows it to
 * one task's timeline - that is how the task panel shows its history.
 */
@Controller('organizations/:id/projects/:projectId/activity')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard)
export class ProjectActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  list(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListActivityQueryDto,
  ) {
    return this.activityService.listForProject(
      organizationId,
      projectId,
      query,
    );
  }
}

/**
 * WHAT: The organization audit trail - every recorded action across all
 * projects plus membership and settings changes.
 *
 *   GET /organizations/:id/audit-log?actorId=...&action=...&from=...&to=...
 *
 * ADMIN only (`organization:audit:read`): it includes who was given which role
 * and what happened in every project. Read-only, with no way to edit or delete
 * entries.
 */
@Controller('organizations/:id/audit-log')
@UseGuards(
  JwtAuthGuard,
  OrganizationMembershipGuard,
  OrganizationPermissionGuard,
)
export class AuditLogController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @RequirePermission(Permission.AuditLogRead)
  list(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query() query: ListActivityQueryDto,
  ) {
    return this.activityService.listForOrganization(organizationId, query);
  }
}
