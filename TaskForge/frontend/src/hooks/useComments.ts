import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commentApi } from '../services/api';

export function useComments(
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) {
  return useQuery({
    queryKey: ['comments', taskId],
    queryFn: () => commentApi.list(orgId, projectId, boardId, taskId),
  });
}

export function useCommentActions(
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['comments', taskId] });

  const create = useMutation({
    mutationFn: (body: string) =>
      commentApi.create(orgId, projectId, boardId, taskId, body),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: (input: { commentId: string; body: string }) =>
      commentApi.update(
        orgId,
        projectId,
        boardId,
        taskId,
        input.commentId,
        input.body,
      ),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      commentApi.remove(orgId, projectId, boardId, taskId, commentId),
    onSuccess: refresh,
  });

  return { create, update, remove };
}
