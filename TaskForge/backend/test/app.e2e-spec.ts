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
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => {
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
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
    it('rejects GET /users/:id with 401', async () => {
      // Register just to get a well-formed UUID to request - the 401 from
      // the guard should fire before the controller even looks at the id.
      const someId = '11111111-1111-4111-8111-111111111111';
      return request(app.getHttpServer()).get(`/users/${someId}`).expect(401);
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

    it('GET /users (platform-wide list) no longer exists (404) - see Phase 04 note', async () => {
      // This route was intentionally removed in Phase 04: once
      // organizations exist, "list every user on the platform" is a
      // tenant-isolation leak, not a convenience. See
      // docs/phase-04-concepts.md and users.controller.ts.
      const { tokens } = await registerAndLogin();

      return request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(404);
    });

    it('GET /users/:id returns your own profile', async () => {
      const { tokens, userId } = await registerAndLogin();

      return request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.id).toBe(userId);
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

  describe('Organizations', () => {
    async function registerAndLogin(email: string, name = 'User') {
      const res = await registerUser({
        email,
        name,
        password: 'password1',
      }).expect(201);
      return {
        userId: res.body.user.id as string,
        accessToken: res.body.tokens.accessToken as string,
      };
    }

    const authed = (token: string) => `Bearer ${token}`;

    it('rejects creating an organization without a token', () => {
      return request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme' })
        .expect(401);
    });

    it('creates an organization and makes the creator its ADMIN', async () => {
      const { accessToken } = await registerAndLogin('founder@example.com');

      const res = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Acme Inc.' })
        .expect(201);

      expect(res.body.name).toBe('Acme Inc.');
      expect(res.body.slug).toBe('acme-inc');
      expect(res.body.role).toBe('ADMIN');
    });

    it('generates distinct slugs for organizations with the same name', async () => {
      const { accessToken: t1 } = await registerAndLogin('one@example.com');
      const { accessToken: t2 } = await registerAndLogin('two@example.com');

      const first = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(t1))
        .send({ name: 'Acme' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(t2))
        .send({ name: 'Acme' })
        .expect(201);

      expect(first.body.slug).toBe('acme');
      expect(second.body.slug).not.toBe('acme');
      expect(second.body.slug.startsWith('acme-')).toBe(true);
    });

    it('GET /organizations lists only organizations you belong to', async () => {
      const { accessToken: t1 } = await registerAndLogin('one@example.com');
      const { accessToken: t2 } = await registerAndLogin('two@example.com');

      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(t1))
        .send({ name: 'Org One' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(t2))
        .send({ name: 'Org Two' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', authed(t1))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Org One');
    });

    it('THE CORE TENANT-ISOLATION TEST: a non-member gets 404, not 403, on GET /organizations/:id', async () => {
      const { accessToken: ownerToken } =
        await registerAndLogin('owner@example.com');
      const { accessToken: outsiderToken } = await registerAndLogin(
        'outsider@example.com',
      );

      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(ownerToken))
        .send({ name: 'Private Org' })
        .expect(201);

      // The owner can see it.
      await request(app.getHttpServer())
        .get(`/organizations/${org.body.id}`)
        .set('Authorization', authed(ownerToken))
        .expect(200);

      // An outsider gets exactly the same response as a nonexistent ID -
      // 404, never 403 - so the lookup doesn't confirm the org even exists.
      await request(app.getHttpServer())
        .get(`/organizations/${org.body.id}`)
        .set('Authorization', authed(outsiderToken))
        .expect(404);
    });

    it('rejects GET /organizations/:id without a token', async () => {
      const { accessToken } = await registerAndLogin('owner@example.com');
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Org' })
        .expect(201);

      return request(app.getHttpServer())
        .get(`/organizations/${org.body.id}`)
        .expect(401);
    });

    it('a non-admin member cannot rename the organization (403)', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: memberToken, userId: memberUserId } =
        await registerAndLogin('member@example.com');

      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(adminToken))
        .send({ name: 'Org' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/organizations/${org.body.id}`)
        .set('Authorization', authed(memberToken))
        .send({ name: 'Hijacked Name' })
        .expect(403);

      // Sanity: the member really was added and really is a member (can
      // read, just can't rename) - confirms 403 was an authorization
      // decision, not an accidental membership failure.
      const membersRes = await request(app.getHttpServer())
        .get(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(memberToken))
        .expect(200);
      expect(
        membersRes.body.some(
          (m: { user: { id: string } }) => m.user.id === memberUserId,
        ),
      ).toBe(true);
    });

    it('an admin can rename the organization', async () => {
      const { accessToken } = await registerAndLogin('admin@example.com');
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Old Name' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/organizations/${org.body.id}`)
        .set('Authorization', authed(accessToken))
        .send({ name: 'New Name' })
        .expect(200);

      expect(res.body.name).toBe('New Name');
    });

    it('adding a member who has no TaskForge account returns 404', async () => {
      const { accessToken } = await registerAndLogin('admin@example.com');
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Org' })
        .expect(201);

      return request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(accessToken))
        .send({ email: 'nobody-registered@example.com' })
        .expect(404);
    });

    it('adding the same member twice returns 409', async () => {
      const { accessToken } = await registerAndLogin('admin@example.com');
      await registerAndLogin('member@example.com');
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Org' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(accessToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      return request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(accessToken))
        .send({ email: 'member@example.com' })
        .expect(409);
    });

    it('a non-admin cannot add members (403)', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: memberToken } =
        await registerAndLogin('member@example.com');
      await registerAndLogin('target@example.com');

      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(adminToken))
        .send({ name: 'Org' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      return request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(memberToken))
        .send({ email: 'target@example.com' })
        .expect(403);
    });

    it('THE LAST-ADMIN SAFETY RAIL: refuses to remove the only admin, even by themselves', async () => {
      const { accessToken, userId } = await registerAndLogin(
        'sole-admin@example.com',
      );
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Org' })
        .expect(201);

      return request(app.getHttpServer())
        .delete(`/organizations/${org.body.id}/members/${userId}`)
        .set('Authorization', authed(accessToken))
        .expect(409);
    });

    it('allows removing an admin when a second admin exists', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: secondToken, userId: secondUserId } =
        await registerAndLogin('second@example.com');

      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(adminToken))
        .send({ name: 'Org' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'second@example.com', role: 'ADMIN' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/organizations/${org.body.id}/members/${secondUserId}`)
        .set('Authorization', authed(adminToken))
        .expect(204);

      // The removed admin has lost access entirely - confirms removal was real.
      return request(app.getHttpServer())
        .get(`/organizations/${org.body.id}`)
        .set('Authorization', authed(secondToken))
        .expect(404);
    });

    it('refuses to demote the only remaining admin via role update', async () => {
      const { accessToken, userId } = await registerAndLogin(
        'sole-admin@example.com',
      );
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(accessToken))
        .send({ name: 'Org' })
        .expect(201);

      return request(app.getHttpServer())
        .patch(`/organizations/${org.body.id}/members/${userId}`)
        .set('Authorization', authed(accessToken))
        .send({ role: 'MEMBER' })
        .expect(409);
    });

    it('Phase 03 regression: a member of Org A cannot look up a user who is ONLY in Org B', async () => {
      const { accessToken: aToken } = await registerAndLogin(
        'a-admin@example.com',
      );
      const { userId: bUserId } = await registerAndLogin('b-admin@example.com');

      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(aToken))
        .send({ name: 'Org A' })
        .expect(201);

      // No shared organization between the two users.
      return request(app.getHttpServer())
        .get(`/users/${bUserId}`)
        .set('Authorization', authed(aToken))
        .expect(404);
    });

    it('Phase 03 fix confirmed: users who share an organization CAN look each other up', async () => {
      const { accessToken: adminToken, userId: adminUserId } =
        await registerAndLogin('admin2@example.com');
      const { userId: memberUserId } = await registerAndLogin(
        'member2@example.com',
      );

      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(adminToken))
        .send({ name: 'Shared Org' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'member2@example.com' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/users/${memberUserId}`)
        .set('Authorization', authed(adminToken))
        .expect(200);

      expect(res.body.id).toBe(memberUserId);
      expect(adminUserId).not.toBe(memberUserId);
    });
  });
});
