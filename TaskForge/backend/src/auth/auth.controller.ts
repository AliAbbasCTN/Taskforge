import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DisconnectsUserSockets } from '../realtime/realtime.decorators';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';

/**
 * WHAT: HTTP routes for authentication.
 *
 * WHERE:
 *   POST /auth/register  - create an account, returns tokens
 *   POST /auth/login     - exchange credentials for tokens
 *   POST /auth/refresh   - exchange a refresh token for a new token pair
 *   POST /auth/logout    - invalidate the current refresh token (requires auth)
 *   GET  /auth/me         - the authenticated user's own profile (requires auth)
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Logging out also closes the user's live sockets (every tab and device).
  @Post('logout')
  @DisconnectsUserSockets()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    // JwtStrategy only decodes the token payload (id + email) - it doesn't
    // hit the database on every request (see jwt.strategy.ts for why). This
    // route is where a client actually gets the user's current, fresh
    // profile when it needs it, with one explicit database read. Looking up
    // your own id always succeeds regardless of shared organizations.
    return this.usersService.findOne(user.id, user.id);
  }
}
