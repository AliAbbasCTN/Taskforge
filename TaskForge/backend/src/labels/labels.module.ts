import { Module } from '@nestjs/common';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';

@Module({
  controllers: [LabelsController],
  providers: [
    LabelsService,
    OrganizationMembershipGuard,
    ProjectGuard,
    ProjectPermissionGuard,
    ProjectActiveGuard,
  ],
})
export class LabelsModule {}
