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
import {
  CurrentMembership,
  RequestMembership,
} from './decorators/current-membership.decorator';
import { OrganizationMembershipGuard } from './guards/organization-membership.guard';
import { OrganizationPermissionGuard } from './guards/organization-permission.guard';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

/**
 * WHAT: HTTP routes for organizations (tenants) and their memberships.
 *
 * WHERE:
 *   POST   /organizations                       - create an org (you become its ADMIN)
 *   GET    /organizations                        - list organizations YOU belong to
 *   GET    /organizations/:id                     - org details (members only)
 *   PATCH  /organizations/:id                     - rename an org (requires organization:manage)
 *   GET    /organizations/:id/members             - list members (members only)
 *   POST   /organizations/:id/members             - add an existing user (requires organization:members:manage)
 *   PATCH  /organizations/:id/members/:userId      - change a member's role (requires organization:members:manage)
 *   DELETE /organizations/:id/members/:userId      - remove a member (requires organization:members:manage)
 *
 * GUARD ORDER MATTERS: `JwtAuthGuard` must run first (it populates
 * `request.user`), then `OrganizationMembershipGuard` (it populates
 * `request.membership` and enforces tenant isolation), then
 * `OrganizationPermissionGuard` where a route additionally requires a
 * specific permission (declared via `@RequirePermission(...)`). NestJS
 * runs guards in the order listed, so this order is not cosmetic - swapping
 * it would break the checks.
 *
 * PHASE 06 CHANGE: `OrganizationAdminGuard` (Phase 04, a single hardcoded
 * "must be ADMIN" check) is now `OrganizationPermissionGuard`, driven by
 * `@RequirePermission(...)`. Currently, only ADMIN holds
 * `organization:manage` and `organization:members:manage` (see
 * `organization-permissions.ts`) - so the practical behaviour of these
 * routes is unchanged from Phase 04. What changed is that MANAGER now
 * exists as a real, distinct role with its own (different) permissions -
 * see `TeamsController` for where MANAGER actually diverges from MEMBER.
 *
 * KNOWN DEFERRED FEATURE: there's no "leave organization" (self-removal)
 * endpoint yet - only someone with `organization:members:manage` can remove
 * a member, including removing themselves (subject to the "can't remove
 * the last admin" rule in the service).
 */
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.organizationsService.create(dto.name, user.id);
  }

  @Get()
  findAllForUser(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.findAllForUser(user.id);
  }

  @Get(':id')
  @UseGuards(OrganizationMembershipGuard)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentMembership() membership: RequestMembership,
  ) {
    const organization = await this.organizationsService.findOne(id);
    return { ...organization, role: membership.role };
  }

  @Patch(':id')
  @RequirePermission(Permission.OrganizationManage)
  @UseGuards(OrganizationMembershipGuard, OrganizationPermissionGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(id, dto);
  }

  @Get(':id/members')
  @UseGuards(OrganizationMembershipGuard)
  listMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.listMembers(id);
  }

  @Post(':id/members')
  @RequirePermission(Permission.OrganizationMembersManage)
  @UseGuards(OrganizationMembershipGuard, OrganizationPermissionGuard)
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.organizationsService.addMember(id, dto);
  }

  @Patch(':id/members/:userId')
  @RequirePermission(Permission.OrganizationMembersManage)
  @UseGuards(OrganizationMembershipGuard, OrganizationPermissionGuard)
  updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.OrganizationMembersManage)
  @UseGuards(OrganizationMembershipGuard, OrganizationPermissionGuard)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.organizationsService.removeMember(id, userId);
  }
}
