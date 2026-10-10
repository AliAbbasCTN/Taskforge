import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  connectRealtime,
  disconnectRealtime,
  getConnectionState,
  joinProject,
  onConnectionState,
  onNotification,
  onProjectChanged,
  type ConnectionState,
} from '../services/realtime';
import { queryKeysForChange } from '../utils/realtimeInvalidation';

/**
 * WHAT: Opens the live connection while the user is logged in. Mounted once,
 * in `AppLayout` (which only exists for logged-in users), so it connects on
 * login and disconnects on logout automatically - the component's lifetime IS
 * the connection's lifetime.
 *
 * It also reacts to new notifications by refetching the inbox and the unread
 * badge. React's StrictMode mounts, unmounts and re-mounts every effect once
 * in development; connect/disconnect are written to survive that.
 */
export function useRealtimeConnection(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    connectRealtime();
    const stopListening = onNotification(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      stopListening();
      disconnectRealtime();
    };
  }, [queryClient]);
}

/**
 * WHAT: Keeps a screen live while it is showing a project: joins the
 * project's room, and when someone changes something there, refetches the
 * affected queries.
 *
 * Note it does NOT ignore changes made by the current user. They arrive as an
 * echo of the user's own action (a harmless extra refetch), but skipping them
 * would also hide changes the same person makes in another browser tab.
 *
 * What it cannot do: if the user has no access to the project, the server
 * simply refuses the join and nothing ever arrives - the HTTP API has already
 * shown them a "not found" page by then.
 */
export function useProjectRealtime(projectId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const leave = joinProject(projectId);
    const stopListening = onProjectChanged((event) => {
      if (event.projectId !== projectId) {
        return;
      }
      for (const queryKey of queryKeysForChange(event)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    });
    return () => {
      stopListening();
      leave();
    };
  }, [projectId, queryClient]);
}

/** Whether the live connection is up. Re-renders when it changes. */
export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(onConnectionState, getConnectionState);
}
