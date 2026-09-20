import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../common/filters/decorators/current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * WHAT: A Passport strategy that verifies access tokens on incoming
 * requests.
 *
 * WHY Passport at all, rather than checking the header by hand: Passport
 * standardizes "extract a credential from the request, verify it, attach
 * the result to `request.user`" across every auth method an app might ever
 * need (JWT here; later possibly OAuth, API keys, etc.), and NestJS wires it
 * into guards cleanly via `AuthGuard('jwt')`.
 *
 * WHERE: Registered as a provider in `AuthModule`. Used implicitly by
 * `JwtAuthGuard` on every `@UseGuards(JwtAuthGuard)` route.
 *
 * HOW: `validate()` runs only AFTER Passport has already verified the JWT's
 * signature and expiry using `secretOrKey`. We deliberately do NOT query the
 * database here on every request - doing so would mean an extra database
 * round-trip on every single authenticated API call, just to fetch data
 * (email) that's already sitting right there in the token payload. The
 * trade-off: if a user is deleted, their still-valid access token continues
 * to work until it naturally expires (at most JWT_ACCESS_EXPIRES_IN, 15
 * minutes by default). That's an accepted, deliberate trade-off given how
 * short-lived access tokens are - not an oversight.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return { id: payload.sub, email: payload.email };
  }
}
