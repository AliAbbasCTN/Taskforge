import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from './users.service';

/**
 * These are UNIT tests: they test `UsersService`'s logic in isolation, with
 * the database replaced by a mock. No PostgreSQL is required to run them.
 *
 * What we care about here is the behaviour the service adds on top of
 * Prisma - specifically, that low-level database error codes are correctly
 * translated into meaningful HTTP exceptions. That translation is real
 * business logic and worth protecting with tests.
 *
 * Actual database behaviour (does the unique constraint really fire?) is
 * covered by the e2e tests in test/app.e2e-spec.ts, which run against a real
 * database.
 */
describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const mockUser: User = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** Builds a Prisma error with a given code, as the real client would throw. */
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('mock error', {
      code,
      clientVersion: 'test',
    });

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('findAll', () => {
    it('returns all users, newest first', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);

      await expect(service.findAll()).resolves.toEqual([mockUser]);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.findOne(mockUser.id)).resolves.toEqual(mockUser);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne(mockUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates and returns the user', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      await expect(
        service.create({ email: mockUser.email, name: mockUser.name }),
      ).resolves.toEqual(mockUser);
    });

    it('translates a P2002 unique violation into ConflictException', async () => {
      prisma.user.create.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.create({ email: mockUser.email, name: mockUser.name }),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows unexpected errors instead of swallowing them', async () => {
      prisma.user.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.create({ email: mockUser.email, name: mockUser.name }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    it('updates and returns the user', async () => {
      const updated = { ...mockUser, name: 'Ada L.' };
      prisma.user.update.mockResolvedValue(updated);

      await expect(
        service.update(mockUser.id, { name: 'Ada L.' }),
      ).resolves.toEqual(updated);
    });

    it('translates a P2025 missing-record error into NotFoundException', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));

      await expect(service.update(mockUser.id, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the user', async () => {
      prisma.user.delete.mockResolvedValue(mockUser);

      await expect(service.remove(mockUser.id)).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
    });

    it('translates a P2025 missing-record error into NotFoundException', async () => {
      prisma.user.delete.mockRejectedValue(prismaError('P2025'));

      await expect(service.remove(mockUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
