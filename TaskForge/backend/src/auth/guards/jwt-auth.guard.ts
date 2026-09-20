import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * WHAT: A guard that requires a valid access token on the request.
 *
 * WHY it's this thin: `AuthGuard('jwt')` already does the real work by
 * running `JwtStrategy` (registered under the default 'jwt' name) against
 * the request. Wrapping it in a named class rather than writing
 * `@UseGuards(AuthGuard('jwt'))` everywhere gives every protected route the
 * same readable, greppable `@UseGuards(JwtAuthGuard)` and gives us one place
 * to extend later (e.g. adding `@Public()` route bypassing, if TaskForge
 * ever needs it).
 *
 * WHERE: Applied to any route that requires a signed-in user - see
 * `users.controller.ts` and `auth.controller.ts` (the `/auth/me` and
 * `/auth/logout` routes).
 *
 * HOW: If the token is missing, malformed, expired, or has an invalid
 * signature, this guard throws a 401 Unauthorized before the route handler
 * ever runs.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
