import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectGuard } from './guards/project.guard';
import { ProjectPermissionGuard } from './guards/project-permission.guard';

/**
 * `OrganizationMembershipGuard` is registered here as its own provider for
 * the same reason `TeamsModule` does it: it is a small, stateless guard
 * whose only dependency (`PrismaService`) is globally available, so reusing
 * the class avoids coupling this module to `OrganizationsModule`'s
 * internals.
 */
@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    OrganizationMembershipGuard,
    ProjectGuard,
    ProjectPermissionGuard,
  ],
})
export class ProjectsModule {}
