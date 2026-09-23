import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';

/** Attached to the request by `OrganizationMembershipGuard` once it has
 * confirmed the current user belongs to the organization in the route. */
export interface RequestMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
}

/**
 * WHAT: A parameter decorator that pulls the current user's membership
 * (including their role in this specific organization) off the request.
 *
 * WHERE: Only meaningful on routes protected by `OrganizationMembershipGuard`,
 * which is what actually populates `request.membership`.
 */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMembership => {
    const request = ctx.switchToHttp().getRequest();
    return request.membership;
  },
);
