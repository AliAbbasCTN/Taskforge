import {
  Controller,
  Get,
  ParseUUIDPipe,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';
import { ProjectGuard } from '../projects/guards/project.guard';
import { SearchTasksQueryDto } from './dto/search-tasks-query.dto';
import { SearchService } from './search.service';

/**
 * WHAT: Search routes, scoped to one project.
 *
 *   GET /organizations/:id/projects/:projectId/search/tasks?q=login&priority=HIGH
 *
 * Read-only, so it needs only what reading the project needs: a valid token,
 * membership of the organization, and access to the project (members and
 * org admins/managers). A project you cannot see is a 404, exactly as
 * everywhere else.
 */
@Controller('organizations/:id/projects/:projectId/search')
@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, ProjectGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('tasks')
  searchTasks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: SearchTasksQueryDto,
  ) {
    return this.searchService.searchTasks(projectId, query);
  }
}
