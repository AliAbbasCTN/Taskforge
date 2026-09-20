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
} from '../common/filters/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/**
 * WHAT: HTTP routes for user records.
 *
 * WHERE:
 *   GET    /users
 *   GET    /users/:id
 *   PATCH  /users/:id
 *   DELETE /users/:id
 *
 * SECURITY NOTES:
 * - There is no `POST /users` here. Account creation happens exclusively
 *   through `POST /auth/register`, which owns password hashing - a "create
 *   a user" endpoint that doesn't require a password would be a serious
 *   security hole now that accounts have passwords at all.
 * - Every route requires a valid access token (`JwtAuthGuard`).
 * - `PATCH` and `DELETE` additionally require the authenticated user to be
 *   modifying their OWN account. This is a basic resource-ownership check -
 *   full role-based authorization (so an admin could manage other users)
 *   arrives with RBAC in Phase 06.
 * - `GET /users` and `GET /users/:id` are open to any authenticated user for
 *   now, with no organization-level restriction yet. This is intentional
 *   and temporary: Phase 04 introduces organizations and scopes this list
 *   to "users in my organization" rather than every user on the platform.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
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
