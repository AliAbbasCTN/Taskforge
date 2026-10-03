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
import { ProjectGuard } from './guards/project.guard';
import { ProjectPermissionGuard } from './guards/project-permission.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { UpdateProjectMemberRoleDto } from './dto/update-project-member-role.dto';

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
@Controller('organizations/:id/projects')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.create(organizationId, dto, user.id);
  }

  @Get()
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
    );
  }

  @Get(':projectId')
  @UseGuards(ProjectGuard)
  findOne(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.findOne(projectId, user.id);
  }

  @Patch(':projectId')
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(projectId, dto);
  }

  @Post(':projectId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  archive(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.archive(projectId);
  }

  @Post(':projectId/unarchive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  unarchive(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.unarchive(projectId);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  remove(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.remove(projectId);
  }

  @Get(':projectId/members')
  @UseGuards(ProjectGuard)
  listMembers(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projectsService.listMembers(projectId);
  }

  @Post(':projectId/members')
  @RequirePermission(Permission.ProjectMembersManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  addMember(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projectsService.addMember(organizationId, projectId, dto);
  }

  @Patch(':projectId/members/:userId')
  @RequirePermission(Permission.ProjectMembersManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  updateMemberRole(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
  ) {
    return this.projectsService.updateMemberRole(projectId, userId, dto.role);
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ProjectMembersManage)
  @UseGuards(ProjectGuard, ProjectPermissionGuard)
  removeMember(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.projectsService.removeMember(projectId, userId);
  }
}
