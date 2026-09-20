import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * WHAT: The shape attached to `request.user` after a request passes through
 * `JwtAuthGuard`. It intentionally carries only what was inside the JWT
 * payload, NOT a fresh database read - see jwt.strategy.ts for why.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

/**
 * WHAT: A parameter decorator that pulls the authenticated user off the
 * request inside a controller method.
 *
 * WHY: Without this, every protected controller method would repeat
 * `req.user` and cast it manually. This gives the same information with a
 * proper type and a clean, declarative signature:
 *
 *   @Get('me')
 *   getProfile(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * WHERE: Only meaningful on routes protected by `JwtAuthGuard` - Passport's
 * JWT strategy is what populates `request.user` in the first place.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
