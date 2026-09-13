import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';

describe('TaskForge backend (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the pipe configured in main.ts, so e2e tests exercise the
    // same validation behaviour real requests will hit.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res: Response) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('POST /examples rejects an invalid payload', () => {
    return request(app.getHttpServer())
      .post('/examples')
      .send({ title: '' })
      .expect(400);
  });

  it('POST /examples rejects unknown properties', () => {
    return request(app.getHttpServer())
      .post('/examples')
      .send({ title: 'Valid title', notAllowed: true })
      .expect(400);
  });

  it('creates and retrieves an example item', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/examples')
      .send({ title: 'Learn NestJS' })
      .expect(201);

    expect(createResponse.body.title).toBe('Learn NestJS');

    return request(app.getHttpServer())
      .get(`/examples/${createResponse.body.id}`)
      .expect(200)
      .expect((res: Response) => {
        expect(res.body.title).toBe('Learn NestJS');
      });
  });

  it('GET /examples/:id returns 404 for a missing item', () => {
    return request(app.getHttpServer()).get('/examples/999999').expect(404);
  });
});
