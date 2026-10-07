import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { taskApi, type TaskListParams, type TaskUpdate } from '../services/api';

/** One task, with assignee and labels - for the detail panel. */
export function useTask(
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskApi.get(orgId, projectId, boardId, taskId),
  });
}

/**
 * A page of tasks for the list view. `keepPreviousData` keeps the current page
 * on screen while the next one loads, instead of flashing a spinner on every
 * page turn or sort change.
 */
export function useTaskList(
  orgId: string,
  projectId: string,
  boardId: string,
  params: TaskListParams,
) {
  return useQuery({
    queryKey: ['tasks', boardId, params],
    queryFn: () => taskApi.list(orgId, projectId, boardId, params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Edits to a single task. A task appears in several cached places (its own
 * detail, the board view, the list), so every successful change invalidates
 * all of them and each refetches what it needs.
 */
export function useTaskActions(
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['board', boardId] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', boardId] }),
    ]);

  const update = useMutation({
    mutationFn: (input: TaskUpdate) =>
      taskApi.update(orgId, projectId, boardId, taskId, input),
    onSuccess: refresh,
  });

  const setLabels = useMutation({
    mutationFn: (labelIds: string[]) =>
      taskApi.setLabels(orgId, projectId, boardId, taskId, labelIds),
    onSuccess: refresh,
  });

  const move = useMutation({
    mutationFn: (columnId: string) =>
      taskApi.move(orgId, projectId, boardId, taskId, columnId),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => taskApi.remove(orgId, projectId, boardId, taskId),
    onSuccess: () => {
      // The task is gone: drop its cache entry so nothing refetches a 404.
      queryClient.removeQueries({ queryKey: ['task', taskId] });
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['board', boardId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', boardId] }),
      ]);
    },
  });

  return { update, setLabels, move, remove };
}
