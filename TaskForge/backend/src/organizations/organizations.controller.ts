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
import {
  CurrentMembership,
  RequestMembership,
} from './decorators/current-membership.decorator';
import { OrganizationMembershipGuard } from './guards/organization-membership.guard';
import { OrganizationAdminGuard } from './guards/organization-admin.guard';
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
 *   PATCH  /organizations/:id                     - rename an org (admins only)
 *   GET    /organizations/:id/members             - list members (members only)
 *   POST   /organizations/:id/members             - add an existing user (admins only)
 *   PATCH  /organizations/:id/members/:userId      - change a member's role (admins only)
 *   DELETE /organizations/:id/members/:userId      - remove a member (admins only)
 *
 * GUARD ORDER MATTERS: `JwtAuthGuard` must run first (it populates
 * `request.user`), then `OrganizationMembershipGuard` (it populates
 * `request.membership` and enforces tenant isolation), then
 * `OrganizationAdminGuard` where a route additionally requires the ADMIN
 * role. NestJS runs guards in the order listed, so this order is not
 * cosmetic - swapping it would break the checks.
 *
 * KNOWN DEFERRED FEATURE: there's no "leave organization" (self-removal)
 * endpoint yet - only an admin can remove a member, including removing
 * themselves (subject to the "can't remove the last admin" rule in the
 * service). Self-service leaving is a reasonable follow-up, deliberately
 * left out to keep this phase focused on the core tenant-isolation
 * mechanics.
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
  @UseGuards(OrganizationMembershipGuard, OrganizationAdminGuard)
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
  @UseGuards(OrganizationMembershipGuard, OrganizationAdminGuard)
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.organizationsService.addMember(id, dto);
  }

  @Patch(':id/members/:userId')
  @UseGuards(OrganizationMembershipGuard, OrganizationAdminGuard)
  updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationMembershipGuard, OrganizationAdminGuard)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.organizationsService.removeMember(id, userId);
  }
}
