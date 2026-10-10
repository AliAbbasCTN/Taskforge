/**
 * WHAT: Room names.
 *
 * A ROOM is a named group of sockets on the server. "Send this to everyone in
 * room X" is a single call, and a socket can be in many rooms. TaskForge uses
 * two kinds:
 *
 *   `user:<id>`     - every socket (tab, device) belonging to one user. Used
 *                     for things meant for ONE person, like notifications.
 *   `project:<id>`  - every socket currently watching one project. Used for
 *                     live board updates.
 *
 * Rooms are server-side only: a client never names a room directly, it asks
 * to JOIN a project and the server decides whether to allow it.
 */
export const userRoom = (userId: string): string => `user:${userId}`;
export const projectRoom = (projectId: string): string =>
  `project:${projectId}`;

const PROJECT_PREFIX = 'project:';

/** The project id inside a room name, or null if it isn't a project room. */
export function projectIdFromRoom(room: string): string | null {
  return room.startsWith(PROJECT_PREFIX)
    ? room.slice(PROJECT_PREFIX.length)
    : null;
}
