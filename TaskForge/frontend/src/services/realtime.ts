import { io, type Socket } from 'socket.io-client';
import type { AppNotification, ProjectChangedEvent } from '../types/api';
import { API_URL, refreshTokens } from './http';
import { tokenStore } from './tokenStore';

/**
 * WHAT: The browser's single live connection to the server (a WebSocket, via
 * Socket.IO), and the small API the rest of the app uses to listen to it.
 *
 * It is a plain module, not a React component, for the same reason `http.ts`
 * is: a connection is not part of any one screen - it is opened once after
 * login and shared. React hooks (`hooks/useRealtime.ts`) are the thin bridge.
 *
 * WHAT THE SOCKET IS (AND ISN'T) USED FOR: it only ever carries small "go and
 * look" hints (see `ProjectChangedEvent`). The data itself is always read over
 * authenticated HTTP. So if the connection drops, nothing is lost or wrong -
 * the screen just stops updating by itself until it reconnects.
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

/** After this many failed token handshakes in a row, stop trying - otherwise a
 * broken setup would burn through refresh tokens forever. */
const MAX_AUTH_RETRIES = 2;

let socket: Socket | null = null;
let state: ConnectionState = 'disconnected';
let authRetries = 0;
let reconnecting = false;

/** Which project rooms the UI wants, with a count so two screens watching the
 * same project don't fight over it. Re-joined automatically after reconnects. */
const rooms = new Map<string, number>();

const stateListeners = new Set<() => void>();
const changeListeners = new Set<(event: ProjectChangedEvent) => void>();
const notificationListeners = new Set<(n: AppNotification) => void>();

function setState(next: ConnectionState): void {
  if (state === next) {
    return;
  }
  state = next;
  stateListeners.forEach((listener) => listener());
}

/**
 * The server closes a socket when its access token expires (and refuses a
 * socket whose token is already invalid). Socket.IO does NOT reconnect by
 * itself after a server-initiated close, so we refresh the session and
 * connect again - the `auth` callback below then picks up the NEW token.
 */
async function reconnectWithFreshToken(): Promise<void> {
  if (!socket || reconnecting) {
    return;
  }
  if (authRetries >= MAX_AUTH_RETRIES) {
    setState('disconnected');
    return;
  }
  reconnecting = true;
  authRetries += 1;
  try {
    if (await refreshTokens()) {
      setState('connecting');
      socket?.connect();
    } else {
      setState('disconnected'); // session is over; the login page takes it from here
    }
  } finally {
    reconnecting = false;
  }
}

export function connectRealtime(): void {
  if (socket) {
    return;
  }

  socket = io(API_URL, {
    autoConnect: false,
    // WebSocket only: skipping the HTTP long-polling fallback means no sticky
    // sessions are needed behind a load balancer.
    transports: ['websocket'],
    // A FUNCTION, so every connection attempt reads the CURRENT token rather
    // than whatever was current when the socket was created.
    auth: (callback) => callback({ token: tokenStore.getAccessToken() }),
  });

  socket.on('connect', () => {
    authRetries = 0;
    setState('connected');
    // Rooms are per-connection on the server, so a fresh connection starts in
    // none: ask for every project the UI is watching again.
    for (const projectId of rooms.keys()) {
      socket?.emit('project:join', { projectId });
    }
  });

  socket.on('disconnect', (reason) => {
    setState('disconnected');
    if (reason === 'io server disconnect') {
      void reconnectWithFreshToken();
    }
  });

  socket.on('connect_error', (error) => {
    setState('disconnected');
    if (error.message === 'unauthorized') {
      void reconnectWithFreshToken();
    }
  });

  socket.io.on('reconnect_attempt', () => setState('connecting'));

  socket.on('project:changed', (event: ProjectChangedEvent) => {
    changeListeners.forEach((listener) => listener(event));
  });
  socket.on('notification:created', (notification: AppNotification) => {
    notificationListeners.forEach((listener) => listener(notification));
  });

  setState('connecting');
  socket.connect();
}

/** Closes the connection and forgets every room (used on logout). */
export function disconnectRealtime(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  rooms.clear();
  authRetries = 0;
  reconnecting = false;
  setState('disconnected');
}

/**
 * Start watching a project. Returns a function that stops watching.
 *
 * Reference-counted: if the board page and the project page both watch the
 * same project, the server is asked to join once, and asked to leave only
 * when the LAST one stops. The server decides whether to admit us - if the
 * project is not visible to this user it simply never sends anything.
 */
export function joinProject(projectId: string): () => void {
  const count = rooms.get(projectId) ?? 0;
  rooms.set(projectId, count + 1);
  if (count === 0 && socket?.connected) {
    socket.emit('project:join', { projectId });
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (rooms.get(projectId) ?? 1) - 1;
    if (remaining <= 0) {
      rooms.delete(projectId);
      if (socket?.connected) {
        socket.emit('project:leave', { projectId });
      }
    } else {
      rooms.set(projectId, remaining);
    }
  };
}

export function onProjectChanged(
  listener: (event: ProjectChangedEvent) => void,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function onNotification(
  listener: (notification: AppNotification) => void,
): () => void {
  notificationListeners.add(listener);
  return () => notificationListeners.delete(listener);
}

/** `subscribe` / `getSnapshot` pair for React's `useSyncExternalStore`. */
export function onConnectionState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getConnectionState(): ConnectionState {
  return state;
}
