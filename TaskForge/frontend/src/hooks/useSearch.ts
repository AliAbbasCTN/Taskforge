import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchApi, type TaskSearchParams } from '../services/api';

/**
 * Task search results. `enabled` is false until there is something to search
 * for - the backend rejects an empty query, and there is nothing to show yet.
 * `keepPreviousData` keeps the old results on screen while new ones load, so
 * typing or changing a filter doesn't flash a spinner.
 */
export function useTaskSearch(
  orgId: string,
  projectId: string,
  params: TaskSearchParams,
) {
  return useQuery({
    queryKey: ['task-search', projectId, params],
    queryFn: () => searchApi.tasks(orgId, projectId, params),
    enabled: params.q.trim() !== '',
    placeholderData: keepPreviousData,
  });
}
