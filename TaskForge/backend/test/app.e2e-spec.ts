import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * END-TO-END tests: boot the real application and issue real HTTP requests
 * against a REAL PostgreSQL database. These prove the pieces are actually
 * wired together - routing, validation, guards, the exception filter, the
 * Prisma connection, and the database constraints themselves.
 */
describe('TaskForge backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const registerUser = (
    overrides: Partial<{ email: string; name: string; password: string }> = {},
  ) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: overrides.email ?? 'ada@example.com',
        name: overrides.name ?? 'Ada Lovelace',
        password: overrides.password ?? 'password1',
      });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('GET /health', () => {
    it('reports ok and a reachable database', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.dependencies.database).toBe('up');
        });
    });
  });

  describe('POST /auth/register', () => {
    it('creates an account and returns a token pair, never the password hash', async () => {
      const res = await registerUser().expect(201);

      expect(res.body.user.email).toBe('ada@example.com');
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.tokens.accessToken).toEqual(expect.any(String));
      expect(res.body.tokens.refreshToken).toEqual(expect.any(String));
    });

    it('rejects a weak password (no digit)', () => {
      return registerUser({ password: 'onlyletters' }).expect(400);
    });

    it('rejects a short password', () => {
      return registerUser({ password: 'ab1' }).expect(400);
    });

    it('rejects an invalid email', () => {
      return registerUser({ email: 'not-an-email' }).expect(400);
    });

    it('returns 409 when the email is already registered', async () => {
      await registerUser({ email: 'dup@example.com' }).expect(201);
      return registerUser({ email: 'dup@example.com' }).expect(409);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a fresh token pair for correct credentials', async () => {
      await registerUser({
        email: 'grace@example.com',
        password: 'correcthorse1',
      }).expect(201);

      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'grace@example.com', password: 'correcthorse1' })
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.tokens.accessToken).toEqual(expect.any(String));
        });
    });

    it('returns 401 for a wrong password', async () => {
      await registerUser({
        email: 'grace@example.com',
        password: 'correcthorse1',
      }).expect(201);

      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'grace@example.com', password: 'wrongpassword1' })
        .expect(401);
    });

    it('returns 401 for an email that was never registered, with the same message as a wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever1' })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  describe('protected routes without a token', () => {
    it('rejects GET /users with 401', () => {
      return request(app.getHttpServer()).get('/users').expect(401);
    });

    it('rejects GET /auth/me with 401', () => {
      return request(app.getHttpServer()).get('/auth/me').expect(401);
    });
  });

  describe('authenticated flows', () => {
    async function registerAndLogin(
      email = 'alan@example.com',
      password = 'turing1234',
    ) {
      const res = await registerUser({
        email,
        name: 'Alan Turing',
        password,
      }).expect(201);
      return { userId: res.body.user.id as string, tokens: res.body.tokens };
    }

    it('GET /auth/me returns the authenticated user profile', async () => {
      const { tokens, userId } = await registerAndLogin();

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(userId);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('rejects a malformed access token with 401', () => {
      return request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('GET /users lists users once authenticated', async () => {
      const { tokens } = await registerAndLogin();

      return request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body).toHaveLength(1);
        });
    });

    it('allows a user to update their own profile', async () => {
      const { tokens, userId } = await registerAndLogin();

      return request(app.getHttpServer())
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ name: 'A. Turing' })
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.name).toBe('A. Turing');
        });
    });

    it('forbids a user from updating a DIFFERENT user (403)', async () => {
      const first = await registerAndLogin('alan@example.com');
      const second = await registerAndLogin('grace@example.com');

      return request(app.getHttpServer())
        .patch(`/users/${second.userId}`)
        .set('Authorization', `Bearer ${first.tokens.accessToken}`)
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('forbids a user from deleting a DIFFERENT user (403)', async () => {
      const first = await registerAndLogin('alan@example.com');
      const second = await registerAndLogin('grace@example.com');

      return request(app.getHttpServer())
        .delete(`/users/${second.userId}`)
        .set('Authorization', `Bearer ${first.tokens.accessToken}`)
        .expect(403);
    });

    it('allows a user to delete their own account', async () => {
      const { tokens, userId } = await registerAndLogin();

      await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(204);

      const stored = await prisma.user.findUnique({ where: { id: userId } });
      expect(stored).toBeNull();
    });
  });

  describe('POST /auth/refresh', () => {
    it('issues a new token pair for a valid refresh token', async () => {
      const register = await registerUser({ email: 'ada@example.com' }).expect(
        201,
      );
      const { refreshToken } = register.body.tokens;

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).not.toBe(refreshToken);
    });

    it('rejects a refresh token that was already rotated (reused)', async () => {
      const register = await registerUser({ email: 'ada@example.com' }).expect(
        201,
      );
      const { refreshToken } = register.body.tokens;

      // Use it once - this rotates it.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Using the SAME (now-stale) token again must fail.
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('rejects a malformed refresh token with 400 (fails validation, not auth)', () => {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-jwt' })
        .expect(400);
    });
  });

  describe('POST /auth/logout', () => {
    it('invalidates the refresh token', async () => {
      const register = await registerUser({ email: 'ada@example.com' }).expect(
        201,
      );
      const { accessToken, refreshToken } = register.body.tokens;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('requires authentication', () => {
      return request(app.getHttpServer()).post('/auth/logout').expect(401);
    });
  });
});
