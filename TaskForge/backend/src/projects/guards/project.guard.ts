import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { isUuid } from '../../common/utils/is-uuid';
import { Permission } from '../../common/authorization/permission.enum';
import { organizationRoleHasPermission } from '../../common/authorization/organization-permissions';
import { RequestMembership } from '../../organizations/decorators/current-membership.decorator';

/**
 * WHAT: The visibility gate for a single project. It answers three
 * questions in one place and attaches the results to the request:
 *
 *   1. Does project `:projectId` exist?
 *   2. Does it belong to organization `:id` from the URL?
 *   3. Is this user ALLOWED TO KNOW it exists - i.e. are they a member of
 *      the project, or an organization ADMIN/MANAGER with org-wide
 *      oversight (`Permission.OrganizationProjectsManageAny`)?
 *
 * If ANY answer is no, the response is the same 404 "Project not found".
 *
 * WHY this goes one step further than `TeamGuard`: teams are visible to
 * every member of their organization, so `TeamGuard` only has to prove the
 * team belongs to the URL's organization (the IDOR check). Projects are
 * private to their members, so this guard ALSO has to prove the requester
 * is allowed to see this particular project. Being in the organization is
 * necessary but no longer sufficient.
 *
 * WHY 404, not 403, for a project the requester can't see: a 403 would
 * confirm "this project exists, you just can't have it", letting someone
 * probe which project IDs are real - and the existence of a project named
 * "Layoffs 2026" is itself sensitive. A 404 is indistinguishable from the
 * project not existing. (Contrast `ProjectPermissionGuard`, which DOES
 * return 403: by the time it runs, the requester has proven they may see
 * the project, so denying a specific action on it leaks nothing.)
 *
 * WHY one query: the project and the requester's own membership row are
 * fetched together with a Prisma `include` filtered to the current user -
 * a single database round trip instead of two. The membership is attached
 * as `request.projectMembership` so `ProjectPermissionGuard` and the
 * controller never need to query it again. It is `null` for an ADMIN or
 * MANAGER acting on a project they are not personally a member of.
 *
 * WHERE: `@UseGuards(..., ProjectGuard)` on every
 * `/organizations/:id/projects/:projectId...` route. Must run after
 * `OrganizationMembershipGuard` (reads `request.membership`).
 */
@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const organizationId: string | undefined = request.params?.id;
    const projectId: string | undefined = request.params?.projectId;
    const orgMembership: RequestMembership | undefined = request.membership;
    const userId: string | undefined = request.user?.id;

    // Missing pieces mean the guard chain is misconfigured - fail closed.
    // A malformed ID is "not found" too: guards run before `ParseUUIDPipe`,
    // so the raw string must never reach the database - see `isUuid`.
    if (
      !isUuid(organizationId) ||
      !isUuid(projectId) ||
      !orgMembership ||
      !userId
    ) {
      throw new NotFoundException('Project not found');
    }

    const found = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { memberships: { where: { userId }, take: 1 } },
    });

    // Question 1 and 2: exists, and belongs to THIS organization.
    if (!found || found.organizationId !== organizationId) {
      throw new NotFoundException('Project not found');
    }

    const { memberships, ...project } = found;
    const projectMembership = memberships[0] ?? null;

    // Question 3: allowed to know it exists?
    const hasOrgWideOversight = organizationRoleHasPermission(
      orgMembership.role,
      Permission.OrganizationProjectsManageAny,
    );
    if (!projectMembership && !hasOrgWideOversight) {
      throw new NotFoundException('Project not found');
    }

    request.project = project;
    request.projectMembership = projectMembership;
    return true;
  }
}
