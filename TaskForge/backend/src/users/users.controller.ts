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
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.findOne(id, currentUser.id);
  }

  @Patch(':id')
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
