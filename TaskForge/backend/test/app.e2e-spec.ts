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
    await prisma.projectMembership.deleteMany();
    await prisma.project.deleteMany();
    await prisma.teamMembership.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.team.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => {
    await prisma.projectMembership.deleteMany();
    await prisma.project.deleteMany();
    await prisma.teamMembership.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.team.deleteMany();
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

  describe('Teams', () => {
    const authed = (token: string) => `Bearer ${token}`;

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

    async function createOrg(token: string, name = 'Org') {
      const res = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(token))
        .send({ name })
        .expect(201);
      return res.body.id as string;
    }

    it('rejects creating a team without a token', async () => {
      const { accessToken } = await registerAndLogin('owner@example.com');
      const orgId = await createOrg(accessToken);

      return request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .send({ name: 'Eng' })
        .expect(401);
    });

    it('an outsider (non-org-member) cannot even reach the teams route (404)', async () => {
      const { accessToken: ownerToken } =
        await registerAndLogin('owner@example.com');
      const { accessToken: outsiderToken } = await registerAndLogin(
        'outsider@example.com',
      );
      const orgId = await createOrg(ownerToken);

      return request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(outsiderToken))
        .expect(404);
    });

    it('creates a team and makes the creator its LEAD', async () => {
      const { accessToken } = await registerAndLogin('owner@example.com');
      const orgId = await createOrg(accessToken);

      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(accessToken))
        .send({ name: 'Engineering' })
        .expect(201);

      expect(res.body.name).toBe('Engineering');

      const members = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${res.body.id}/members`)
        .set('Authorization', authed(accessToken))
        .expect(200);

      expect(members.body).toHaveLength(1);
      expect(members.body[0].role).toBe('LEAD');
    });

    it('ANY org member can see a team they are not personally on', async () => {
      const { accessToken: ownerToken } =
        await registerAndLogin('owner@example.com');
      const { accessToken: memberToken, userId: memberUserId } =
        await registerAndLogin('member@example.com');
      const orgId = await createOrg(ownerToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(ownerToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(ownerToken))
        .send({ name: 'Engineering' })
        .expect(201);

      // memberUserId is an org member but was never added to this team.
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(memberToken))
        .expect(200);

      expect(res.body.id).toBe(team.body.id);
      expect(memberUserId).toBeDefined();
    });

    it('IDOR CHECK: a team ID from a DIFFERENT organization returns 404, even for an org member', async () => {
      const { accessToken: ownerAToken } = await registerAndLogin(
        'owner-a@example.com',
      );
      const { accessToken: ownerBToken } = await registerAndLogin(
        'owner-b@example.com',
      );
      const orgA = await createOrg(ownerAToken, 'Org A');
      const orgB = await createOrg(ownerBToken, 'Org B');

      const teamInB = await request(app.getHttpServer())
        .post(`/organizations/${orgB}/teams`)
        .set('Authorization', authed(ownerBToken))
        .send({ name: 'Team In B' })
        .expect(201);

      // ownerA IS a member of orgA (passes OrganizationMembershipGuard) but
      // tries to access a team that actually belongs to orgB.
      return request(app.getHttpServer())
        .get(`/organizations/${orgA}/teams/${teamInB.body.id}`)
        .set('Authorization', authed(ownerAToken))
        .expect(404);
    });

    it('a non-lead team member cannot rename the team (403)', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      const { accessToken: memberToken } =
        await registerAndLogin('member@example.com');
      const orgId = await createOrg(leadToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      return request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(memberToken))
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('someone NOT on the team at all cannot rename it either (403, not just non-leads)', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      const { accessToken: outsiderInOrgToken } = await registerAndLogin(
        'org-outsider@example.com',
      );
      const orgId = await createOrg(leadToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'org-outsider@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      // org-outsider is a full org member but was never added to this team.
      return request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(outsiderInOrgToken))
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('adding someone who is not an org member returns 422', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      await registerAndLogin('not-in-org@example.com'); // has an account, but never joined this org
      const orgId = await createOrg(leadToken);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      return request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'not-in-org@example.com' })
        .expect(422);
    });

    it('adding an org member to the team succeeds', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      const { userId: memberUserId } =
        await registerAndLogin('member@example.com');
      const orgId = await createOrg(leadToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      expect(res.body.user.id).toBe(memberUserId);
      expect(res.body.role).toBe('MEMBER');
    });

    it('adding the same team member twice returns 409', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      await registerAndLogin('member@example.com');
      const orgId = await createOrg(leadToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      return request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'member@example.com' })
        .expect(409);
    });

    it('THE LAST-LEAD SAFETY RAIL: refuses to remove the only lead, even by themselves', async () => {
      const { accessToken: leadToken, userId: leadUserId } =
        await registerAndLogin('lead@example.com');
      const orgId = await createOrg(leadToken);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      return request(app.getHttpServer())
        .delete(
          `/organizations/${orgId}/teams/${team.body.id}/members/${leadUserId}`,
        )
        .set('Authorization', authed(leadToken))
        .expect(409);
    });

    it('allows removing a lead when a second lead exists', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      const { userId: secondUserId } =
        await registerAndLogin('second@example.com');
      const orgId = await createOrg(leadToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'second@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(leadToken))
        .send({ email: 'second@example.com', role: 'LEAD' })
        .expect(201);

      return request(app.getHttpServer())
        .delete(
          `/organizations/${orgId}/teams/${team.body.id}/members/${secondUserId}`,
        )
        .set('Authorization', authed(leadToken))
        .expect(204);
    });

    it('a lead can rename and delete their own team', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      const orgId = await createOrg(leadToken);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Old Name' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'New Name' })
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.name).toBe('New Name');
        });

      await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(leadToken))
        .expect(204);

      // Confirmed gone - even the org owner/lead now gets 404 for it.
      return request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(leadToken))
        .expect(404);
    });

    it('deleting an organization cascades to delete its teams and team memberships', async () => {
      const { accessToken: leadToken } =
        await registerAndLogin('lead@example.com');
      const orgId = await createOrg(leadToken);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(leadToken))
        .send({ name: 'Engineering' })
        .expect(201);

      // Confirm the team really exists before we verify cascade behaviour.
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(leadToken))
        .expect(200);

      const teamCountBefore = await prisma.team.findMany({
        where: { organizationId: orgId },
      });
      expect(teamCountBefore).toHaveLength(1);

      // There's no DELETE /organizations/:id route yet (Phase 04 didn't add
      // one), so we exercise the cascade directly at the database level to
      // confirm the FK constraint itself is correct - the same constraint
      // that would fire if/when an organization-delete route is added.
      await prisma.organization.delete({ where: { id: orgId } });

      const remainingTeams = await prisma.team.findMany({
        where: { organizationId: orgId },
      });
      expect(remainingTeams).toHaveLength(0);
    });
  });

  describe('RBAC (Phase 06)', () => {
    const authed = (token: string) => `Bearer ${token}`;

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

    async function createOrg(token: string, name = 'Org') {
      const res = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(token))
        .send({ name })
        .expect(201);
      return res.body.id as string;
    }

    async function promoteToManager(
      orgId: string,
      adminToken: string,
      targetUserId: string,
    ) {
      return request(app.getHttpServer())
        .patch(`/organizations/${orgId}/members/${targetUserId}`)
        .set('Authorization', authed(adminToken))
        .send({ role: 'MANAGER' })
        .expect(200);
    }

    it('THE CORE RBAC TEST: a MANAGER can manage a team they did NOT create and are not on', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: managerToken, userId: managerUserId } =
        await registerAndLogin('manager@example.com');
      const orgId = await createOrg(adminToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'manager@example.com' })
        .expect(201);

      await promoteToManager(orgId, adminToken, managerUserId);

      // Admin creates a team; manager is NOT added to it in any way.
      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(adminToken))
        .send({ name: 'Engineering' })
        .expect(201);

      // The manager can still rename it...
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(managerToken))
        .send({ name: 'Renamed By Manager' })
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.name).toBe('Renamed By Manager');
        });

      // ...and add members to it...
      await registerAndLogin('newbie@example.com');
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'newbie@example.com' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(managerToken))
        .send({ email: 'newbie@example.com' })
        .expect(201);

      // ...despite never appearing in the team's own membership list as
      // anything other than someone who acted on it via the org override.
      const members = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${team.body.id}/members`)
        .set('Authorization', authed(adminToken))
        .expect(200);
      expect(
        members.body.some(
          (m: { user: { id: string } }) => m.user.id === managerUserId,
        ),
      ).toBe(false);
    });

    it('an ADMIN also has the organization-wide team override', async () => {
      const { accessToken: founderToken } = await registerAndLogin(
        'founder@example.com',
      );
      const { accessToken: adminToken } = await registerAndLogin(
        'second-admin@example.com',
      );
      const orgId = await createOrg(founderToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(founderToken))
        .send({ email: 'second-admin@example.com', role: 'ADMIN' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(founderToken))
        .send({ name: 'Design' })
        .expect(201);

      // second-admin never joined "Design" but is an org ADMIN.
      return request(app.getHttpServer())
        .delete(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(adminToken))
        .expect(204);
    });

    it('a MANAGER still cannot rename the ORGANIZATION itself', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: managerToken, userId: managerUserId } =
        await registerAndLogin('manager@example.com');
      const orgId = await createOrg(adminToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'manager@example.com' })
        .expect(201);
      await promoteToManager(orgId, adminToken, managerUserId);

      return request(app.getHttpServer())
        .patch(`/organizations/${orgId}`)
        .set('Authorization', authed(managerToken))
        .send({ name: 'Hijacked Org Name' })
        .expect(403);
    });

    it('a MANAGER still cannot add or remove ORGANIZATION members', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: managerToken, userId: managerUserId } =
        await registerAndLogin('manager@example.com');
      await registerAndLogin('outsider@example.com');
      const orgId = await createOrg(adminToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'manager@example.com' })
        .expect(201);
      await promoteToManager(orgId, adminToken, managerUserId);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(managerToken))
        .send({ email: 'outsider@example.com' })
        .expect(403);

      return request(app.getHttpServer())
        .delete(`/organizations/${orgId}/members/${managerUserId}`)
        .set('Authorization', authed(managerToken))
        .expect(403);
    });

    it('a plain MEMBER still cannot manage a team they do not lead (RBAC did not loosen this)', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: memberToken } =
        await registerAndLogin('member@example.com');
      const orgId = await createOrg(adminToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'member@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(adminToken))
        .send({ name: 'Engineering' })
        .expect(201);

      return request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(memberToken))
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('promoting a member to MANAGER via the API immediately grants the override on the next request', async () => {
      const { accessToken: adminToken } =
        await registerAndLogin('admin@example.com');
      const { accessToken: memberToken, userId: memberUserId } =
        await registerAndLogin('soon-manager@example.com');
      const orgId = await createOrg(adminToken);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email: 'soon-manager@example.com' })
        .expect(201);

      const team = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authed(adminToken))
        .send({ name: 'Engineering' })
        .expect(201);

      // Before promotion: denied.
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(memberToken))
        .send({ name: 'Attempt 1' })
        .expect(403);

      await promoteToManager(orgId, adminToken, memberUserId);

      // After promotion, same access token, same team, now succeeds - the
      // permission check reads the CURRENT membership row on every request,
      // not something baked into the access token at login time.
      return request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${team.body.id}`)
        .set('Authorization', authed(memberToken))
        .send({ name: 'Attempt 2' })
        .expect(200);
    });
  });

  describe('Projects (Phase 07)', () => {
    const authed = (token: string) => `Bearer ${token}`;
    const projectsUrl = (orgId: string) => `/organizations/${orgId}/projects`;

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

    async function createOrg(token: string, name = 'Org') {
      const res = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', authed(token))
        .send({ name })
        .expect(201);
      return res.body.id as string;
    }

    async function addOrgMember(
      orgId: string,
      adminToken: string,
      email: string,
    ) {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members`)
        .set('Authorization', authed(adminToken))
        .send({ email })
        .expect(201);
    }

    async function setOrgRole(
      orgId: string,
      adminToken: string,
      userId: string,
      role: 'ADMIN' | 'MANAGER' | 'MEMBER',
    ) {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/members/${userId}`)
        .set('Authorization', authed(adminToken))
        .send({ role })
        .expect(200);
    }

    async function createProject(
      orgId: string,
      token: string,
      body: { name: string; description?: string } = { name: 'Apollo' },
    ) {
      const res = await request(app.getHttpServer())
        .post(projectsUrl(orgId))
        .set('Authorization', authed(token))
        .send(body)
        .expect(201);
      return res.body.id as string;
    }

    async function addProjectMember(
      orgId: string,
      projectId: string,
      token: string,
      email: string,
      role?: 'LEAD' | 'MEMBER',
    ) {
      await request(app.getHttpServer())
        .post(`${projectsUrl(orgId)}/${projectId}/members`)
        .set('Authorization', authed(token))
        .send(role ? { email, role } : { email })
        .expect(201);
    }

    /**
     * The standard cast: an organization with an ADMIN (founder), a LEAD and
     * a plain MEMBER (both org MEMBERs), plus an OUTSIDER who is not in the
     * organization at all. The LEAD creates the project "Apollo", so they are
     * its only project member.
     */
    async function setup() {
      const admin = await registerAndLogin('admin@example.com');
      const lead = await registerAndLogin('lead@example.com');
      const member = await registerAndLogin('member@example.com');
      const outsider = await registerAndLogin('outsider@example.com');

      const orgId = await createOrg(admin.accessToken);
      await addOrgMember(orgId, admin.accessToken, 'lead@example.com');
      await addOrgMember(orgId, admin.accessToken, 'member@example.com');

      const projectId = await createProject(orgId, lead.accessToken);
      return { admin, lead, member, outsider, orgId, projectId };
    }

    describe('creating projects', () => {
      it('makes the creator the project LEAD and returns the new project', async () => {
        const { lead, orgId } = await setup();

        const res = await request(app.getHttpServer())
          .post(projectsUrl(orgId))
          .set('Authorization', authed(lead.accessToken))
          .send({ name: 'Gemini', description: 'Second program' })
          .expect(201);

        expect(res.body.name).toBe('Gemini');
        expect(res.body.description).toBe('Second program');
        expect(res.body.status).toBe('ACTIVE');
        expect(res.body.archivedAt).toBeNull();
        expect(res.body.organizationId).toBe(orgId);

        const detail = await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}/${res.body.id}`)
          .set('Authorization', authed(lead.accessToken))
          .expect(200);
        expect(detail.body.currentUserRole).toBe('LEAD');
        expect(detail.body.memberCount).toBe(1);
      });

      it('trims whitespace from the name', async () => {
        const { lead, orgId } = await setup();

        const res = await request(app.getHttpServer())
          .post(projectsUrl(orgId))
          .set('Authorization', authed(lead.accessToken))
          .send({ name: '  Padded Name  ' })
          .expect(201);

        expect(res.body.name).toBe('Padded Name');
      });

      it('rejects invalid input with 400', async () => {
        const { lead, orgId } = await setup();
        const post = (body: object) =>
          request(app.getHttpServer())
            .post(projectsUrl(orgId))
            .set('Authorization', authed(lead.accessToken))
            .send(body);

        await post({ name: 'a' }).expect(400); // too short
        await post({ name: '     ' }).expect(400); // blank after trimming
        await post({}).expect(400); // missing
        await post({ name: 'x'.repeat(151) }).expect(400); // too long
        await post({ name: 'Okay', description: 'x'.repeat(2001) }).expect(
          400,
        );
        // Unknown properties are rejected, not silently ignored - a client
        // cannot smuggle in e.g. `status` or `organizationId`.
        await post({ name: 'Okay', status: 'ARCHIVED' }).expect(400);
        await post({ name: 'Okay', organizationId: 'x' }).expect(400);
      });

      it('requires authentication', async () => {
        const { orgId } = await setup();

        await request(app.getHttpServer())
          .post(projectsUrl(orgId))
          .send({ name: 'Nope' })
          .expect(401);
        await request(app.getHttpServer()).get(projectsUrl(orgId)).expect(401);
      });
    });

    describe('visibility: projects are private to their members', () => {
      it('hides a project from an org MEMBER who is not on it - list, detail and members all 404/empty', async () => {
        const { member, orgId, projectId } = await setup();

        const list = await request(app.getHttpServer())
          .get(projectsUrl(orgId))
          .set('Authorization', authed(member.accessToken))
          .expect(200);
        expect(list.body).toEqual([]);

        await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}/${projectId}`)
          .set('Authorization', authed(member.accessToken))
          .expect(404);
        await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}/${projectId}/members`)
          .set('Authorization', authed(member.accessToken))
          .expect(404);
      });

      it('lets an org ADMIN see every project, including ones they are not on', async () => {
        const { admin, orgId, projectId } = await setup();

        const list = await request(app.getHttpServer())
          .get(projectsUrl(orgId))
          .set('Authorization', authed(admin.accessToken))
          .expect(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0].id).toBe(projectId);
        // Seeing it via oversight, not membership.
        expect(list.body[0].currentUserRole).toBeNull();
        expect(list.body[0].memberCount).toBe(1);

        await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}/${projectId}`)
          .set('Authorization', authed(admin.accessToken))
          .expect(200);
      });

      it('lets an org MANAGER see every project too', async () => {
        const { admin, member, orgId, projectId } = await setup();
        await setOrgRole(orgId, admin.accessToken, member.userId, 'MANAGER');

        await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}/${projectId}`)
          .set('Authorization', authed(member.accessToken))
          .expect(200);
      });

      it('lists only the projects each member is on', async () => {
        const { lead, member, orgId } = await setup();
        const second = await createProject(orgId, lead.accessToken, {
          name: 'Gemini',
        });
        await addProjectMember(
          orgId,
          second,
          lead.accessToken,
          'member@example.com',
        );

        const memberList = await request(app.getHttpServer())
          .get(projectsUrl(orgId))
          .set('Authorization', authed(member.accessToken))
          .expect(200);
        expect(memberList.body.map((p: { id: string }) => p.id)).toEqual([
          second,
        ]);
        expect(memberList.body[0].currentUserRole).toBe('MEMBER');

        const leadList = await request(app.getHttpServer())
          .get(projectsUrl(orgId))
          .set('Authorization', authed(lead.accessToken))
          .expect(200);
        expect(leadList.body).toHaveLength(2);
      });

      it('rejects an invalid status filter with 400', async () => {
        const { lead, orgId } = await setup();

        await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}?status=BOGUS`)
          .set('Authorization', authed(lead.accessToken))
          .expect(400);
      });
    });

    describe('tenant isolation', () => {
      it('gives a non-member of the organization 404 on every projects route', async () => {
        const { outsider, orgId, projectId } = await setup();
        const auth = authed(outsider.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;

        await request(app.getHttpServer())
          .get(projectsUrl(orgId))
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .post(projectsUrl(orgId))
          .set('Authorization', auth)
          .send({ name: 'Sneaky' })
          .expect(404);
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .patch(base)
          .set('Authorization', auth)
          .send({ name: 'Hijack' })
          .expect(404);
        await request(app.getHttpServer())
          .delete(base)
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .post(`${base}/members`)
          .set('Authorization', auth)
          .send({ email: 'outsider@example.com' })
          .expect(404);
      });

      it("blocks IDOR: a project ID from ANOTHER organization can't be reached through your own organization's URL", async () => {
        // The admin is an ADMIN of BOTH organizations, so organization-level
        // access is not the obstacle - the project/organization mismatch is.
        const { admin, orgId: orgA } = await setup();
        const orgB = await createOrg(admin.accessToken, 'Org B');
        const projectInB = await createProject(orgB, admin.accessToken, {
          name: 'Secret B Project',
        });
        const auth = authed(admin.accessToken);
        const wrongUrl = `${projectsUrl(orgA)}/${projectInB}`;

        await request(app.getHttpServer())
          .get(wrongUrl)
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .patch(wrongUrl)
          .set('Authorization', auth)
          .send({ name: 'Moved' })
          .expect(404);
        await request(app.getHttpServer())
          .post(`${wrongUrl}/archive`)
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .get(`${wrongUrl}/members`)
          .set('Authorization', auth)
          .expect(404);

        // Through its OWN organization it is reachable, proving the 404s
        // above were about the mismatch and not a broken route.
        await request(app.getHttpServer())
          .get(`${projectsUrl(orgB)}/${projectInB}`)
          .set('Authorization', auth)
          .expect(200);
      });

      it("keeps one organization's project list free of another's", async () => {
        const { admin, orgId: orgA } = await setup();
        const orgB = await createOrg(admin.accessToken, 'Org B');
        await createProject(orgB, admin.accessToken, { name: 'Only In B' });

        const listA = await request(app.getHttpServer())
          .get(projectsUrl(orgA))
          .set('Authorization', authed(admin.accessToken))
          .expect(200);

        expect(listA.body).toHaveLength(1);
        expect(listA.body[0].name).toBe('Apollo');
      });
    });

    describe('permissions on a project', () => {
      it('lets a project MEMBER read but not manage the project', async () => {
        const { lead, member, orgId, projectId } = await setup();
        await addProjectMember(
          orgId,
          projectId,
          lead.accessToken,
          'member@example.com',
        );
        const auth = authed(member.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;

        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', auth)
          .expect(200);
        await request(app.getHttpServer())
          .get(`${base}/members`)
          .set('Authorization', auth)
          .expect(200);

        // 403 (not 404): they CAN see the project, they just can't do this.
        await request(app.getHttpServer())
          .patch(base)
          .set('Authorization', auth)
          .send({ name: 'Renamed' })
          .expect(403);
        await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', auth)
          .expect(403);
        await request(app.getHttpServer())
          .post(`${base}/members`)
          .set('Authorization', auth)
          .send({ email: 'admin@example.com' })
          .expect(403);
      });

      it('lets the project LEAD edit name and description', async () => {
        const { lead, orgId, projectId } = await setup();

        const res = await request(app.getHttpServer())
          .patch(`${projectsUrl(orgId)}/${projectId}`)
          .set('Authorization', authed(lead.accessToken))
          .send({ name: 'Apollo II', description: 'Now with more moon' })
          .expect(200);

        expect(res.body.name).toBe('Apollo II');
        expect(res.body.description).toBe('Now with more moon');
      });

      it('THE CORE PROJECT RBAC TEST: an org MANAGER can manage a project they did NOT create and are not on', async () => {
        const { admin, member, orgId, projectId } = await setup();
        await setOrgRole(orgId, admin.accessToken, member.userId, 'MANAGER');
        const auth = authed(member.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;

        await request(app.getHttpServer())
          .patch(base)
          .set('Authorization', auth)
          .send({ name: 'Renamed By Manager' })
          .expect(200);
        await addProjectMember(
          orgId,
          projectId,
          member.accessToken,
          'admin@example.com',
        );

        // ...without ever appearing on the project's own member list.
        const members = await request(app.getHttpServer())
          .get(`${base}/members`)
          .set('Authorization', auth)
          .expect(200);
        expect(
          members.body.some(
            (m: { user: { id: string } }) => m.user.id === member.userId,
          ),
        ).toBe(false);
      });

      it('answers 404, not 403, when an org MEMBER who cannot see the project tries to modify it', async () => {
        const { member, orgId, projectId } = await setup();

        await request(app.getHttpServer())
          .patch(`${projectsUrl(orgId)}/${projectId}`)
          .set('Authorization', authed(member.accessToken))
          .send({ name: 'Hijack' })
          .expect(404);
      });

      it("takes effect immediately when someone's organization role changes", async () => {
        const { admin, member, orgId, projectId } = await setup();
        const auth = authed(member.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;

        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', auth)
          .expect(404);

        await setOrgRole(orgId, admin.accessToken, member.userId, 'MANAGER');

        // Same access token, now allowed - permissions are read per request.
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', auth)
          .expect(200);
      });
    });

    describe('updating', () => {
      it('requires at least one field', async () => {
        const { lead, orgId, projectId } = await setup();

        await request(app.getHttpServer())
          .patch(`${projectsUrl(orgId)}/${projectId}`)
          .set('Authorization', authed(lead.accessToken))
          .send({})
          .expect(400);
      });

      it('clears the description when given an empty string', async () => {
        const { lead, orgId } = await setup();
        const id = await createProject(orgId, lead.accessToken, {
          name: 'Has Description',
          description: 'To be removed',
        });

        const res = await request(app.getHttpServer())
          .patch(`${projectsUrl(orgId)}/${id}`)
          .set('Authorization', authed(lead.accessToken))
          .send({ description: '' })
          .expect(200);

        expect(res.body.description).toBeNull();
        expect(res.body.name).toBe('Has Description');
      });

      it('treats a malformed ID in the URL as not found (404), never a server error', async () => {
        const { lead, orgId } = await setup();
        const auth = authed(lead.accessToken);

        await request(app.getHttpServer())
          .get(`${projectsUrl(orgId)}/not-a-uuid`)
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .get('/organizations/not-a-uuid/projects')
          .set('Authorization', auth)
          .expect(404);
        // Same guard fix covers the Phase 04/05 routes.
        await request(app.getHttpServer())
          .get('/organizations/not-a-uuid')
          .set('Authorization', auth)
          .expect(404);
        await request(app.getHttpServer())
          .get(`/organizations/${orgId}/teams/not-a-uuid`)
          .set('Authorization', auth)
          .expect(404);
      });
    });

    describe('archive, unarchive and delete', () => {
      it('archives and unarchives, moving the project between list filters', async () => {
        const { lead, orgId, projectId } = await setup();
        const auth = authed(lead.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;
        const listIds = async (query: string) => {
          const res = await request(app.getHttpServer())
            .get(`${projectsUrl(orgId)}${query}`)
            .set('Authorization', auth)
            .expect(200);
          return res.body.map((p: { id: string }) => p.id);
        };

        const archived = await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', auth)
          .expect(200);
        expect(archived.body.status).toBe('ARCHIVED');
        expect(archived.body.archivedAt).toEqual(expect.any(String));

        expect(await listIds('')).toEqual([]); // default = ACTIVE only
        expect(await listIds('?status=ARCHIVED')).toEqual([projectId]);

        const restored = await request(app.getHttpServer())
          .post(`${base}/unarchive`)
          .set('Authorization', auth)
          .expect(200);
        expect(restored.body.status).toBe('ACTIVE');
        expect(restored.body.archivedAt).toBeNull();

        expect(await listIds('')).toEqual([projectId]);
        expect(await listIds('?status=ARCHIVED')).toEqual([]);
      });

      it('rejects archiving twice and unarchiving an active project with 409', async () => {
        const { lead, orgId, projectId } = await setup();
        const auth = authed(lead.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;

        await request(app.getHttpServer())
          .post(`${base}/unarchive`)
          .set('Authorization', auth)
          .expect(409);
        await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', auth)
          .expect(200);
        await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', auth)
          .expect(409);
      });

      it('makes an archived project read-only (409 on edits and membership changes) but still readable', async () => {
        const { lead, member, orgId, projectId } = await setup();
        await addProjectMember(
          orgId,
          projectId,
          lead.accessToken,
          'member@example.com',
        );
        const auth = authed(lead.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;
        await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', auth)
          .expect(200);

        await request(app.getHttpServer())
          .patch(base)
          .set('Authorization', auth)
          .send({ name: 'Too Late' })
          .expect(409);
        await request(app.getHttpServer())
          .post(`${base}/members`)
          .set('Authorization', auth)
          .send({ email: 'admin@example.com' })
          .expect(409);
        await request(app.getHttpServer())
          .patch(`${base}/members/${member.userId}`)
          .set('Authorization', auth)
          .send({ role: 'LEAD' })
          .expect(409);
        await request(app.getHttpServer())
          .delete(`${base}/members/${member.userId}`)
          .set('Authorization', auth)
          .expect(409);

        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', auth)
          .expect(200);
        await request(app.getHttpServer())
          .get(`${base}/members`)
          .set('Authorization', auth)
          .expect(200);
      });

      it('only deletes a project once it is archived, and cascades its memberships', async () => {
        const { admin, lead, orgId, projectId } = await setup();
        const auth = authed(lead.accessToken);
        const base = `${projectsUrl(orgId)}/${projectId}`;

        // Active -> refused. Archive first.
        await request(app.getHttpServer())
          .delete(base)
          .set('Authorization', auth)
          .expect(409);
        await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', auth)
          .expect(200);

        await request(app.getHttpServer())
          .delete(base)
          .set('Authorization', auth)
          .expect(204);

        // Gone for everyone - even an org ADMIN with oversight of all projects.
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', authed(admin.accessToken))
          .expect(404);
        expect(
          await prisma.projectMembership.count({ where: { projectId } }),
        ).toBe(0);
      });

      it('requires project:manage to archive or delete', async () => {
        const { lead, member, orgId, projectId } = await setup();
        await addProjectMember(
          orgId,
          projectId,
          lead.accessToken,
          'member@example.com',
        );
        const base = `${projectsUrl(orgId)}/${projectId}`;
        await request(app.getHttpServer())
          .post(`${base}/archive`)
          .set('Authorization', authed(lead.accessToken))
          .expect(200);

        await request(app.getHttpServer())
          .delete(base)
          .set('Authorization', authed(member.accessToken))
          .expect(403);
        await request(app.getHttpServer())
          .post(`${base}/unarchive`)
          .set('Authorization', authed(member.accessToken))
          .expect(403);
      });
    });

    describe('project members', () => {
      it('adds an organization member by email, who then gains access', async () => {
        const { lead, member, orgId, projectId } = await setup();
        const base = `${projectsUrl(orgId)}/${projectId}`;

        const res = await request(app.getHttpServer())
          .post(`${base}/members`)
          .set('Authorization', authed(lead.accessToken))
          .send({ email: 'member@example.com' })
          .expect(201);
        expect(res.body.role).toBe('MEMBER');
        expect(res.body.user.email).toBe('member@example.com');
        expect(res.body.user).not.toHaveProperty('passwordHash');

        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', authed(member.accessToken))
          .expect(200);

        const list = await request(app.getHttpServer())
          .get(`${base}/members`)
          .set('Authorization', authed(lead.accessToken))
          .expect(200);
        expect(list.body).toHaveLength(2);
        expect(JSON.stringify(list.body)).not.toContain('passwordHash');
      });

      it('rejects bad additions: unknown email 404, non-org-member 422, duplicate 409, invalid email 400', async () => {
        const { lead, orgId, projectId } = await setup();
        const post = (body: object) =>
          request(app.getHttpServer())
            .post(`${projectsUrl(orgId)}/${projectId}/members`)
            .set('Authorization', authed(lead.accessToken))
            .send(body);

        await post({ email: 'nobody@example.com' }).expect(404);
        // Registered, but NOT in this organization: the tenant boundary
        // must hold even when someone with the right permission asks.
        await post({ email: 'outsider@example.com' }).expect(422);
        await post({ email: 'lead@example.com' }).expect(409); // already on it
        await post({ email: 'not-an-email' }).expect(400);
        await post({ email: 'member@example.com', role: 'OWNER' }).expect(400);
      });

      it('changes roles and revokes access when a member is removed', async () => {
        const { lead, member, orgId, projectId } = await setup();
        const base = `${projectsUrl(orgId)}/${projectId}`;
        await addProjectMember(
          orgId,
          projectId,
          lead.accessToken,
          'member@example.com',
        );

        // Promote: the member can now manage the project.
        await request(app.getHttpServer())
          .patch(`${base}/members/${member.userId}`)
          .set('Authorization', authed(lead.accessToken))
          .send({ role: 'LEAD' })
          .expect(200);
        await request(app.getHttpServer())
          .patch(base)
          .set('Authorization', authed(member.accessToken))
          .send({ name: 'Renamed By New Lead' })
          .expect(200);

        // Remove: they lose even read access, and see 404.
        await request(app.getHttpServer())
          .delete(`${base}/members/${member.userId}`)
          .set('Authorization', authed(lead.accessToken))
          .expect(204);
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', authed(member.accessToken))
          .expect(404);

        // Removing someone who isn't a member is a 404.
        await request(app.getHttpServer())
          .delete(`${base}/members/${member.userId}`)
          .set('Authorization', authed(lead.accessToken))
          .expect(404);
      });

      it('never lets a project end up with no lead via the API', async () => {
        const { lead, member, orgId, projectId } = await setup();
        const base = `${projectsUrl(orgId)}/${projectId}`;
        const leadAuth = authed(lead.accessToken);

        // The creator is the only lead: can't demote or remove themselves.
        await request(app.getHttpServer())
          .patch(`${base}/members/${lead.userId}`)
          .set('Authorization', leadAuth)
          .send({ role: 'MEMBER' })
          .expect(409);
        await request(app.getHttpServer())
          .delete(`${base}/members/${lead.userId}`)
          .set('Authorization', leadAuth)
          .expect(409);

        // With a second lead in place, the first may step down...
        await addProjectMember(
          orgId,
          projectId,
          lead.accessToken,
          'member@example.com',
          'LEAD',
        );
        await request(app.getHttpServer())
          .delete(`${base}/members/${lead.userId}`)
          .set('Authorization', leadAuth)
          .expect(204);

        // ...and the remaining lead is protected in turn.
        await request(app.getHttpServer())
          .delete(`${base}/members/${member.userId}`)
          .set('Authorization', authed(member.accessToken))
          .expect(409);
      });
    });

    describe('leaving an organization (fixes a Phase 04 gap)', () => {
      it('removing a user from an organization also removes them from its projects, so re-adding them does not resurrect old access', async () => {
        const { admin, lead, member, orgId, projectId } = await setup();
        await addProjectMember(
          orgId,
          projectId,
          lead.accessToken,
          'member@example.com',
        );
        const base = `${projectsUrl(orgId)}/${projectId}`;
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', authed(member.accessToken))
          .expect(200);

        await request(app.getHttpServer())
          .delete(`/organizations/${orgId}/members/${member.userId}`)
          .set('Authorization', authed(admin.accessToken))
          .expect(204);
        expect(
          await prisma.projectMembership.count({
            where: { userId: member.userId },
          }),
        ).toBe(0);

        // Re-add to the organization: a plain member again - NOT back on
        // the project they used to belong to.
        await addOrgMember(orgId, admin.accessToken, 'member@example.com');
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', authed(member.accessToken))
          .expect(404);
      });

      it('also removes their team memberships in that organization', async () => {
        const { admin, member, orgId } = await setup();
        const team = await request(app.getHttpServer())
          .post(`/organizations/${orgId}/teams`)
          .set('Authorization', authed(admin.accessToken))
          .send({ name: 'Engineering' })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/organizations/${orgId}/teams/${team.body.id}/members`)
          .set('Authorization', authed(admin.accessToken))
          .send({ email: 'member@example.com' })
          .expect(201);
        expect(
          await prisma.teamMembership.count({
            where: { userId: member.userId },
          }),
        ).toBe(1);

        await request(app.getHttpServer())
          .delete(`/organizations/${orgId}/members/${member.userId}`)
          .set('Authorization', authed(admin.accessToken))
          .expect(204);

        expect(
          await prisma.teamMembership.count({
            where: { userId: member.userId },
          }),
        ).toBe(0);
      });

      it('leaves their memberships in OTHER organizations untouched', async () => {
        const { admin, member, orgId: orgA } = await setup();
        const orgB = await createOrg(admin.accessToken, 'Org B');
        await addOrgMember(orgB, admin.accessToken, 'member@example.com');
        const projectInB = await createProject(orgB, admin.accessToken, {
          name: 'B Project',
        });
        await addProjectMember(
          orgB,
          projectInB,
          admin.accessToken,
          'member@example.com',
        );

        await request(app.getHttpServer())
          .delete(`/organizations/${orgA}/members/${member.userId}`)
          .set('Authorization', authed(admin.accessToken))
          .expect(204);

        await request(app.getHttpServer())
          .get(`${projectsUrl(orgB)}/${projectInB}`)
          .set('Authorization', authed(member.accessToken))
          .expect(200);
      });
    });
  });
});
