import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { PrismaService } from '../database/prisma.service';
import {
  StorageObjectNotFoundError,
  StorageService,
} from '../files/storage/storage.service';
import { AttachmentsService } from './attachments.service';

const scope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  boardId: '33333333-3333-4333-8333-333333333333',
  taskId: '44444444-4444-4444-8444-444444444444',
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let prisma: {
    task: { findFirst: jest.Mock };
    attachment: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };
  let storage: {
    put: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      task: { findFirst: jest.fn().mockResolvedValue({ id: scope.taskId }) },
      attachment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'a1', ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new AttachmentsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  describe('upload', () => {
    it('stores the bytes, then the row, with a server-decided type and a clean name', async () => {
      await service.upload(scope, 'user-1', {
        originalname: '../../evil/photo.PNG',
        buffer: PNG,
      });

      expect(storage.put).toHaveBeenCalledTimes(1);
      const [key, data, contentType] = storage.put.mock.calls[0];
      expect(key).toMatch(
        new RegExp(`^attachments/${scope.organizationId}/${scope.projectId}/${scope.taskId}/[0-9a-f-]{36}\\.png$`),
      );
      expect(data).toBe(PNG);
      expect(contentType).toBe('image/png');

      const created = prisma.attachment.create.mock.calls[0][0].data;
      expect(created).toEqual({
        taskId: scope.taskId,
        uploaderId: 'user-1',
        fileName: 'photo.PNG', // path stripped
        storageKey: key,
        mimeType: 'image/png',
        sizeBytes: PNG.length,
      });
    });

    it('rejects a missing file with 400 and stores nothing', async () => {
      await expect(service.upload(scope, 'u', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects a file whose contents do not match its extension with 415', async () => {
      await expect(
        service.upload(scope, 'u', { originalname: 'a.png', buffer: Buffer.from('<html>') }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects a disallowed type with 415', async () => {
      await expect(
        service.upload(scope, 'u', { originalname: 'run.exe', buffer: PNG }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    });

    it('refuses the 21st attachment with 409', async () => {
      prisma.attachment.count.mockResolvedValue(20);
      await expect(
        service.upload(scope, 'u', { originalname: 'a.png', buffer: PNG }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('404s when the task is not on that board, before touching storage', async () => {
      prisma.task.findFirst.mockResolvedValue(null);
      await expect(
        service.upload(scope, 'u', { originalname: 'a.png', buffer: PNG }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('removes the stored bytes again if the database insert fails', async () => {
      prisma.attachment.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.upload(scope, 'u', { originalname: 'a.png', buffer: PNG }),
      ).rejects.toThrow('db down');

      expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
    });
  });

  describe('openForDownload', () => {
    const row = {
      id: 'a1',
      taskId: scope.taskId,
      uploaderId: 'user-1',
      fileName: 'report.pdf',
      storageKey: 'attachments/x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
    };

    it('scopes the lookup by attachment, task AND board', async () => {
      prisma.attachment.findFirst.mockResolvedValue(row);
      storage.get.mockResolvedValue(Readable.from(['x']));

      const result = await service.openForDownload(scope.boardId, scope.taskId, 'a1');

      expect(prisma.attachment.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'a1',
          taskId: scope.taskId,
          task: { column: { boardId: scope.boardId } },
        },
      });
      expect(result.fileName).toBe('report.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result).not.toHaveProperty('storageKey');
    });

    it('404s for an attachment that is not found in that scope', async () => {
      prisma.attachment.findFirst.mockResolvedValue(null);
      await expect(
        service.openForDownload(scope.boardId, scope.taskId, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s (not 500) when the row exists but the stored file is gone', async () => {
      prisma.attachment.findFirst.mockResolvedValue(row);
      storage.get.mockRejectedValue(new StorageObjectNotFoundError(row.storageKey));
      await expect(
        service.openForDownload(scope.boardId, scope.taskId, 'a1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    const row = { id: 'a1', uploaderId: 'user-1', storageKey: 'attachments/x.pdf' };

    it('lets the uploader delete: row first, then the bytes', async () => {
      prisma.attachment.findFirst.mockResolvedValue(row);

      await service.remove(scope.boardId, scope.taskId, 'a1', 'user-1', false);

      expect(prisma.attachment.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
      expect(storage.delete).toHaveBeenCalledWith('attachments/x.pdf');
    });

    it('lets a moderator delete someone else\'s upload', async () => {
      prisma.attachment.findFirst.mockResolvedValue(row);
      await service.remove(scope.boardId, scope.taskId, 'a1', 'someone-else', true);
      expect(prisma.attachment.delete).toHaveBeenCalled();
    });

    it('forbids a non-moderator deleting someone else\'s upload', async () => {
      prisma.attachment.findFirst.mockResolvedValue(row);
      await expect(
        service.remove(scope.boardId, scope.taskId, 'a1', 'someone-else', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.attachment.delete).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('forbids a non-moderator when the uploader account no longer exists', async () => {
      prisma.attachment.findFirst.mockResolvedValue({ ...row, uploaderId: null });
      await expect(
        service.remove(scope.boardId, scope.taskId, 'a1', 'user-1', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('still succeeds if removing the bytes fails (the sweep cleans up)', async () => {
      prisma.attachment.findFirst.mockResolvedValue(row);
      storage.delete.mockRejectedValue(new Error('S3 timeout'));

      await expect(
        service.remove(scope.boardId, scope.taskId, 'a1', 'user-1', false),
      ).resolves.toBeUndefined();
      expect(prisma.attachment.delete).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('never selects the storage key', async () => {
      await service.list(scope.boardId, scope.taskId);
      const args = prisma.attachment.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ taskId: scope.taskId });
      expect(args.select).not.toHaveProperty('storageKey');
      expect(args.select.fileName).toBe(true);
    });
  });
});
