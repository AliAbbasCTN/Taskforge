import { SetMetadata } from '@nestjs/common';
import { LoggedActivityAction } from './activity.types';

export const LOGS_ACTIVITY_KEY = 'activity:logs';

/**
 * WHAT: Marks a controller method as "record this action in the activity log
 * once it succeeds":
 *
 *   @Patch(':taskId')
 *   @LogsActivity('task.updated')
 *   update(...) { ... }
 *
 * The matching `ActivityInterceptor` does the work; what is recorded for each
 * action is defined in `ACTIVITY_SPECS`. Same pattern as Phase 11's
 * `@PublishesChanges`: declare WHAT in the controller, keep HOW out of it.
 */
export const LogsActivity = (action: LoggedActivityAction) =>
  SetMetadata(LOGS_ACTIVITY_KEY, action);
