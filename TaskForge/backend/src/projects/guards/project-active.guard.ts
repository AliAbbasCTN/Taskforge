import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';

/**
 * WHAT: Makes a project's CONTENT read-only while the project is archived,
 * by rejecting write routes with 409 Conflict.
 *
 * WHY a guard now, when Phase 07 enforced "archived is read-only" in the
 * service: Phase 07 had one service with a handful of routes. Phase 08 adds
 * about fifteen write routes across two modules (boards/columns and tasks);
 * repeating a status check in every service method is exactly the kind of
 * copy-paste where one missed copy lets someone edit an archived project.
 * `ProjectGuard` has ALREADY loaded the project onto the request, so this
 * guard costs no database query - it just reads `request.project.status`.
 *
 * WHY 409, and why it runs AFTER `ProjectPermissionGuard`: permission first
 * (403 - you may not do this at all), then state (409 - you may, but not
 * right now). That ordering also means someone without permission learns
 * nothing about the project's state.
 *
 * WHERE: `@UseGuards(ProjectPermissionGuard, ProjectActiveGuard)` on every
 * write route under a project's boards and tasks.
 */
@Injectable()
export class ProjectActiveGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const project = request.project;

    // No project on the request means ProjectGuard didn't run first -
    // misconfiguration; fail closed.
    if (!project) {
      throw new ForbiddenException(
        'This action requires a project to be resolved first',
      );
    }

    if (project.status !== ProjectStatus.ACTIVE) {
      throw new ConflictException(
        'This project is archived. Unarchive it before making changes',
      );
    }
    return true;
  }
}
