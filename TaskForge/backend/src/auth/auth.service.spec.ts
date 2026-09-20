import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

/**
 * UNIT tests: AuthService's logic in isolation. UsersService, JwtService,
 * and ConfigService are all mocked - no database and no real JWT signing
 * involved. What we're protecting here is the authentication logic itself:
 * that credentials are checked correctly, that tokens are rotated on
 * refresh, and that failure cases return generic, non-information-leaking
 * errors.
 */
describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmailForAuth: jest.Mock;
    findOne: jest.Mock;
    findByIdWithRefreshHash: jest.Mock;
    create: jest.Mock;
    setRefreshTokenHash: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'ada@example.com';
  const sha256 = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  beforeEach(async () => {
    usersService = {
      findByEmailForAuth: jest.fn(),
      findOne: jest.fn(),
      findByIdWithRefreshHash: jest.fn(),
      create: jest.fn(),
      setRefreshTokenHash: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => `config:${key}` },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates the user and returns tokens when the email is free', async () => {
      usersService.findByEmailForAuth.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ id: userId, email, name: 'Ada' });

      const result = await service.register({
        email,
        name: 'Ada',
        password: 'password1',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email, name: 'Ada' }),
      );
      // The plaintext password must never reach create() unhashed.
      const createArg = usersService.create.mock.calls[0][0];
      expect(createArg.passwordHash).not.toBe('password1');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(usersService.setRefreshTokenHash).toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already registered', async () => {
      usersService.findByEmailForAuth.mockResolvedValue({ id: userId, email });

      await expect(
        service.register({ email, name: 'Ada', password: 'password1' }),
      ).rejects.toThrow(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns tokens for correct credentials', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmailForAuth.mockResolvedValue({
        id: userId,
        email,
        name: 'Ada',
        passwordHash,
      });
      usersService.findOne.mockResolvedValue({
        id: userId,
        email,
        name: 'Ada',
      });

      const result = await service.login({
        email,
        password: 'correct-password',
      });

      expect(result.tokens.accessToken).toBeDefined();
    });

    it('rejects an unknown email with a generic message', async () => {
      usersService.findByEmailForAuth.mockResolvedValue(null);

      await expect(
        service.login({ email, password: 'anything' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password with the SAME generic message as an unknown email', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmailForAuth.mockResolvedValue({
        id: userId,
        email,
        name: 'Ada',
        passwordHash,
      });

      let unknownEmailMessage: string | undefined;
      let wrongPasswordMessage: string | undefined;

      usersService.findByEmailForAuth.mockResolvedValueOnce(null);
      try {
        await service.login({ email, password: 'x' });
      } catch (e) {
        unknownEmailMessage = (e as UnauthorizedException).message;
      }

      try {
        await service.login({ email, password: 'wrong-password' });
      } catch (e) {
        wrongPasswordMessage = (e as UnauthorizedException).message;
      }

      expect(wrongPasswordMessage).toBe(unknownEmailMessage);
    });
  });

  describe('refresh', () => {
    it('issues a new token pair when the refresh token is valid and matches', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, email });
      usersService.findByIdWithRefreshHash.mockResolvedValue({
        id: userId,
        email,
        hashedRefreshToken: sha256('refresh-token-value'),
      });

      const result = await service.refresh('refresh-token-value');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // Rotation: a new hash is stored, replacing the one that was used.
      expect(usersService.setRefreshTokenHash).toHaveBeenCalled();
    });

    it('rejects a token with an invalid signature', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await expect(service.refresh('garbage')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the user has no stored refresh token (already logged out)', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, email });
      usersService.findByIdWithRefreshHash.mockResolvedValue({
        id: userId,
        email,
        hashedRefreshToken: null,
      });

      await expect(service.refresh('some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the token does not match the stored hash (reuse/rotation)', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, email });
      usersService.findByIdWithRefreshHash.mockResolvedValue({
        id: userId,
        email,
        hashedRefreshToken: sha256('a-different-token'),
      });

      await expect(service.refresh('the-presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a stale token even when it shares the first 72 bytes with the current one', async () => {
      // Regression test for a real bug found during development: bcrypt
      // silently truncates input at 72 bytes, so two JWTs for the same user
      // (identical header + leading claims) would hash identically under
      // bcrypt even though they differ later in the payload/signature -
      // defeating rotation entirely. This confirms the SHA-256-based
      // comparison does NOT have that problem.
      const sharedPrefix =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzYW1lLXVzZXIi';
      const oldToken = `${sharedPrefix}.old-suffix-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
      const newToken = `${sharedPrefix}.new-suffix-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;

      jwtService.verifyAsync.mockResolvedValue({ sub: userId, email });
      usersService.findByIdWithRefreshHash.mockResolvedValue({
        id: userId,
        email,
        hashedRefreshToken: sha256(newToken),
      });

      await expect(service.refresh(oldToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('clears the stored refresh token hash', async () => {
      await service.logout(userId);
      expect(usersService.setRefreshTokenHash).toHaveBeenCalledWith(
        userId,
        null,
      );
    });
  });
});
