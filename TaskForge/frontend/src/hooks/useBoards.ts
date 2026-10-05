import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { boardApi, taskApi } from '../services/api';

export function useBoards(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['boards', orgId, projectId],
    queryFn: () => boardApi.list(orgId, projectId),
  });
}

/** The full board view: columns, each with its tasks, in one request. */
export function useBoard(orgId: string, projectId: string, boardId: string) {
  return useQuery({
    queryKey: ['board', boardId],
    queryFn: () => boardApi.get(orgId, projectId, boardId),
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
 * Mutations that change what is ON a board. Each one invalidates the board's
 * cache entry, so the board re-fetches and shows the server's real state -
 * including the re-numbered positions the server computes, which the client
 * deliberately does not try to reproduce.
 */
export function useBoardActions(
  orgId: string,
  projectId: string,
  boardId: string,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['board', boardId] });

  const createColumn = useMutation({
    mutationFn: (name: string) =>
      boardApi.createColumn(orgId, projectId, boardId, name),
    onSuccess: refresh,
  });

  const createTask = useMutation({
    mutationFn: (input: { columnId: string; title: string }) =>
      taskApi.create(orgId, projectId, boardId, input),
    onSuccess: refresh,
  });

  const moveTask = useMutation({
    mutationFn: (input: { taskId: string; columnId: string }) =>
      taskApi.move(orgId, projectId, boardId, input.taskId, input.columnId),
    onSuccess: refresh,
  });

  return { createColumn, createTask, moveTask };
}
