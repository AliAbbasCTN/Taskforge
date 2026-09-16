import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * These are END-TO-END tests: they boot the real application and issue real
 * HTTP requests against a REAL PostgreSQL database.
 *
 * They require a running database (see docker-compose.yml) and an applied
 * migration. Unlike the unit tests, these prove that the pieces are actually
 * wired together correctly - routing, validation, the exception filter, the
 * Prisma connection, and the database constraints themselves.
 */
describe('TaskForge backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the configuration in main.ts so these tests exercise the same
    // validation and error-formatting behaviour real requests will hit.
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

  // Start each test from a known-empty table so tests don't depend on each
  // other's leftovers or on whatever is already in the dev database.
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

  describe('POST /users', () => {
    it('creates a user and persists it to the database', async () => {
      const res = await request(app.getHttpServer())
        .post('/users')
        .send({ email: 'ada@example.com', name: 'Ada Lovelace' })
        .expect(201);

      expect(res.body.email).toBe('ada@example.com');
      expect(res.body.id).toEqual(expect.any(String));

      // Confirm it really reached PostgreSQL, not just the response object.
      const stored = await prisma.user.findUnique({
        where: { id: res.body.id },
      });
      expect(stored?.name).toBe('Ada Lovelace');
    });

    it('rejects an invalid email with 400', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'not-an-email', name: 'Ada' })
        .expect(400);
    });

    it('rejects a missing name with 400', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'ada@example.com' })
        .expect(400);
    });

    it('rejects unknown properties with 400', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'ada@example.com', name: 'Ada', isAdmin: true })
        .expect(400);
    });

    it('returns 409 when the email is already registered', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .send({ email: 'dup@example.com', name: 'First' })
        .expect(201);

      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'dup@example.com', name: 'Second' })
        .expect(409);
    });
  });

  describe('GET /users/:id', () => {
    it('returns the requested user', async () => {
      const created = await prisma.user.create({
        data: { email: 'grace@example.com', name: 'Grace Hopper' },
      });

      return request(app.getHttpServer())
        .get(`/users/${created.id}`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.name).toBe('Grace Hopper');
        });
    });

    it('returns 404 for a well-formed but unknown id', () => {
      return request(app.getHttpServer())
        .get('/users/11111111-1111-4111-8111-111111111111')
        .expect(404);
    });

    it('returns 400 for a malformed id', () => {
      return request(app.getHttpServer()).get('/users/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('updates the name and bumps updatedAt', async () => {
      const created = await prisma.user.create({
        data: { email: 'alan@example.com', name: 'Alan' },
      });

      const res = await request(app.getHttpServer())
        .patch(`/users/${created.id}`)
        .send({ name: 'Alan Turing' })
        .expect(200);

      expect(res.body.name).toBe('Alan Turing');
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime(),
      );
    });

    it('returns 404 when updating an unknown user', () => {
      return request(app.getHttpServer())
        .patch('/users/11111111-1111-4111-8111-111111111111')
        .send({ name: 'Nobody' })
        .expect(404);
    });

    it('rejects attempts to change the email', async () => {
      const created = await prisma.user.create({
        data: { email: 'fixed@example.com', name: 'Fixed' },
      });

      return request(app.getHttpServer())
        .patch(`/users/${created.id}`)
        .send({ email: 'changed@example.com' })
        .expect(400);
    });
  });

  describe('DELETE /users/:id', () => {
    it('deletes the user and returns 204', async () => {
      const created = await prisma.user.create({
        data: { email: 'gone@example.com', name: 'Gone' },
      });

      await request(app.getHttpServer())
        .delete(`/users/${created.id}`)
        .expect(204);

      const stored = await prisma.user.findUnique({
        where: { id: created.id },
      });
      expect(stored).toBeNull();
    });

    it('returns 404 when deleting an unknown user', () => {
      return request(app.getHttpServer())
        .delete('/users/11111111-1111-4111-8111-111111111111')
        .expect(404);
    });
  });

  describe('GET /users', () => {
    it('lists created users', async () => {
      await prisma.user.createMany({
        data: [
          { email: 'a@example.com', name: 'A' },
          { email: 'b@example.com', name: 'B' },
        ],
      });

      return request(app.getHttpServer())
        .get('/users')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body).toHaveLength(2);
        });
    });
  });
});
