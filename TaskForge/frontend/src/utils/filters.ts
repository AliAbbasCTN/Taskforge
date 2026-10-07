import type { TaskPriority } from '../types/api';

/** The task filters the board and list share. All optional; all must match. */
export interface TaskFilters {
  priority?: TaskPriority;
  assigneeId?: string;
  labelId?: string;
  overdue?: boolean;
}

export const PRIORITIES: readonly TaskPriority[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
];

const FILTER_KEYS = ['priority', 'assigneeId', 'labelId', 'overdue'] as const;

/**
 * WHAT: Reads filters out of the page's URL (`?priority=HIGH&overdue=true`).
 *
 * WHY filters live in the URL rather than component state: a filtered board
 * can be bookmarked and shared, the back button undoes a filter change, and a
 * reload keeps the view. The URL is also user-editable, so every value is
 * treated as untrusted: an unknown priority is simply ignored here (and the
 * backend would reject it with a 400 anyway).
 */
export function filtersFromSearchParams(params: URLSearchParams): TaskFilters {
  const filters: TaskFilters = {};

  const priority = params.get('priority');
  if (priority && (PRIORITIES as readonly string[]).includes(priority)) {
    filters.priority = priority as TaskPriority;
  }
  const assigneeId = params.get('assigneeId');
  if (assigneeId) {
    filters.assigneeId = assigneeId;
  }
  const labelId = params.get('labelId');
  if (labelId) {
    filters.labelId = labelId;
  }
  if (params.get('overdue') === 'true') {
    filters.overdue = true;
  }
  return filters;
}

/**
 * Writes `filters` into a copy of `base`, replacing any filter already
 * there and leaving every other parameter (like `view`) untouched.
 */
export function filtersToSearchParams(
  filters: TaskFilters,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of FILTER_KEYS) {
    params.delete(key);
  }
  if (filters.priority) {
    params.set('priority', filters.priority);
  }
  if (filters.assigneeId) {
    params.set('assigneeId', filters.assigneeId);
  }
  if (filters.labelId) {
    params.set('labelId', filters.labelId);
  }
  if (filters.overdue) {
    params.set('overdue', 'true');
  }
  return params;
}

/** The query-string form for the API (`priority=HIGH&overdue=true`), or ''. */
export function filtersToQuery(filters: TaskFilters): string {
  return filtersToSearchParams(filters).toString();
}

export function hasActiveFilters(filters: TaskFilters): boolean {
  return filtersToQuery(filters) !== '';
}
