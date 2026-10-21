import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEndpoint, BEARER_AUTH_NAME } from '../common/swagger';
import {
  ProjectMemberResponse,
  ProjectResponse,
  ProjectSummaryResponse,
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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Permission } from '../common/authorization/permission.enum';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import {
  CurrentMembership,
  RequestMembership,
} from '../organizations/decorators/current-membership.decorator';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import {
  PublishesChanges,
  RevalidatesUserRooms,
} from '../realtime/realtime.decorators';
import { ProjectGuard } from './guards/project.guard';
import { ProjectPermissionGuard } from './guards/project-permission.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { UpdateProjectMemberRoleDto } from './dto/update-project-member-role.dto';
import { LogsActivity } from '../activity/activity.decorator';

/**
 * WHAT: HTTP routes for projects and their memberships.
 *
 * WHERE (all nested under the organization they belong to):
 *   POST   /organizations/:id/projects                            - create (any org member; you become its LEAD)
 *   GET    /organizations/:id/projects?status=ACTIVE|ARCHIVED     - list the projects YOU can see
 *   GET    /organizations/:id/projects/:projectId                 - details (project members, org ADMIN/MANAGER)
 *   PATCH  /organizations/:id/projects/:projectId                 - edit name/description (project:manage)
 *   POST   /organizations/:id/projects/:projectId/archive         - archive (project:manage)
 *   POST   /organizations/:id/projects/:projectId/unarchive       - unarchive (project:manage)
 *   DELETE /organizations/:id/projects/:projectId                 - delete permanently, archived only (project:manage)
 *   GET    /organizations/:id/projects/:projectId/members         - list members (anyone who can see the project)
 *   POST   /organizations/:id/projects/:projectId/members         - add a member (project:members:manage)
 *   PATCH  /organizations/:id/projects/:projectId/members/:userId - change a role (project:members:manage)
 *   DELETE /organizations/:id/projects/:projectId/members/:userId - remove a member (project:members:manage)
 *
 * GUARD ORDER: `JwtAuthGuard` -> `OrganizationMembershipGuard` (controller
 * level: "are you in this organization?") -> `ProjectGuard` on routes with a
 * `:projectId` ("does it belong to this organization, and may YOU see it?")
 * -> `ProjectPermissionGuard` on mutation routes ("may you do this to it?",
 * declared via `@RequirePermission(...)`). Each guard reads what the one
 * before it attached to the request, so the order is load-bearing.
 *
 * WHY archive/unarchive are POST actions rather than `PATCH { status }`:
 * archiving is a state TRANSITION with its own rules (you can't archive
 * twice; an archived project is read-only), not a field you edit. Giving
 * each transition its own route keeps `PATCH` to plain editing and makes
 * each action's permission and error behaviour explicit.
 *
 * WHY the route prefix uses `:id` for the organization (not
 * `:organizationId`): `OrganizationMembershipGuard` reads `request.params.id`,
 * so the same guard class works on every organization-nested controller.
 */
@ApiTags('Projects')
@ApiBearerAuth(BEARER_AUTH_NAME)
@PublishesChanges('project')
@Controller('organizations/:id/projects')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @LogsActivity('project.created')
  @ApiEndpoint({
    summary: 'Create a project',
    description: 'Any organization member can create a project and becomes its LEAD. Projects are PRIVATE: only project members and organization ADMIN/MANAGERs can see them.',
    created: ProjectResponse,
  })
  create(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.create(organizationId, dto, user.id);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List projects you can see',
    description: 'Project members see their projects; organization ADMIN/MANAGERs see all. Defaults to ACTIVE projects; pass `status=ARCHIVED` for archived ones. Not paginated.',
    ok: [ProjectSummaryResponse],
  })
  findAll(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query() query: ListProjectsQueryDto,
    @CurrentMembership() membership: RequestMembership,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.findAllVisible(
      organizationId,
      membership.role,
      user.id,
      query.status,
      query.search,
    );
  }

  @Get(':projectId')
  @UseGuards(ProjectGuard)
  @ApiEndpoint({
    summary: 'Get a project',
    ok: ProjectSummaryResponse,
  })
  findOne(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.findOne(projectId, user.id);
  }

  @Patch(':projectId')
  @LogsActivity('project.updated')
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Edit a project',
    description: 'Send at least one of `name` and `description`.',
    ok: ProjectResponse,
    conflict: 'The project is archived (read-only).',
  })
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(projectId, dto);
  }

  @Post(':projectId/archive')
  @LogsActivity('project.archived')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Archive a project',
    description: 'A reversible "put away": the project keeps all its data but becomes read-only.',
    ok: ProjectResponse,
    conflict: 'The project is already archived.',
  })
  archive(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.archive(projectId);
  }

  @Post(':projectId/unarchive')
  @LogsActivity('project.unarchived')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Unarchive a project',
    ok: ProjectResponse,
    conflict: 'The project is not archived.',
  })
  unarchive(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.unarchive(projectId);
  }

  @Delete(':projectId')
  @LogsActivity('project.deleted')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Delete a project permanently',
    description: '**Irreversible.** Only ARCHIVED projects can be deleted: archiving first is the safety step. Cascades to boards, tasks, comments and attachments.',
    noContent: 'Project deleted.',
    conflict: 'The project is not archived. Archive it first.',
  })
  remove(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.remove(projectId);
  }

  @Get(':projectId/members')
  @UseGuards(ProjectGuard)
  @ApiEndpoint({
    summary: 'List project members',
    ok: [ProjectMemberResponse],
  })
  listMembers(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.listMembers(projectId);
  }

  @Post(':projectId/members')
  @LogsActivity('project.member_added')
  @RequirePermission(Permission.ProjectMembersManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Add a project member',
    description: 'The user must already be a member of the organization. The added user is notified.',
    created: ProjectMemberResponse,
    notFound: 'No user is registered with that email address.',
    conflict: 'Already a member of the project, or the project is archived.',
    unprocessable: 'The user is not a member of the organization.',
  })
  addMember(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.addMember(
      organizationId,
      projectId,
      dto,
      user.id,
    );
  }

  @Patch(':projectId/members/:userId')
  @LogsActivity('project.member_role_changed')
  @RequirePermission(Permission.ProjectMembersManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Change a project member\'s role',
    ok: ProjectMemberResponse,
    notFound: 'That user is not a member of this project.',
    conflict: 'Would demote the last remaining LEAD, or the project is archived.',
  })
  updateMemberRole(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
  ) {
    return this.projectsService.updateMemberRole(projectId, userId, dto.role);
  }

  // Removing someone must also cut off their live connection - see
  // `RevalidatesUserRooms`.
  @Delete(':projectId/members/:userId')
  @LogsActivity('project.member_removed')
  @RevalidatesUserRooms()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectMembersManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  @ApiEndpoint({
    summary: 'Remove a project member',
    description: 'Also closes that person\'s live connection to the project.',
    noContent: 'Member removed.',
    notFound: 'That user is not a member of this project.',
    conflict: 'Would remove the last remaining LEAD, or the project is archived.',
  })
  removeMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.projectsService.removeMember(projectId, userId);
  }
}
