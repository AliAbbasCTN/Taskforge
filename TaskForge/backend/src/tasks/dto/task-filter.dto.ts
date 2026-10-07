import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TaskPriority } from '@prisma/client';

/**
 * WHAT: Parses `?overdue=true` / `?overdue=false` from a query string.
 *
 * WHY this needs custom code - a classic trap: every query-string value
 * arrives as a STRING, and our global ValidationPipe has
 * `enableImplicitConversion: true`, which converts values to the property's
 * declared type. For a `boolean` property it does `Boolean(value)`, and
 * `Boolean("false")` is `true` (any non-empty string is truthy). Left alone,
 * `?overdue=false` would filter FOR overdue tasks - silently the opposite of
 * what was asked.
 *
 * `@Transform` receives the already-converted value, so we read the ORIGINAL
 * text from `obj[key]` instead.
 */
export const toOptionalBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown => {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (raw === true || raw === 'true') {
    return true;
  }
  if (raw === false || raw === 'false') {
    return false;
  }
  return raw; // anything else fails @IsBoolean() with a clear 400
};

/**
 * WHAT: The filters shared by the board view and the task list. Every field
 * is optional; supplying several means ALL must match (AND).
 *
 * All of it is untrusted input from the URL, validated like a request body:
 * a non-UUID `assigneeId` or an unknown `priority` is a 400, never a query.
 */
export class TaskFilterDto {
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsUUID()
  labelId?: string;

  /** Only tasks whose due date is before today (UTC). */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  overdue?: boolean;
}
