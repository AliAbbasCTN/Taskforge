import { Prisma } from '@prisma/client';
import { TaskFilterDto } from './dto/task-filter.dto';
import { TaskSortField } from './dto/list-tasks-query.dto';

/** Midnight at the start of `now`'s UTC calendar day. */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * WHAT: Translates validated filters into a Prisma `where` clause.
 *
 * Only ever builds a clause out of VALIDATED enum/UUID values and Prisma's
 * own operators - user input is never spliced into SQL text (Prisma
 * parameterizes everything), which is what keeps filtering injection-safe.
 *
 * "Overdue" means the due date is before the start of today (UTC), matching
 * the frontend's `isOverdue`. A task due today is not overdue yet.
 */
export function buildTaskFilterWhere(
  filter: TaskFilterDto,
  now: Date = new Date(),
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};

  if (filter.priority) {
    where.priority = filter.priority;
  }
  if (filter.assigneeId) {
    where.assigneeId = filter.assigneeId;
  }
  if (filter.labelId) {
    where.labels = { some: { labelId: filter.labelId } };
  }
  if (filter.overdue) {
    where.dueDate = { lt: startOfTodayUtc(now) };
  }
  return where;
}

/**
 * WHAT: Translates a sort choice into Prisma's `orderBy`.
 *
 * Two details that matter:
 *  - `priority` sorts by the enum's DECLARED order in PostgreSQL
 *    (LOW < MEDIUM < HIGH < URGENT), which is exactly the meaning we want -
 *    sorting the text alphabetically would put HIGH before LOW before URGENT.
 *  - `dueDate` puts tasks with NO due date last in either direction;
 *    otherwise "soonest first" would start with a pile of undated tasks.
 *
 * A final `id` tie-breaker makes the order TOTAL. Without it, rows with equal
 * sort values can come back in any order, so the same row might appear on two
 * pages (or neither) as you page through.
 */
export function buildTaskOrderBy(
  sortBy: TaskSortField,
  order: 'asc' | 'desc',
): Prisma.TaskOrderByWithRelationInput[] {
  const tieBreaker: Prisma.TaskOrderByWithRelationInput = { id: 'asc' };

  switch (sortBy) {
    case 'dueDate':
      return [{ dueDate: { sort: order, nulls: 'last' } }, tieBreaker];
    case 'priority':
      return [{ priority: order }, tieBreaker];
    case 'title':
      return [{ title: order }, tieBreaker];
    case 'createdAt':
    default:
      return [{ createdAt: order }, tieBreaker];
  }
}
