import { Label, Prisma } from '@prisma/client';
import { SAFE_USER_SELECT } from '../users/users.service';

/**
 * WHAT: What every task response carries along with the task row itself:
 * its assignee (through `SAFE_USER_SELECT`, so credentials are never read)
 * and its labels, ordered by name.
 *
 * Defined once so the board view, the task detail, and the task list can't
 * disagree about what "a task" looks like.
 */
export const TASK_INCLUDE = {
  assignee: { select: SAFE_USER_SELECT },
  labels: {
    include: { label: true },
    orderBy: { label: { name: 'asc' } },
  },
} satisfies Prisma.TaskInclude;

/** The task list also shows which column each task is in. */
export const TASK_LIST_INCLUDE = {
  ...TASK_INCLUDE,
  column: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

/**
 * WHAT: Turns Prisma's join-table shape into the one the API promises.
 *
 * Prisma returns `labels: [{ taskId, labelId, label: {...} }]` - a row of the
 * TaskLabel JOIN table, with the label nested inside. Clients don't care that
 * a join table exists; they want `labels: [{ id, name, color }]`. Keeping that
 * translation in one function keeps the database's shape from leaking into
 * the API.
 */
export function flattenLabels<T extends { labels: { label: Label }[] }>(
  task: T,
): Omit<T, 'labels'> & { labels: Label[] } {
  return { ...task, labels: task.labels.map((entry) => entry.label) };
}
