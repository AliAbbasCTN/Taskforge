import {
  ApiBearerAuth,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiEndpoint,
  BEARER_AUTH_NAME,
  ErrorResponseDto,
} from '../common/swagger';
import {
  AuthResponse,
  AuthTokensResponse,
  UserResponse,
} from '../docs/models';
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
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @ApiEndpoint({
    summary: 'Create an account',
    description: 'Creates the account and signs you in. Passwords must be 8-72 characters with at least one letter and one number. The password is stored only as a bcrypt hash.',
    created: AuthResponse,
    conflict: 'An account with this email already exists.',
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Log in',
    description: 'Exchanges an email and password for an access token and a refresh token. The same generic 401 is returned for an unknown email and a wrong password, so the response does not reveal which accounts exist.',
    ok: AuthResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Wrong email or password.',
    type: ErrorResponseDto,
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Refresh the token pair',
    description: 'Exchanges a refresh token for a NEW access token and a NEW refresh token. Refresh tokens are single-use (rotation): presenting an old one fails, which also limits what a stolen token is worth.',
    ok: AuthTokensResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'The refresh token is invalid, expired, already used, or the user logged out.',
    type: ErrorResponseDto,
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Logging out also closes the user's live sockets (every tab and device).
  @Post('logout')
  @DisconnectsUserSockets()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiEndpoint({
    summary: 'Log out',
    description: 'Invalidates the current refresh token and closes the user\'s live WebSocket connections on every device. The access token stays valid until it expires (at most 15 minutes).',
    noContent: 'Logged out.',
  })
  @ApiBearerAuth(BEARER_AUTH_NAME)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiEndpoint({
    summary: 'Get your own profile',
    description: 'Reads the current profile from the database (the token itself carries only an id and email).',
    ok: UserResponse,
  })
  @ApiBearerAuth(BEARER_AUTH_NAME)
  me(@CurrentUser() user: AuthenticatedUser) {
    // JwtStrategy only decodes the token payload (id + email) - it doesn't
    // hit the database on every request (see jwt.strategy.ts for why). This
    // route is where a client actually gets the user's current, fresh
    // profile when it needs it, with one explicit database read. Looking up
    // your own id always succeeds regardless of shared organizations.
    return this.usersService.findOne(user.id, user.id);
  }
}
