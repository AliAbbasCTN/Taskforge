import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * WHAT: The validated shape for `POST .../tasks/:taskId/move`.
 *
 * WHY moving is its own action rather than a field on `PATCH`: a move is
 * not "edit a property", it is a coordinated change to TWO orderings (the
 * source column closes the gap, the target column makes room). Giving it its
 * own route keeps that transaction explicit and keeps `PATCH` for plain
 * edits. Moving to a different column IS how a task's status changes.
 *
 * `position` is a zero-based index in the target column; omit it to place
 * the task at the bottom.
 */
export class MoveTaskDto {
  @IsUUID()
  columnId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
