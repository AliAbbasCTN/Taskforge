import { Module } from '@nestjs/common';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Search over tasks. See docs/phase-14-concepts.md. */
@Module({
  controllers: [SearchController],
  providers: [SearchService, OrganizationMembershipGuard, ProjectGuard],
})
export class SearchModule {}
