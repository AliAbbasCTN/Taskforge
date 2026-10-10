import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MembershipRole,
  NotificationType,
  Prisma,
  Project,
  ProjectRole,
  ProjectStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Permission } from '../common/authorization/permission.enum';
import { organizationRoleHasPermission } from '../common/authorization/organization-permissions';
import {
  SAFE_USER_SELECT,
  SafeUser,
  UsersService,
} from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddProjectMemberDto } from './dto/add-project-member.dto';

/** What list/detail reads return: the project plus two derived facts. */
export interface ProjectSummary {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** How many people are on the project. */
  memberCount: number;
  /** The requester's own role, or null if they can see the project only
   * through organization-wide oversight (ADMIN/MANAGER, not a member). */
  currentUserRole: ProjectRole | null;
}

export interface ProjectMemberSummary {
  membershipId: string;
  role: ProjectRole;
  joinedAt: Date;
  user: SafeUser;
}

/** A project read together with its member count and the requester's role. */
type ProjectWithSummaryRelations = Project & {
  _count: { memberships: number };
  memberships: { role: ProjectRole }[];
};

/**
 * WHAT: Business logic for projects and their memberships.
 *
 * WHERE: Injected into `ProjectsController`. By the time any method here
 * runs, guards have already established three things: the requester belongs
 * to the organization (`OrganizationMembershipGuard`), the project belongs to
 * that organization AND the requester may see it (`ProjectGuard`), and the
 * requester holds the permission the route needs
 * (`ProjectPermissionGuard`). This service does not repeat those checks -
 * it enforces the rules that guards cannot express: the archived/active
 * lifecycle, the "must be an organization member" precondition, and the
 * "last lead" safety rail.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Creates a project and makes the creator its LEAD, atomically - the same
   * reasoning as `TeamsService.create()`: if the two writes could succeed
   * independently, a project could exist with nobody on it, invisible to
   * every ordinary member.
   */
  async create(
    organizationId: string,
    dto: CreateProjectDto,
    creatorUserId: string,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description ? dto.description : null,
        },
      });
      await tx.projectMembership.create({
        data: {
          projectId: project.id,
          userId: creatorUserId,
          role: ProjectRole.LEAD,
        },
      });
      return project;
    });
  }

  /**
   * Lists the projects in an organization that THIS requester may see.
   *
   * ADMIN/MANAGER (org-wide oversight) see every project. Everyone else sees
   * only projects they are a member of - the `memberships: { some: ... }`
   * filter is what makes projects private. The filter is applied in the
   * database query itself, so a project the requester can't see never even
   * leaves the database.
   */
  async findAllVisible(
    organizationId: string,
    requesterOrgRole: MembershipRole,
    requesterUserId: string,
    status: ProjectStatus = ProjectStatus.ACTIVE,
  ): Promise<ProjectSummary[]> {
    const hasOversight = organizationRoleHasPermission(
      requesterOrgRole,
      Permission.OrganizationProjectsManageAny,
    );

    const where: Prisma.ProjectWhereInput = {
      organizationId,
      status,
      ...(hasOversight
        ? {}
        : { memberships: { some: { userId: requesterUserId } } }),
    };

    // The member count and the requester's own role come back in the SAME
    // query as the projects. Fetching them per project in a loop afterwards
    // would be the classic N+1 query problem (1 query for the list, then N
    // more - one per project).
    const projects = await this.prisma.project.findMany({
      where,
      include: {
        _count: { select: { memberships: true } },
        memberships: {
          where: { userId: requesterUserId },
          select: { role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return projects.map((project) => this.toSummary(project));
  }

  async findOne(
    projectId: string,
    requesterUserId: string,
  ): Promise<ProjectSummary> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        _count: { select: { memberships: true } },
        memberships: {
          where: { userId: requesterUserId },
          select: { role: true },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return this.toSummary(project);
  }

  async update(projectId: string, dto: UpdateProjectDto): Promise<Project> {
    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.description !== undefined) {
      // An empty description clears it; we store NULL, never "".
      data.description = dto.description === '' ? null : dto.description;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Provide at least one field to update (name or description)',
      );
    }

    const project = await this.getOrThrow(projectId);
    this.assertActive(project);

    return this.prisma.project.update({ where: { id: projectId }, data });
  }

  /** Puts an active project away. Reversible - see `unarchive()`. */
  async archive(projectId: string): Promise<Project> {
    const project = await this.getOrThrow(projectId);
    if (project.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException('Project is already archived');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.ARCHIVED, archivedAt: new Date() },
    });
  }

  async unarchive(projectId: string): Promise<Project> {
    const project = await this.getOrThrow(projectId);
    if (project.status === ProjectStatus.ACTIVE) {
      throw new ConflictException('Project is not archived');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.ACTIVE, archivedAt: null },
    });
  }

  /**
   * Permanently deletes a project. Only allowed once it is archived: archive
   * is the undoable step, delete is the point of no return, and forcing the
   * two-step path makes an accidental delete much harder. Cascades to delete
   * every ProjectMembership, board, column and task under it (see the
   * `onDelete: Cascade` chain in schema.prisma).
   */
  async remove(projectId: string): Promise<void> {
    const project = await this.getOrThrow(projectId);
    if (project.status !== ProjectStatus.ARCHIVED) {
      throw new ConflictException(
        'Archive the project before deleting it permanently',
      );
    }

    await this.prisma.project.delete({ where: { id: projectId } });
  }

  async listMembers(projectId: string): Promise<ProjectMemberSummary[]> {
    const memberships = await this.prisma.projectMembership.findMany({
      where: { projectId },
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
   * Adds an existing organization member to the project. Enforces the one
   * precondition that lives outside the database schema: you can only be on
   * a project if you are already a member of that project's organization -
   * otherwise the organization boundary (the tenant boundary) would have a
   * hole in it.
   */
  async addMember(
    organizationId: string,
    projectId: string,
    dto: AddProjectMemberDto,
    actorId: string,
  ): Promise<ProjectMemberSummary> {
    const project = await this.getOrThrow(projectId);
    this.assertActive(project);

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
        'This user must be a member of the organization before joining a project',
      );
    }

    try {
      const membership = await this.prisma.projectMembership.create({
        data: {
          projectId,
          userId: user.id,
          role: dto.role ?? ProjectRole.MEMBER,
        },
      });
      await this.notifications.notify({
        recipientId: user.id,
        actorId,
        type: NotificationType.ADDED_TO_PROJECT,
        projectId,
        subject: project.name,
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
          'This user is already a member of the project',
        );
      }
      throw error;
    }
  }

  async removeMember(projectId: string, targetUserId: string): Promise<void> {
    const project = await this.getOrThrow(projectId);
    this.assertActive(project);

    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: targetUserId, projectId } },
    });
    if (!membership) {
      throw new NotFoundException('That user is not a member of this project');
    }

    if (membership.role === ProjectRole.LEAD) {
      await this.assertNotLastLead(projectId);
    }

    // Tasks assigned to someone who is no longer on the project would be
    // assigned to a person who can't even see them (projects are private),
    // so leaving the project unassigns them - atomically with the removal.
    await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: {
          assigneeId: targetUserId,
          column: { board: { projectId } },
        },
        data: { assigneeId: null },
      }),
      this.prisma.projectMembership.delete({ where: { id: membership.id } }),
    ]);
  }

  async updateMemberRole(
    projectId: string,
    targetUserId: string,
    newRole: ProjectRole,
  ): Promise<ProjectMemberSummary> {
    const project = await this.getOrThrow(projectId);
    this.assertActive(project);

    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: targetUserId, projectId } },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    if (!membership) {
      throw new NotFoundException('That user is not a member of this project');
    }

    if (membership.role === ProjectRole.LEAD && newRole !== ProjectRole.LEAD) {
      await this.assertNotLastLead(projectId);
    }

    const updated = await this.prisma.projectMembership.update({
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
   * Mirrors `TeamsService.assertNotLastLead()`: without this, a project's
   * only LEAD could remove or demote themselves, leaving a project that no
   * member can manage. (An organization ADMIN/MANAGER always still can - see
   * `ProjectPermissionGuard` - but a project should not depend on that
   * escape hatch in ordinary use.)
   */
  private async assertNotLastLead(projectId: string): Promise<void> {
    const leadCount = await this.prisma.projectMembership.count({
      where: { projectId, role: ProjectRole.LEAD },
    });
    if (leadCount <= 1) {
      throw new ConflictException(
        'Cannot remove or demote the last remaining lead of a project',
      );
    }
  }

  /**
   * An archived project is read-only: it can be read, unarchived, or
   * deleted, but not edited and its membership cannot change. Enforced here
   * (not in a guard) because it depends on the project's CURRENT status and
   * only some routes care - guards decide WHO may act, the service decides
   * whether the action makes sense given the project's state.
   */
  private assertActive(project: Project): void {
    if (project.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException(
        'This project is archived. Unarchive it before making changes',
      );
    }
  }

  private async getOrThrow(projectId: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  private toSummary(project: ProjectWithSummaryRelations): ProjectSummary {
    const { _count, memberships, ...fields } = project;
    return {
      ...fields,
      memberCount: _count.memberships,
      currentUserRole: memberships[0]?.role ?? null,
    };
  }
}
