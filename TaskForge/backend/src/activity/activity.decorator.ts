import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
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
 *
 * PHASE 16: also published as an `x-activity-action` extension, so the API
 * reference tells a reader which audit-trail entry a route produces.
 */
export const LogsActivity = (action: LoggedActivityAction) =>
  applyDecorators(
    SetMetadata(LOGS_ACTIVITY_KEY, action),
    ApiExtension('x-activity-action', action),
  );
