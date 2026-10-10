/**
 * WHAT: The names and shapes of everything that travels over the socket.
 *
 * A "contract" file: the server emits these, the frontend listens for them
 * (`frontend/src/services/realtime.ts` repeats the names). Keeping the names
 * in one place on each side - and as constants rather than loose strings -
 * means a typo is a compile error instead of a silent "nothing happens".
 */

/** Server -> client: something changed in a project you are watching. */
export const PROJECT_CHANGED = 'project:changed';

/** Server -> one user: a new notification was created for you. */
export const NOTIFICATION_CREATED = 'notification:created';

/** Client -> server: start/stop receiving a project's changes. */
export const PROJECT_JOIN = 'project:join';
export const PROJECT_LEAVE = 'project:leave';

/** What kind of thing changed. Clients use it to decide what to refetch. */
export type ChangeResource =
  'project' | 'boards' | 'columns' | 'tasks' | 'labels' | 'comments';

/**
 * WHAT: The payload of `project:changed`.
 *
 * It contains IDS ONLY - never titles, descriptions or comment text. The
 * event means "this changed; go and look", and the client then re-reads the
 * data through the normal authenticated HTTP API. That has three benefits:
 *   1. Authorization lives in ONE place. The socket never has to re-implement
 *      "who may see this task?" - it can't leak what it never carries.
 *   2. No second serializer to keep in sync with the HTTP responses.
 *   3. Events are tiny, and a missed one just means the next refetch catches up.
 */
export interface ProjectChangedEvent {
  resource: ChangeResource;
  projectId: string;
  boardId?: string;
  taskId?: string;
  /** Who made the change, so their own client can ignore the echo. */
  actorId?: string;
  /** ISO timestamp. */
  at: string;
}

/** The acknowledgement a client gets back from `project:join`. */
export type JoinAck = { ok: true } | { ok: false; error: string };

/** The most project rooms one socket may be in - a guard against a client
 * (or a bug) joining thousands of rooms and exhausting server memory. */
export const MAX_PROJECT_ROOMS_PER_SOCKET = 25;
