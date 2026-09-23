import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from './users.service';

/**
 * UNIT tests: UsersService's logic in isolation, with Prisma mocked out.
 * No database is required to run these.
 */
describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    membership: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  const safeUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const otherUserId = '22222222-2222-4222-8222-222222222222';

  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('mock error', {
      code,
      clientVersion: 'test',
    });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      membership: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('findOne', () => {
    it('returns your own profile without needing a shared organization', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      await expect(service.findOne(safeUser.id, safeUser.id)).resolves.toEqual(
        safeUser,
      );
      // No membership lookup needed for a self-lookup.
      expect(prisma.membership.findMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne(safeUser.id, safeUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the profile when the requester shares an organization with the target', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.membership.findMany.mockResolvedValue([
        { organizationId: 'org-1' },
      ]);
      prisma.membership.findFirst.mockResolvedValue({ id: 'membership-1' });

      await expect(service.findOne(safeUser.id, otherUserId)).resolves.toEqual(
        safeUser,
      );
    });

    it('throws NotFoundException (not Forbidden) when no organization is shared', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.membership.findMany.mockResolvedValue([
        { organizationId: 'org-1' },
      ]);
      prisma.membership.findFirst.mockResolvedValue(null);

      await expect(service.findOne(safeUser.id, otherUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester belongs to no organizations at all', async () => {
      prisma.user.findUnique.mockResolvedValue(safeUser);
      prisma.membership.findMany.mockResolvedValue([]);

      await expect(service.findOne(safeUser.id, otherUserId)).rejects.toThrow(
        NotFoundException,
      );
      // Short-circuits before even querying for a shared membership.
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const input = {
      email: safeUser.email,
      name: safeUser.name,
      passwordHash: 'hashed',
    };

    it('creates and returns the safe user fields', async () => {
      prisma.user.create.mockResolvedValue(safeUser);
      await expect(service.create(input)).resolves.toEqual(safeUser);
    });

    it('never returns passwordHash even if somehow present in the result', async () => {
      prisma.user.create.mockResolvedValue(safeUser);
      const result = await service.create(input);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('translates a P2002 unique violation into ConflictException', async () => {
      prisma.user.create.mockRejectedValue(prismaError('P2002'));
      await expect(service.create(input)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('rethrows unexpected errors instead of swallowing them', async () => {
      prisma.user.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.create(input)).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    it('updates and returns the user', async () => {
      const updated = { ...safeUser, name: 'Ada L.' };
      prisma.user.update.mockResolvedValue(updated);
      await expect(
        service.update(safeUser.id, { name: 'Ada L.' }),
      ).resolves.toEqual(updated);
    });

    it('translates a P2025 missing-record error into NotFoundException', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));
      await expect(service.update(safeUser.id, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the user', async () => {
      prisma.user.delete.mockResolvedValue(safeUser);
      await expect(service.remove(safeUser.id)).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: safeUser.id },
      });
    });

    it('translates a P2025 missing-record error into NotFoundException', async () => {
      prisma.user.delete.mockRejectedValue(prismaError('P2025'));
      await expect(service.remove(safeUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
