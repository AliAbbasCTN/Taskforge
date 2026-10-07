import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ProjectMembership } from '@prisma/client';

/**
 * WHAT: Injects the requester's membership of the current project into a
 * controller parameter: `@CurrentProjectMembership() pm: ProjectMembership | null`.
 *
 * `ProjectGuard` loads it onto the request. It is `null` for an organization
 * ADMIN/MANAGER who can see the project through org-wide oversight without
 * being a member. Same idea as `@CurrentMembership()` for organizations.
 */
export const CurrentProjectMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProjectMembership | null => {
    return context.switchToHttp().getRequest().projectMembership ?? null;
  },
);
