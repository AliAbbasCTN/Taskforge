import { SetMetadata } from '@nestjs/common';
import { ChangeResource } from './realtime.events';

export const PUBLISHES_CHANGES_KEY = 'realtime:publishes-changes';
export const REVALIDATES_USER_KEY = 'realtime:revalidates-user';
export const DISCONNECTS_USER_KEY = 'realtime:disconnects-user';

/**
 * WHAT: Marks a controller (or one route) as one whose successful WRITES
 * should be announced to everyone watching the project.
 *
 *   @PublishesChanges('tasks')
 *   @Controller('organizations/:id/projects/:projectId/boards/:boardId/tasks')
 *   export class TasksController { ... }
 *
 * `RealtimeInterceptor` does the announcing; this only says what KIND of
 * thing the controller manages. Reads (GET) are never announced.
 *
 * WHY a decorator + interceptor and not a call inside every service method:
 * with fifteen-odd write routes, "remember to publish an event" would be
 * forgotten the first time someone adds a route. Declaring it on the
 * controller makes it the default for every write, and keeps services free of
 * any knowledge that sockets exist.
 */
export const PublishesChanges = (resource: ChangeResource) =>
  SetMetadata(PUBLISHES_CHANGES_KEY, resource);

/**
 * WHAT: On a route that can TAKE ACCESS AWAY from the user named in the `:userId`
 * URL parameter (removing a member, changing a role): after it succeeds, check
 * that user's open sockets again and remove them from rooms they no longer
 * qualify for. The response is held until this finishes, so by the time the
 * caller sees "204 removed", the removed person's live connection is already
 * cut off.
 */
export const RevalidatesUserRooms = () =>
  SetMetadata(REVALIDATES_USER_KEY, true);

/** WHAT: After this route succeeds (logout), close the CALLER's sockets. */
export const DisconnectsUserSockets = () =>
  SetMetadata(DISCONNECTS_USER_KEY, true);
