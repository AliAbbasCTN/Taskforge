import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { labelApi } from '../services/api';

export function useLabels(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['labels', orgId, projectId],
    queryFn: () => labelApi.list(orgId, projectId),
  });
}

/**
 * Creating or deleting a label changes more than the label list: deleting one
 * removes it from every task that had it, so boards and task lists (which
 * display labels) are refreshed too.
 */
export function useLabelActions(orgId: string, projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['labels', orgId, projectId] }),
      queryClient.invalidateQueries({ queryKey: ['board'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['task'] }),
    ]);

  const create = useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      labelApi.create(orgId, projectId, input),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (labelId: string) =>
      labelApi.remove(orgId, projectId, labelId),
    onSuccess: refresh,
  });

  return { create, remove };
}
