import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { activityApi, type ActivityParams } from '../services/api';

/**
 * A project's feed (or one task's timeline, with `taskId`). The key starts with
 * 'activity' so the real-time handler can refresh every feed with one call.
 */
export function useProjectActivity(
  orgId: string,
  projectId: string,
  params: ActivityParams,
) {
  return useQuery({
    queryKey: ['activity', 'project', projectId, params],
    queryFn: () => activityApi.project(orgId, projectId, params),
    placeholderData: keepPreviousData,
  });
}

export function useAuditLog(orgId: string, params: ActivityParams) {
  return useQuery({
    queryKey: ['activity', 'audit', orgId, params],
    queryFn: () => activityApi.audit(orgId, params),
    placeholderData: keepPreviousData,
  });
}
