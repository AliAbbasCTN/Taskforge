import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { notificationApi } from '../services/api';

/** The number on the bell. Refetched whenever a notification arrives live. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationApi.unreadCount,
  });
}

export function useNotificationList(params: {
  page: number;
  pageSize: number;
  unreadOnly: boolean;
}) {
  return useQuery({
    queryKey: ['notifications', 'list', params],
    queryFn: () => notificationApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** Reading changes both the list and the badge, so it invalidates the whole
 * `['notifications']` prefix. */
export function useNotificationActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: refresh,
  });

  return { markRead, markAllRead };
}
