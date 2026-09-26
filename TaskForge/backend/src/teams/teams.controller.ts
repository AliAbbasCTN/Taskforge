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
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { TeamGuard } from './guards/team.guard';
import { TeamLeadGuard } from './guards/team-lead.guard';
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
 *   PATCH  /organizations/:id/teams/:teamId                    - rename (team LEAD only)
 *   DELETE /organizations/:id/teams/:teamId                    - delete (team LEAD only)
 *   GET    /organizations/:id/teams/:teamId/members             - list members (any org member)
 *   POST   /organizations/:id/teams/:teamId/members             - add a member (team LEAD only)
 *   PATCH  /organizations/:id/teams/:teamId/members/:userId      - change a member's role (team LEAD only)
 *   DELETE /organizations/:id/teams/:teamId/members/:userId      - remove a member (team LEAD only)
 *
 * GUARD ORDER: `JwtAuthGuard` -> `OrganizationMembershipGuard` (applied at
 * the controller level, since every route here requires org membership) ->
 * `TeamGuard` on routes with a `:teamId` (verifies the team really belongs
 * to this organization) -> `TeamLeadGuard` on mutation routes. Each guard
 * depends on data the previous one attached to the request, so this order
 * is load-bearing, not cosmetic.
 *
 * WHY the route prefix repeats `:id` (matching `OrganizationsController`,
 * not `:organizationId`): `OrganizationMembershipGuard` reads
 * `request.params.id` directly. Keeping the same param name here means the
 * exact same guard class works on both controllers with zero changes.
 *
 * SCOPE NOTE: as with organizations, there's no generalized RBAC yet - only
 * "team LEAD" vs "everyone else" is distinguished. An organization ADMIN
 * has no special override power over a team they don't lead. That's a
 * reasonable gap for this phase, not an oversight - see
 * docs/phase-05-concepts.md.
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
  @UseGuards(TeamGuard, TeamLeadGuard)
  update(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(teamId, dto.name);
  }

  @Delete(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TeamGuard, TeamLeadGuard)
  remove(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teamsService.remove(teamId);
  }

  @Get(':teamId/members')
  @UseGuards(TeamGuard)
  listMembers(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teamsService.listMembers(teamId);
  }

  @Post(':teamId/members')
  @UseGuards(TeamGuard, TeamLeadGuard)
  addMember(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(organizationId, teamId, dto);
  }

  @Patch(':teamId/members/:userId')
  @UseGuards(TeamGuard, TeamLeadGuard)
  updateMemberRole(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateTeamMemberRoleDto,
  ) {
    return this.teamsService.updateMemberRole(teamId, userId, dto.role);
  }

  @Delete(':teamId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TeamGuard, TeamLeadGuard)
  removeMember(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.teamsService.removeMember(teamId, userId);
  }
}
