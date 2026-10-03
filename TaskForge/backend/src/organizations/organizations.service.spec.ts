import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { OrganizationsService } from './organizations.service';

/**
 * UNIT tests: OrganizationsService's logic in isolation, with Prisma and
 * UsersService mocked out. These focus on the business rules that live in
 * this service - slug generation/collision handling, and the "can't remove
 * or demote the last admin" safety rail - rather than re-testing Prisma
 * itself or the guards (covered by e2e tests, which run against a real
 * database).
 */
describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    organization: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    membership: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    teamMembership: { deleteMany: jest.Mock };
    projectMembership: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let usersService: { findByEmailSafe: jest.Mock };

  const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const userId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const otherUserId = 'cccccccc-0000-4000-8000-000000000001';

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      membership: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      teamMembership: { deleteMany: jest.fn() },
      projectMembership: { deleteMany: jest.fn() },
      $transaction: jest.fn(),
    };
    usersService = { findByEmailSafe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  describe('create', () => {
    it('creates the organization and an ADMIN membership for the creator, atomically', async () => {
      prisma.organization.findUnique.mockResolvedValue(null); // slug is free
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          organization: {
            create: jest.fn().mockResolvedValue({
              id: orgId,
              name: 'Acme',
              slug: 'acme',
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          },
          membership: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'm1', role: MembershipRole.ADMIN }),
          },
        }),
      );

      const result = await service.create('Acme', userId);

      expect(result.role).toBe(MembershipRole.ADMIN);
      expect(result.slug).toBe('acme');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('appends a random suffix when the base slug is already taken', async () => {
      // First check: "acme" is taken. Second check (with a random suffix): free.
      prisma.organization.findUnique
        .mockResolvedValueOnce({ id: 'existing-org' })
        .mockResolvedValueOnce(null);

      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          organization: {
            create: jest.fn((args) =>
              Promise.resolve({
                id: orgId,
                name: args.data.name,
                slug: args.data.slug,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            ),
          },
          membership: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'm1', role: MembershipRole.ADMIN }),
          },
        }),
      );

      const result = await service.create('Acme', userId);

      expect(result.slug).not.toBe('acme');
      expect(result.slug.startsWith('acme-')).toBe(true);
    });
  });

  describe('findOne', () => {
    it('returns the organization when it exists', async () => {
      const org = {
        id: orgId,
        name: 'Acme',
        slug: 'acme',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.organization.findUnique.mockResolvedValue(org);
      await expect(service.findOne(orgId)).resolves.toEqual(org);
    });

    it('throws NotFoundException when it does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.findOne(orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMember', () => {
    it('throws NotFoundException when no account exists for that email', async () => {
      usersService.findByEmailSafe.mockResolvedValue(null);
      await expect(
        service.addMember(orgId, { email: 'nobody@example.com' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates a P2002 (already a member) into ConflictException', async () => {
      usersService.findByEmailSafe.mockResolvedValue({
        id: otherUserId,
        email: 'x@example.com',
      });
      prisma.membership.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.addMember(orgId, { email: 'x@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('defaults the role to MEMBER when none is specified', async () => {
      usersService.findByEmailSafe.mockResolvedValue({
        id: otherUserId,
        email: 'x@example.com',
      });
      prisma.membership.create.mockResolvedValue({
        id: 'm2',
        role: MembershipRole.MEMBER,
        createdAt: new Date(),
      });

      await service.addMember(orgId, { email: 'x@example.com' });

      expect(prisma.membership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: MembershipRole.MEMBER }),
        }),
      );
    });
  });

  describe('the last-admin safety rail', () => {
    it('removeMember refuses to remove the only remaining admin', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm1',
        userId,
        organizationId: orgId,
        role: MembershipRole.ADMIN,
      });
      prisma.membership.count.mockResolvedValue(1); // only one admin

      await expect(service.removeMember(orgId, userId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });

    it('removeMember allows removing an admin when another admin remains', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm1',
        userId,
        organizationId: orgId,
        role: MembershipRole.ADMIN,
      });
      prisma.membership.count.mockResolvedValue(2);
      prisma.membership.delete.mockResolvedValue({ id: 'm1' });

      await service.removeMember(orgId, userId);
      expect(prisma.membership.delete).toHaveBeenCalledWith({
        where: { id: 'm1' },
      });
    });

    it('removeMember allows removing a non-admin freely, without checking admin count', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm2',
        userId: otherUserId,
        organizationId: orgId,
        role: MembershipRole.MEMBER,
      });
      prisma.membership.delete.mockResolvedValue({ id: 'm2' });

      await service.removeMember(orgId, otherUserId);
      expect(prisma.membership.count).not.toHaveBeenCalled();
      expect(prisma.membership.delete).toHaveBeenCalled();
    });

    it('removeMember also removes team and project memberships in that organization, atomically', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm2',
        userId: otherUserId,
        organizationId: orgId,
        role: MembershipRole.MEMBER,
      });

      await service.removeMember(orgId, otherUserId);

      // Scoped to THIS organization - memberships in other organizations
      // must be untouched.
      expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({
        where: { userId: otherUserId, team: { organizationId: orgId } },
      });
      expect(prisma.projectMembership.deleteMany).toHaveBeenCalledWith({
        where: { userId: otherUserId, project: { organizationId: orgId } },
      });
      // All three deletes are submitted together as ONE transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
    });

    it('removeMember does not touch team/project memberships when the removal is refused', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm1',
        userId,
        organizationId: orgId,
        role: MembershipRole.ADMIN,
      });
      prisma.membership.count.mockResolvedValue(1);

      await expect(service.removeMember(orgId, userId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled();
      expect(prisma.projectMembership.deleteMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('updateMemberRole refuses to demote the only remaining admin', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm1',
        userId,
        organizationId: orgId,
        role: MembershipRole.ADMIN,
        user: { id: userId },
      });
      prisma.membership.count.mockResolvedValue(1);

      await expect(
        service.updateMemberRole(orgId, userId, MembershipRole.MEMBER),
      ).rejects.toThrow(ConflictException);
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('updateMemberRole allows promoting a member to admin without checking admin count', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm2',
        userId: otherUserId,
        organizationId: orgId,
        role: MembershipRole.MEMBER,
        user: { id: otherUserId },
      });
      prisma.membership.update.mockResolvedValue({
        id: 'm2',
        role: MembershipRole.ADMIN,
        createdAt: new Date(),
      });

      await service.updateMemberRole(orgId, otherUserId, MembershipRole.ADMIN);
      expect(prisma.membership.count).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target user is not a member', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      await expect(service.removeMember(orgId, otherUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
