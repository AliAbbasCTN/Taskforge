import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { boardApi, taskApi } from '../services/api';
import type { BoardView } from '../types/api';
import { applyMove } from '../utils/boardMove';
import type { TaskFilters } from '../utils/filters';

export function useBoards(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['boards', orgId, projectId],
    queryFn: () => boardApi.list(orgId, projectId),
  });
}

/**
 * The full board view, optionally filtered. `filters` is part of the query
 * KEY, so each distinct filter combination is its own cache entry: switching
 * back to a filter you used a moment ago shows instantly.
 */
export function useBoard(
  orgId: string,
  projectId: string,
  boardId: string,
  filters: TaskFilters = {},
) {
  return useQuery({
    queryKey: ['board', boardId, filters],
    queryFn: () => boardApi.get(orgId, projectId, boardId, filters),
  });
}

export function useCreateBoard(orgId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => boardApi.create(orgId, projectId, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['boards', orgId, projectId] }),
  });
}

/**
 * Mutations that change what is ON a board.
 *
 * Creating a task or column waits for the server, then refetches. MOVING a
 * task is different: it is the one action people repeat quickly and expect to
 * feel instant, so it updates the screen OPTIMISTICALLY:
 *
 *   onMutate  - runs before the request. Stop any in-flight refetch (it would
 *               overwrite our guess with stale data), remember the current
 *               board, and show the expected result via `applyMove`.
 *   onError   - the server said no: put the remembered board back.
 *   onSettled - success OR failure: refetch, so what is on screen is always
 *               what the server really has (including the positions it
 *               renumbered). The optimistic copy is only ever a stand-in.
 */
export function useBoardActions(
  orgId: string,
  projectId: string,
  boardId: string,
  filters: TaskFilters = {},
) {
  const queryClient = useQueryClient();
  const boardKey = ['board', boardId, filters] as const;
  const refreshBoard = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['board', boardId] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', boardId] }),
    ]);

  const createColumn = useMutation({
    mutationFn: (name: string) =>
      boardApi.createColumn(orgId, projectId, boardId, name),
    onSuccess: refreshBoard,
  });

  const createTask = useMutation({
    mutationFn: (input: { columnId: string; title: string }) =>
      taskApi.create(orgId, projectId, boardId, input),
    onSuccess: refreshBoard,
  });

  const moveTask = useMutation({
    mutationFn: (input: { taskId: string; columnId: string; position?: number }) =>
      taskApi.move(
        orgId,
        projectId,
        boardId,
        input.taskId,
        input.columnId,
        input.position,
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['board', boardId] });
      const previous = queryClient.getQueryData<BoardView>(boardKey);
      if (previous) {
        queryClient.setQueryData<BoardView>(
          boardKey,
          applyMove(previous, input.taskId, input.columnId, input.position),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<BoardView>(boardKey, context.previous);
      }
    },
    onSettled: refreshBoard,
  });

  return { createColumn, createTask, moveTask };
}
