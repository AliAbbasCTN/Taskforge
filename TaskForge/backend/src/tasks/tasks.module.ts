import { Module } from '@nestjs/common';
import { BoardGuard } from '../boards/guards/board.guard';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [
    TasksService,
    OrganizationMembershipGuard,
    ProjectGuard,
    ProjectPermissionGuard,
    ProjectActiveGuard,
    BoardGuard,
  ],
})
export class TasksModule {}
