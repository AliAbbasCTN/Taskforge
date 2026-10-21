import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { OrganizationPermissionGuard } from '../organizations/guards/organization-permission.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ActivitySnapshotService } from './activity-snapshot.service';
import { AuditLogController, ProjectActivityController } from './activity.controller';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityService } from './activity.service';

/**
 * Activity feed + audit trail. `APP_INTERCEPTOR` registers the interceptor for
 * the whole application (like the real-time one); it only acts on routes
 * marked `@LogsActivity(...)`.
 */
@Module({
  controllers: [ProjectActivityController, AuditLogController],
  providers: [
    ActivityService,
    ActivitySnapshotService,
    OrganizationMembershipGuard,
    OrganizationPermissionGuard,
    ProjectGuard,
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
