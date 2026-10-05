import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectApi } from '../services/api';
import type { ProjectStatus } from '../types/api';

export function useProjects(orgId: string, status: ProjectStatus) {
  return useQuery({
    queryKey: ['projects', orgId, status],
    queryFn: () => projectApi.list(orgId, status),
  });
}

export function useProject(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['project', orgId, projectId],
    queryFn: () => projectApi.get(orgId, projectId),
  });
}

export function useProjectMembers(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['project-members', orgId, projectId],
    queryFn: () => projectApi.members(orgId, projectId),
  });
}

export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      projectApi.create(orgId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] }),
  });
}

/**
 * Archive, unarchive and delete a project. Archiving moves a project between
 * the "Active" and "Archived" lists, so every list for this organization is
 * invalidated along with the project's own cache entry.
 */
export function useProjectActions(orgId: string, projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['project', orgId, projectId] }),
    ]);

  const archive = useMutation({
    mutationFn: () => projectApi.archive(orgId, projectId),
    onSuccess: refresh,
  });
  const unarchive = useMutation({
    mutationFn: () => projectApi.unarchive(orgId, projectId),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => projectApi.remove(orgId, projectId),
    onSuccess: () => {
      // Drop the deleted project from the cache so nothing tries to refetch
      // something that no longer exists (that would just 404).
      queryClient.removeQueries({ queryKey: ['project', orgId, projectId] });
      return queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
    },
  });

  return { archive, unarchive, remove };
}
