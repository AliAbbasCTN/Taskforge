import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { SafeUser, UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// bcrypt's "work factor" - how many rounds of hashing it performs. Higher is
// slower (which is the point: it makes brute-forcing stolen hashes
// expensive) but also slower for legitimate logins. 12 is a widely-used,
// well-tested balance for a service like this in 2026 hardware terms.
const BCRYPT_SALT_ROUNDS = 12;

/**
 * WHAT: The core authentication logic - registration, login, refresh token
 * rotation, and logout.
 *
 * WHERE: Injected into `AuthController`.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const existing = await this.usersService.findByEmailForAuth(dto.email);
    if (existing) {
      // Same message as UsersService would produce via the database unique
      // constraint - checked here too so we can fail before hashing a
      // password we're not going to use, saving a relatively expensive
      // bcrypt call on an already-doomed request.
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { user, tokens };
  }

  async login(dto: LoginDto): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const record = await this.usersService.findByEmailForAuth(dto.email);

    // Deliberately the SAME error for "no such email" and "wrong password".
    // Returning a different message for each (e.g. "email not found" vs
    // "wrong password") lets an attacker enumerate which emails are
    // registered on the platform, one guess at a time.
    const invalidCredentials = () =>
      new UnauthorizedException('Invalid email or password');

    if (!record) {
      throw invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      record.passwordHash,
    );
    if (!passwordMatches) {
      throw invalidCredentials();
    }

    const user = await this.usersService.findOne(record.id, record.id);
    const tokens = await this.issueTokens(user.id, user.email);
    return { user, tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const invalidToken = () =>
      new UnauthorizedException('Invalid or expired refresh token');

    let payload: { sub: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      // Covers both a malformed/tampered signature and a genuinely expired
      // token - the caller doesn't need to distinguish these, they just
      // need to log in again either way.
      throw invalidToken();
    }

    const user = await this.usersService.findByIdWithRefreshHash(payload.sub);

    // No stored hash means this user is currently logged out (or was never
    // logged in) - a structurally valid, correctly-signed token can still
    // reach this point if it hasn't expired yet but the user already logged
    // out elsewhere.
    if (!user || !user.hashedRefreshToken) {
      throw invalidToken();
    }

    const tokenMatches = this.compareTokenToHash(
      refreshToken,
      user.hashedRefreshToken,
    );
    if (!tokenMatches) {
      // The token is validly signed and not expired, but doesn't match what
      // we have stored. This happens if a refresh token was already used
      // once (rotation invalidates it) - which is exactly the "reused
      // refresh token" signal that can indicate a stolen token being
      // replayed. We respond identically either way; see
      // docs/phase-03-concepts.md for why we don't try to do more here yet.
      throw invalidToken();
    }

    // Rotation: every successful refresh issues a brand new refresh token
    // and invalidates the old one, rather than reusing the same refresh
    // token indefinitely. If a refresh token is ever stolen, the legitimate
    // user's next refresh will fail (their token was already replaced by
    // the attacker's use of it) - a visible signal that something is wrong,
    // rather than silence.
    return this.issueTokens(user.id, user.email);
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    // `jti` (JWT ID) is a unique identifier for this specific token, not the
    // user. Without it, two tokens signed for the same user within the same
    // second would be byte-for-byte identical (same payload, same `iat`
    // second, same secret => same signature) - which would silently defeat
    // refresh token rotation, since "issue a new token" wouldn't actually
    // produce a new one. `jti` also gives us a natural hook for a future
    // token-revocation list, if TaskForge ever needs to invalidate a
    // specific token before it expires.
    const payload = { sub: userId, email, jti: randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);

    // We store a HASH of the refresh token, not the token itself - if the
    // database were ever leaked, the stored value alone cannot be replayed
    // to authenticate as this user.
    //
    // This is intentionally SHA-256, not bcrypt, even though we use bcrypt
    // for passwords a few lines above. That's not an inconsistency - it's
    // using the right tool for two genuinely different problems:
    //
    //  - Passwords are LOW-ENTROPY secrets a human chose. bcrypt's whole
    //    purpose is to be deliberately slow, so brute-forcing millions of
    //    likely passwords against a stolen hash is expensive.
    //  - A refresh token is a HIGH-ENTROPY secret we generated (a signed
    //    JWT). There is nothing to brute-force - guessing it is
    //    computationally infeasible either way - so bcrypt's slowness buys
    //    us nothing here.
    //  - Worse, bcrypt SILENTLY TRUNCATES input longer than 72 bytes. A JWT
    //    is well over 72 characters, and two tokens issued to the same user
    //    moments apart share an identical first 72 bytes (same header, same
    //    `sub`/`email` claims first) even though they differ later in the
    //    payload and signature. `bcrypt.compare()` would then report a
    //    rotated, no-longer-valid token as a MATCH - defeating rotation
    //    entirely. (This is exactly the bug the e2e test for token reuse
    //    caught during development - see docs/phase-03-concepts.md.)
    //
    // SHA-256 has no length limit or truncation, is fast (which is fine -
    // there's no brute-force risk to slow down), and produces a fixed-length
    // digest we compare with a timing-safe comparison to avoid leaking
    // timing information about how much of the hash matched.
    const hashedRefreshToken = this.hashToken(refreshToken);
    await this.usersService.setRefreshTokenHash(userId, hashedRefreshToken);

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private compareTokenToHash(token: string, hash: string): boolean {
    const tokenHash = this.hashToken(token);
    // A plain `===` comparison on secret values can, in principle, leak
    // timing information (how many leading bytes matched) to an attacker
    // measuring response times very precisely. `timingSafeEqual` compares
    // in constant time regardless of where the first difference occurs.
    const a = Buffer.from(tokenHash);
    const b = Buffer.from(hash);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
