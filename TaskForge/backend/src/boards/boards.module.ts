import { Module } from '@nestjs/common';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { ProjectPermissionGuard } from '../projects/guards/project-permission.guard';
import { ProjectActiveGuard } from '../projects/guards/project-active.guard';
import { BoardsController } from './boards.controller';
import { ColumnsController } from './columns.controller';
import { BoardsService } from './boards.service';
import { ColumnsService } from './columns.service';
import { BoardGuard } from './guards/board.guard';

/**
 * The guard classes are registered as providers here for the same reason
 * `TeamsModule` and `ProjectsModule` do it: they are small and stateless
 * (their only dependency, `PrismaService`, is global), so reusing the
 * classes avoids coupling this module to the internals of the modules that
 * originally defined them.
 */
@Module({
  controllers: [BoardsController, ColumnsController],
  providers: [
    BoardsService,
    ColumnsService,
    OrganizationMembershipGuard,
    ProjectGuard,
    ProjectPermissionGuard,
    ProjectActiveGuard,
    BoardGuard,
  ],
})
export class BoardsModule {}
