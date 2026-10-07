import { Module } from '@nestjs/common';
import { BoardGuard } from '../boards/guards/board.guard';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  controllers: [CommentsController],
  providers: [
    CommentsService,
    OrganizationMembershipGuard,
    ProjectGuard,
    ProjectPermissionGuard,
    ProjectActiveGuard,
    BoardGuard,
  ],
})
export class CommentsModule {}
