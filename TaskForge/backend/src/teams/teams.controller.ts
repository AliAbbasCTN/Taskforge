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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Permission } from '../common/authorization/permission.enum';
import { RequirePermission } from '../common/authorization/require-permission.decorator';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { TeamGuard } from './guards/team.guard';
import { TeamPermissionGuard } from './guards/team-permission.guard';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { UpdateTeamMemberRoleDto } from './dto/update-team-member-role.dto';

/**
 * WHAT: HTTP routes for teams (a subdivision of an organization) and their
 * memberships.
 *
 * WHERE (all nested under the organization they belong to):
 *   POST   /organizations/:id/teams                          - create a team (any org member; you become its LEAD)
 *   GET    /organizations/:id/teams                           - list teams in the org (any org member)
 *   GET    /organizations/:id/teams/:teamId                    - team details (any org member)
 *   PATCH  /organizations/:id/teams/:teamId                    - rename (requires team:manage)
 *   DELETE /organizations/:id/teams/:teamId                    - delete (requires team:manage)
 *   GET    /organizations/:id/teams/:teamId/members             - list members (any org member)
 *   POST   /organizations/:id/teams/:teamId/members             - add a member (requires team:members:manage)
 *   PATCH  /organizations/:id/teams/:teamId/members/:userId      - change a member's role (requires team:members:manage)
 *   DELETE /organizations/:id/teams/:teamId/members/:userId      - remove a member (requires team:members:manage)
 *
 * GUARD ORDER: `JwtAuthGuard` -> `OrganizationMembershipGuard` (applied at
 * the controller level) -> `TeamGuard` on routes with a `:teamId` (verifies
 * the team really belongs to this organization) -> `TeamPermissionGuard` on
 * mutation routes (declared via `@RequirePermission(...)`). Each guard
 * depends on data the previous one attached to the request, so this order
 * is load-bearing, not cosmetic.
 *
 * PHASE 06 CHANGE: `TeamLeadGuard` (Phase 05, "must be this team's LEAD,
 * full stop") is now `TeamPermissionGuard`. The permission it checks is the
 * same as before (`team:manage` / `team:members:manage`, both held only by
 * LEAD) - BUT the guard now ALSO grants access to anyone holding
 * `organization:teams:manage-any` (ADMIN or MANAGER) at the organization
 * level, even if they aren't personally on the team. This closes the gap
 * Phase 05's own docs flagged: an organization admin previously had no way
 * to manage a team they didn't lead.
 *
 * WHY the route prefix repeats `:id` (matching `OrganizationsController`,
 * not `:organizationId`): `OrganizationMembershipGuard` reads
 * `request.params.id` directly. Keeping the same param name here means the
 * exact same guard class works on both controllers with zero changes.
 */
@Controller('organizations/:id/teams')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  create(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateTeamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.create(organizationId, dto.name, user.id);
  }

  @Get()
  findAll(@Param('id', ParseUUIDPipe) organizationId: string) {
    return this.teamsService.findAllForOrg(organizationId);
  }

  @Get(':teamId')
  @UseGuards(TeamGuard)
  findOne(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teamsService.findOne(teamId);
  }

  @Patch(':teamId')
  @RequirePermission(Permission.TeamManage)
  @UseGuards(TeamGuard, TeamPermissionGuard)
  update(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(teamId, dto.name);
  }

  @Delete(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.TeamManage)
  @UseGuards(TeamGuard, TeamPermissionGuard)
  remove(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teamsService.remove(teamId);
  }

  @Get(':teamId/members')
  @UseGuards(TeamGuard)
  listMembers(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teamsService.listMembers(teamId);
  }

  @Post(':teamId/members')
  @RequirePermission(Permission.TeamMembersManage)
  @UseGuards(TeamGuard, TeamPermissionGuard)
  addMember(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(organizationId, teamId, dto);
  }

  @Patch(':teamId/members/:userId')
  @RequirePermission(Permission.TeamMembersManage)
  @UseGuards(TeamGuard, TeamPermissionGuard)
  updateMemberRole(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateTeamMemberRoleDto,
  ) {
    return this.teamsService.updateMemberRole(teamId, userId, dto.role);
  }

  @Delete(':teamId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.TeamMembersManage)
  @UseGuards(TeamGuard, TeamPermissionGuard)
  removeMember(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.teamsService.removeMember(teamId, userId);
  }
}
