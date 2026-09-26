import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Team, TeamRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  SAFE_USER_SELECT,
  SafeUser,
  UsersService,
} from '../users/users.service';
import { AddTeamMemberDto } from './dto/add-team-member.dto';

export interface TeamMemberSummary {
  membershipId: string;
  role: TeamRole;
  joinedAt: Date;
  user: SafeUser;
}

/**
 * WHAT: Business logic for teams and their memberships.
 *
 * WHERE: Injected into `TeamsController`. Tenant isolation
 * (organization-level) and team-scoping (this team really belongs to this
 * organization) are enforced by guards BEFORE these methods run - see
 * `TeamGuard` and `TeamLeadGuard`. This service trusts that a caller
 * reaching, say, `update()` has already been confirmed as that team's LEAD.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Creates a team and makes the creator its LEAD, atomically - same
   * reasoning as `OrganizationsService.create()`: if either write failed
   * independently, a team could exist with no lead and no way to manage it.
   */
  async create(
    organizationId: string,
    name: string,
    creatorUserId: string,
  ): Promise<Team> {
    const { team } = await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { organizationId, name } });
      await tx.teamMembership.create({
        data: { teamId: team.id, userId: creatorUserId, role: TeamRole.LEAD },
      });
      return { team };
    });

    return team;
  }

  async findAllForOrg(organizationId: string): Promise<Team[]> {
    return this.prisma.team.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(teamId: string): Promise<Team> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async update(teamId: string, name: string): Promise<Team> {
    return this.prisma.team.update({ where: { id: teamId }, data: { name } });
  }

  async remove(teamId: string): Promise<void> {
    // Cascades to delete every TeamMembership for this team (see the
    // `onDelete: Cascade` on TeamMembership.team in schema.prisma).
    await this.prisma.team.delete({ where: { id: teamId } });
  }

  async listMembers(teamId: string): Promise<TeamMemberSummary[]> {
    const memberships = await this.prisma.teamMembership.findMany({
      where: { teamId },
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
   * Adds an existing organization member to the team. Enforces the one
   * precondition that lives outside the database schema: you can only be on
   * a Team if you're already a MEMBER of that Team's Organization - a team
   * is a subdivision of an organization's people, not an independent list.
   */
  async addMember(
    organizationId: string,
    teamId: string,
    dto: AddTeamMemberDto,
  ): Promise<TeamMemberSummary> {
    const user = await this.usersService.findByEmailSafe(dto.email);
    if (!user) {
      throw new NotFoundException(
        'No user is registered with that email address',
      );
    }

    const orgMembership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
    if (!orgMembership) {
      throw new UnprocessableEntityException(
        'This user must be a member of the organization before joining a team',
      );
    }

    try {
      const membership = await this.prisma.teamMembership.create({
        data: { teamId, userId: user.id, role: dto.role ?? TeamRole.MEMBER },
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
          'This user is already a member of the team',
        );
      }
      throw error;
    }
  }

  async removeMember(teamId: string, targetUserId: string): Promise<void> {
    const membership = await this.prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: targetUserId, teamId } },
    });

    if (!membership) {
      throw new NotFoundException('That user is not a member of this team');
    }

    if (membership.role === TeamRole.LEAD) {
      await this.assertNotLastLead(teamId);
    }

    await this.prisma.teamMembership.delete({ where: { id: membership.id } });
  }

  async updateMemberRole(
    teamId: string,
    targetUserId: string,
    newRole: TeamRole,
  ): Promise<TeamMemberSummary> {
    const membership = await this.prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: targetUserId, teamId } },
      include: { user: { select: SAFE_USER_SELECT } },
    });

    if (!membership) {
      throw new NotFoundException('That user is not a member of this team');
    }

    if (membership.role === TeamRole.LEAD && newRole !== TeamRole.LEAD) {
      await this.assertNotLastLead(teamId);
    }

    const updated = await this.prisma.teamMembership.update({
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
   * Mirrors `OrganizationsService.assertNotLastAdmin()`: without this, a
   * team's only LEAD could remove or demote themselves (or be removed by
   * another lead), leaving a team no one can manage.
   */
  private async assertNotLastLead(teamId: string): Promise<void> {
    const leadCount = await this.prisma.teamMembership.count({
      where: { teamId, role: TeamRole.LEAD },
    });
    if (leadCount <= 1) {
      throw new ConflictException(
        'Cannot remove or demote the last remaining lead of a team',
      );
    }
  }
}
