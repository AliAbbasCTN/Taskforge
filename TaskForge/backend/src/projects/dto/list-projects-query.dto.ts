import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

/**
 * WHAT: The validated shape of the query string for
 * `GET /organizations/:id/projects`, e.g. `?status=ARCHIVED`.
 *
 * Omitted means ACTIVE - the common case. Query parameters are untrusted
 * input just like request bodies, so they go through a DTO too.
 *
 * `search` (Phase 14) narrows the list to projects whose name or description
 * contains the text, case-insensitively. No pagination: an organization's
 * visible projects are a short list - see docs/phase-14-concepts.md for why
 * this is a simple substring match while TASKS get full-text search.
 */
export class ListProjectsQueryDto {
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  /** Trimmed; an empty value means "no search". */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}
