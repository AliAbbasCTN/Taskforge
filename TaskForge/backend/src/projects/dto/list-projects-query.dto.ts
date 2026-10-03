import { IsEnum, IsOptional } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

/**
 * WHAT: The validated shape of the query string for
 * `GET /organizations/:id/projects`, e.g. `?status=ARCHIVED`.
 *
 * Omitted means ACTIVE - the common case. Query parameters are untrusted
 * input just like request bodies, so they go through a DTO too.
 * Pagination arrives with search and filtering in Phase 14.
 */
export class ListProjectsQueryDto {
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
