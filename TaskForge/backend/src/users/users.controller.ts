import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiEndpoint,
  BEARER_AUTH_NAME,
  ErrorResponseDto,
} from '../common/swagger';
import {
  UserResponse,
} from '../docs/models';
import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/**
 * WHAT: HTTP routes for user records.
 *
 * WHERE:
 *   GET    /users/:id
 *   PATCH  /users/:id
 *   DELETE /users/:id
 *
 * SECURITY NOTES:
 * - There is no `POST /users` here. Account creation happens exclusively
 *   through `POST /auth/register`.
 * - There is no `GET /users` (list-all) here anymore. It existed in Phase
 *   02/03 when there was no concept of a tenant boundary. Now that
 *   Organizations exist, a flat "every user on the platform" listing would
 *   let any member of one Organization enumerate every user in every OTHER
 *   Organization too - a real tenant-isolation leak, not a hypothetical
 *   one. The org-scoped replacement is `GET /organizations/:id/members`,
 *   which only shows members of an organization you belong to yourself.
 * - `GET /users/:id` now requires the requester to either be viewing their
 *   own profile, or share at least one organization with the target user -
 *   enforced in `UsersService.findOne()`. Anyone else gets a 404 (not 403),
 *   so the lookup doesn't even confirm the ID exists.
 * - `PATCH` and `DELETE` require the authenticated user to be modifying
 *   their OWN account. Full role-based authorization (so an admin could
 *   manage other users) arrives with RBAC in Phase 06.
 */
@ApiTags('Users')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a user',
    description: 'You can read your own profile, or the profile of someone who shares at least one organization with you.',
    ok: UserResponse,
    notFound: 'No such user, or you share no organization with them (the same answer for both, so ids cannot be probed).',
  })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.findOne(id, currentUser.id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update your profile',
    description: 'Only your own account. Changing the email is deliberately not supported.',
    ok: UserResponse,
    notFound: 'No such user.',
  })
  @ApiForbiddenResponse({
    description: 'You tried to modify someone else\'s account.',
    type: ErrorResponseDto,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    this.assertSelf(id, currentUser);
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Delete your account',
    description: 'Permanently deletes your own account. Your memberships are removed; comments and attachments you wrote stay, with the author shown as deleted.',
    noContent: 'Account deleted.',
    notFound: 'No such user.',
  })
  @ApiForbiddenResponse({
    description: 'You tried to delete someone else\'s account.',
    type: ErrorResponseDto,
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    this.assertSelf(id, currentUser);
    return this.usersService.remove(id);
  }

  private assertSelf(targetId: string, currentUser: AuthenticatedUser): void {
    if (targetId !== currentUser.id) {
      throw new ForbiddenException('You can only modify your own account');
    }
  }
}
