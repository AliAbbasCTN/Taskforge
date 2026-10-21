import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { eventually, maintenanceQueue, settleNotifications } from './helpers/queues';

/**
 * FILE UPLOAD end-to-end tests. They use the LOCAL storage driver pointed at a
 * throw-away temporary folder, so they exercise the real upload pipeline -
 * multipart parsing, validation, storage, database, download, cleanup - without
 * needing AWS. (They need Postgres and Redis, like the other e2e files.)
 */
jest.setTimeout(30_000);

// A real (tiny) PNG: the 8-byte signature plus filler. Enough to pass the
// magic-number check, which is exactly what is being tested.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-image-bytes'),
]);

describe('Attachments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storageDir: string;
  const previousEnv = {
    dir: process.env.STORAGE_LOCAL_DIR,
    driver: process.env.STORAGE_DRIVER,
    max: process.env.UPLOAD_MAX_FILE_SIZE_MB,
  };

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'taskforge-e2e-files-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = storageDir;
    process.env.UPLOAD_MAX_FILE_SIZE_MB = '1'; // keeps the "too big" test light

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createAppValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  const wipe = async () => {
    // Deleting tasks cascades to attachment rows (that is part of what is tested).
    await prisma.notification.deleteMany();
    await prisma.task.deleteMany();
    await prisma.boardColumn.deleteMany();
    await prisma.board.deleteMany();
    await prisma.projectMembership.deleteMany();
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  };

  beforeEach(async () => {
    await settleNotifications(app);
    await wipe();
  });

  afterAll(async () => {
    if (app && prisma) {
      await settleNotifications(app);
      await wipe();
      await app.close();
    }
    await rm(storageDir, { recursive: true, force: true });
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    restore('STORAGE_LOCAL_DIR', previousEnv.dir);
    restore('STORAGE_DRIVER', previousEnv.driver);
    restore('UPLOAD_MAX_FILE_SIZE_MB', previousEnv.max);
  });

  async function register(email: string, name: string) {
    const res = await api()
      .post('/auth/register')
      .send({ email, name, password: 'password1' })
      .expect(201);
    return { id: res.body.user.id as string, email, token: res.body.tokens.accessToken as string };
  }

  /**
   * lead (project LEAD) + member (project MEMBER) + one task. `outsider` is a
   * registered user who belongs to no organisation.
   */
  async function world() {
    const lead = await register('lead@example.com', 'Lena Lead');
    const member = await register('member@example.com', 'Max Member');
    const outsider = await register('outsider@example.com', 'Olga Outsider');
    const orgId = (
      await api().post('/organizations').set('Authorization', bearer(lead.token)).send({ name: 'Org' }).expect(201)
    ).body.id as string;
    await api()
      .post(`/organizations/${orgId}/members`)
      .set('Authorization', bearer(lead.token))
      .send({ email: member.email })
      .expect(201);
    const projectId = (
      await api()
        .post(`/organizations/${orgId}/projects`)
        .set('Authorization', bearer(lead.token))
        .send({ name: 'Apollo' })
        .expect(201)
    ).body.id as string;
    await api()
      .post(`/organizations/${orgId}/projects/${projectId}/members`)
      .set('Authorization', bearer(lead.token))
      .send({ email: member.email })
      .expect(201);
    const board = (
      await api()
        .post(`/organizations/${orgId}/projects/${projectId}/boards`)
        .set('Authorization', bearer(lead.token))
        .send({ name: 'Sprint' })
        .expect(201)
    ).body;
    const boardPath = `/organizations/${orgId}/projects/${projectId}/boards/${board.id}`;
    const createTask = async (title: string) =>
      (
        await api()
          .post(`${boardPath}/tasks`)
          .set('Authorization', bearer(lead.token))
          .send({ columnId: board.columns[0].id, title })
          .expect(201)
      ).body.id as string;
    const taskId = await createTask('Fix login');
    await settleNotifications(app);

    const attachmentsPath = (task = taskId) => `${boardPath}/tasks/${task}/attachments`;
    const upload = (
      token: string,
      opts: { buffer?: Buffer; filename?: string; contentType?: string; task?: string } = {},
    ) =>
      api()
        .post(attachmentsPath(opts.task))
        .set('Authorization', bearer(token))
        .attach('file', opts.buffer ?? PNG, {
          filename: opts.filename ?? 'screenshot.png',
          contentType: opts.contentType ?? 'image/png',
        });

    return { lead, member, outsider, orgId, projectId, boardId: board.id as string, taskId, createTask, attachmentsPath, upload };
  }

  const filesOnDisk = (key: string) => existsSync(join(storageDir, key));

  describe('upload, list and download', () => {
    it('stores an upload, never exposes the storage key, and the file is retrievable byte-for-byte', async () => {
      const w = await world();

      const created = await w.upload(w.member.token).expect(201);

      expect(created.body).toEqual({
        id: expect.any(String),
        taskId: w.taskId,
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        createdAt: expect.any(String),
        uploader: expect.objectContaining({ id: w.member.id, name: 'Max Member' }),
      });
      expect(JSON.stringify(created.body)).not.toContain('storageKey');
      expect(JSON.stringify(created.body)).not.toContain('attachments/');

      const list = await api()
        .get(w.attachmentsPath())
        .set('Authorization', bearer(w.lead.token))
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(created.body.id);

      const download = await api()
        .get(`${w.attachmentsPath()}/${created.body.id}/download`)
        .set('Authorization', bearer(w.lead.token))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(download.body as Buffer, PNG)).toBe(0);
      expect(download.headers['content-type']).toContain('image/png');
      expect(download.headers['content-disposition']).toMatch(/^attachment;/);
      expect(download.headers['x-content-type-options']).toBe('nosniff');
    });

    it('ignores the client-claimed Content-Type: the stored type comes from the content', async () => {
      const w = await world();

      const res = await w.upload(w.member.token, { contentType: 'text/html' }).expect(201);

      expect(res.body.mimeType).toBe('image/png');
    });

    it('neutralises a hostile file name and writes only inside the storage folder', async () => {
      const w = await world();

      const res = await w
        .upload(w.member.token, { filename: '../../../escape.png' })
        .expect(201);

      expect(res.body.fileName).toBe('escape.png');
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.storageKey).toMatch(/^attachments\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
      expect(filesOnDisk(row.storageKey)).toBe(true);
    });
  });

  describe('validation', () => {
    it('400 when no file is sent', async () => {
      const w = await world();
      await api()
        .post(w.attachmentsPath())
        .set('Authorization', bearer(w.member.token))
        .expect(400);
    });

    it('415 for a disallowed type', async () => {
      const w = await world();
      await w.upload(w.member.token, { filename: 'run.exe' }).expect(415);
    });

    it('415 for a file that is not what its extension claims (a renamed HTML file)', async () => {
      const w = await world();
      await w
        .upload(w.member.token, { buffer: Buffer.from('<script>alert(1)</script>'), filename: 'holiday.png' })
        .expect(415);
      expect(await prisma.attachment.count()).toBe(0);
    });

    it('413 for a file over the size limit, and nothing is stored', async () => {
      const w = await world();
      const tooBig = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]); // > 1 MB
      await w.upload(w.member.token, { buffer: tooBig }).expect(413);
      expect(await prisma.attachment.count()).toBe(0);
    });

    it('409 once a task has 20 attachments', async () => {
      const w = await world();
      await prisma.attachment.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          taskId: w.taskId,
          fileName: `f${i}.png`,
          storageKey: `attachments/limit-test/${i}.png`,
          mimeType: 'image/png',
          sizeBytes: 1,
        })),
      });
      await w.upload(w.member.token).expect(409);
    });
  });

  describe('authorization and tenant isolation', () => {
    it('401 without a token', async () => {
      const w = await world();
      await api().get(w.attachmentsPath()).expect(401);
      await api().post(w.attachmentsPath()).expect(401);
    });

    it('404 for someone outside the organisation - on list, upload and download', async () => {
      const w = await world();
      const created = await w.upload(w.member.token).expect(201);

      await api().get(w.attachmentsPath()).set('Authorization', bearer(w.outsider.token)).expect(404);
      await w.upload(w.outsider.token).expect(404);
      await api()
        .get(`${w.attachmentsPath()}/${created.body.id}/download`)
        .set('Authorization', bearer(w.outsider.token))
        .expect(404);
      expect(await prisma.attachment.count()).toBe(1);
    });

    it('an attachment is only reachable through ITS OWN task (404 via another task)', async () => {
      const w = await world();
      const otherTask = await w.createTask('Another task');
      const created = await w.upload(w.member.token).expect(201);

      await api()
        .get(`${w.attachmentsPath(otherTask)}/${created.body.id}/download`)
        .set('Authorization', bearer(w.lead.token))
        .expect(404);
      await api()
        .delete(`${w.attachmentsPath(otherTask)}/${created.body.id}`)
        .set('Authorization', bearer(w.lead.token))
        .expect(404);
    });

    it('rejects a malformed attachment id with 400', async () => {
      const w = await world();
      await api()
        .get(`${w.attachmentsPath()}/not-a-uuid/download`)
        .set('Authorization', bearer(w.lead.token))
        .expect(400);
    });
  });

  describe('delete', () => {
    it('lets the uploader delete their file; the row and the stored bytes are both gone', async () => {
      const w = await world();
      const created = await w.upload(w.member.token).expect(201);
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(filesOnDisk(row.storageKey)).toBe(true);

      await api()
        .delete(`${w.attachmentsPath()}/${created.body.id}`)
        .set('Authorization', bearer(w.member.token))
        .expect(204);

      expect(await prisma.attachment.count()).toBe(0);
      expect(filesOnDisk(row.storageKey)).toBe(false);
    });

    it('403 when a plain member deletes someone else\'s file; a project lead may', async () => {
      const w = await world();
      const leadUpload = await w.upload(w.lead.token).expect(201);

      await api()
        .delete(`${w.attachmentsPath()}/${leadUpload.body.id}`)
        .set('Authorization', bearer(w.member.token))
        .expect(403);
      expect(await prisma.attachment.count()).toBe(1);

      const memberUpload = await w.upload(w.member.token).expect(201);
      await api()
        .delete(`${w.attachmentsPath()}/${memberUpload.body.id}`)
        .set('Authorization', bearer(w.lead.token))
        .expect(204);
    });
  });

  describe('orphaned file cleanup', () => {
    it('deleting a task removes the row; the nightly sweep then removes the old orphaned file but keeps attached ones', async () => {
      const w = await world();
      const keptTask = await w.createTask('Keep me');
      const orphaned = await w.upload(w.member.token).expect(201);
      const kept = await w.upload(w.member.token, { task: keptTask }).expect(201);
      const orphanedRow = await prisma.attachment.findUniqueOrThrow({ where: { id: orphaned.body.id } });
      const keptRow = await prisma.attachment.findUniqueOrThrow({ where: { id: kept.body.id } });

      // Deleting the task cascades to the attachment ROW only - the file stays.
      await api()
        .delete(`/organizations/${w.orgId}/projects/${w.projectId}/boards/${w.boardId}/tasks/${w.taskId}`)
        .set('Authorization', bearer(w.lead.token))
        .expect(204);
      expect(await prisma.attachment.count({ where: { id: orphaned.body.id } })).toBe(0);
      expect(filesOnDisk(orphanedRow.storageKey)).toBe(true);

      // Make both files "old" (past the 24h grace period), then run the sweep.
      const old = new Date(Date.now() - 48 * 3600 * 1000);
      await utimes(join(storageDir, orphanedRow.storageKey), old, old);
      await utimes(join(storageDir, keptRow.storageKey), old, old);
      await maintenanceQueue(app).add('sweep-orphaned-files', {});

      await eventually(async () => {
        expect(filesOnDisk(orphanedRow.storageKey)).toBe(false);
      });
      expect(filesOnDisk(keptRow.storageKey)).toBe(true);
    });

    it('does not touch a fresh orphan: it may be an upload still in progress', async () => {
      const w = await world();
      const created = await w.upload(w.member.token).expect(201);
      const row = await prisma.attachment.findUniqueOrThrow({ where: { id: created.body.id } });
      await prisma.attachment.delete({ where: { id: row.id } }); // simulate a missing row

      await maintenanceQueue(app).add('sweep-orphaned-files', {});
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(filesOnDisk(row.storageKey)).toBe(true);
    });
  });
});
