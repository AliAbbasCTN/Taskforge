import { IsJWT } from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `POST /auth/refresh`.
 *
 * WHY `@IsJWT()`: a refresh token is structurally a JWT (three
 * dot-separated, base64url-encoded segments) even before we check its
 * signature. Rejecting anything that isn't even shaped like a JWT means
 * obviously-garbage input never reaches the more expensive signature
 * verification step in AuthService.
 */
export class RefreshTokenDto {
  @IsJWT({ message: 'refreshToken must be a valid JWT' })
  refreshToken!: string;
}
