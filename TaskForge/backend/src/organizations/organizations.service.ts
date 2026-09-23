import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { slugify } from '../common/utils/slugify';
import {
  SAFE_USER_SELECT,
  SafeUser,
  UsersService,
} from '../users/users.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';

export interface OrganizationWithRole {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberSummary {
  membershipId: string;
  role: MembershipRole;
  joinedAt: Date;
  user: SafeUser;
}

const MAX_SLUG_ATTEMPTS = 5;

/**
 * WHAT: Business logic for organizations and their memberships - creating a
 * tenant, listing which tenants a user belongs to, and managing who else
 * belongs to one.
 *
 * WHERE: Injected into `OrganizationsController`. Route-level tenant
 * isolation is enforced by `OrganizationMembershipGuard` and
 * `OrganizationAdminGuard` BEFORE these methods ever run - this service
 * trusts that a caller reaching e.g. `findOne()` has already been confirmed
 * as a member of the organization in question. It does not re-check that
 * itself, to avoid the check existing in two places that could drift apart.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Creates a new organization and makes the creator its first ADMIN, as a
   * single atomic transaction - if either half failed independently, we
   * could end up with an organization that has no admin at all, or worse,
   * no members at all and no way for anyone to manage it.
   */
  async create(
    name: string,
    creatorUserId: string,
  ): Promise<OrganizationWithRole> {
    const slug = await this.generateUniqueSlug(name);

    const { organization, membership } = await this.prisma.$transaction(
      async (tx) => {
        const organization = await tx.organization.create({
          data: { name, slug },
        });
        const membership = await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: creatorUserId,
            role: MembershipRole.ADMIN,
          },
        });
        return { organization, membership };
      },
    );

    return { ...organization, role: membership.role };
  }

  /** Every organization the given user belongs to, with their role in each. */
  async findAllForUser(userId: string): Promise<OrganizationWithRole[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({ ...m.organization, role: m.role }));
  }

  /**
   * Fetches a single organization by id. Callers reach this method only
   * after `OrganizationMembershipGuard` has already confirmed membership -
   * see the class-level note above.
   */
  async findOne(
    id: string,
  ): Promise<Prisma.OrganizationGetPayload<Record<string, never>>> {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    return this.prisma.organization.update({
      where: { id },
      data: { name: dto.name },
    });
  }

  async listMembers(organizationId: string): Promise<MemberSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      joinedAt: m.createdAt,
      user: m.user,
    }));
  }

  /**
   * Adds an EXISTING TaskForge user to the organization by email. Does not
   * create an account or send an invitation email - see AddMemberDto for
   * why that's a deliberate, temporary limitation.
   */
  async addMember(
    organizationId: string,
    dto: AddMemberDto,
  ): Promise<MemberSummary> {
    const user = await this.usersService.findByEmailSafe(dto.email);
    if (!user) {
      throw new NotFoundException(
        'No user is registered with that email address',
      );
    }

    try {
      const membership = await this.prisma.membership.create({
        data: {
          organizationId,
          userId: user.id,
          role: dto.role ?? MembershipRole.MEMBER,
        },
      });
      return {
        membershipId: membership.id,
        role: membership.role,
        joinedAt: membership.createdAt,
        user,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This user is already a member of the organization',
        );
      }
      throw error;
    }
  }

  async removeMember(
    organizationId: string,
    targetUserId: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: targetUserId, organizationId },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'That user is not a member of this organization',
      );
    }

    if (membership.role === MembershipRole.ADMIN) {
      await this.assertNotLastAdmin(organizationId);
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });
  }

  async updateMemberRole(
    organizationId: string,
    targetUserId: string,
    newRole: MembershipRole,
  ): Promise<MemberSummary> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: targetUserId, organizationId },
      },
      include: { user: { select: SAFE_USER_SELECT } },
    });

    if (!membership) {
      throw new NotFoundException(
        'That user is not a member of this organization',
      );
    }

    if (
      membership.role === MembershipRole.ADMIN &&
      newRole !== MembershipRole.ADMIN
    ) {
      await this.assertNotLastAdmin(organizationId);
    }

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: { role: newRole },
    });

    return {
      membershipId: updated.id,
      role: updated.role,
      joinedAt: updated.createdAt,
      user: membership.user,
    };
  }

  /**
   * WHY this exists: without it, the last admin of an organization could
   * demote or remove themselves (or be removed by another admin), leaving
   * the organization with no one able to manage it - members stuck, no way
   * to add anyone else, no way to fix it short of direct database access.
   * This is a basic safety rail, not full RBAC (Phase 06).
   */
  private async assertNotLastAdmin(organizationId: string): Promise<void> {
    const adminCount = await this.prisma.membership.count({
      where: { organizationId, role: MembershipRole.ADMIN },
    });
    if (adminCount <= 1) {
      throw new ConflictException(
        'Cannot remove or demote the last remaining admin of an organization',
      );
    }
  }

  /**
   * Generates a URL-safe slug from the organization name, resolving
   * collisions by appending a short random suffix. We retry a bounded
   * number of times rather than looping forever, so a pathological edge
   * case fails loudly instead of hanging the request.
   */
  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'organization';

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate =
        attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      const existing = await this.prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new ConflictException(
      'Could not generate a unique organization identifier, please try a different name',
    );
  }
}
