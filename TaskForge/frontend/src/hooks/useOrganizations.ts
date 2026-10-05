import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi } from '../services/api';

/**
 * WHAT: Hooks that fetch and change organizations, built on TanStack Query.
 *
 * WHY a library for server data instead of `useState` + `useEffect` +
 * `fetch`: that hand-rolled version needs, for EVERY request, loading state,
 * error state, caching, de-duplication (three components asking for the same
 * list should cost one request), refetching and cancellation - and it is
 * easy to get subtly wrong. TanStack Query does all of that once, correctly.
 *
 * KEY IDEAS:
 *  - A QUERY (`useQuery`) reads data. Its `queryKey` is its cache identity:
 *    same key = same cached data.
 *  - A MUTATION (`useMutation`) changes data. After it succeeds we
 *    INVALIDATE the affected keys, which marks cached data stale so it is
 *    refetched. The UI then shows what the server actually has.
 */
export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: organizationApi.list,
  });
}

/** One organization from the list, which includes the current user's role in it. */
export function useOrganization(orgId: string | undefined) {
  const query = useOrganizations();
  const organization = query.data?.find((org) => org.id === orgId);
  return { ...query, organization };
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => organizationApi.create(name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations'] }),
  });
}
