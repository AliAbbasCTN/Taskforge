import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, mergeMap } from 'rxjs';
import { ACTIVITY_SPECS } from './activity-describers';
import { ActivitySnapshotService } from './activity-snapshot.service';
import { LOGS_ACTIVITY_KEY } from './activity.decorator';
import { ActivityService } from './activity.service';
import {
  DescribeContext,
  JsonObject,
  LoggedActivityAction,
} from './activity.types';

const asObject = (value: unknown): JsonObject =>
  typeof value === 'object' && value !== null ? (value as JsonObject) : {};

/**
 * WHAT: Records an activity-log entry after a `@LogsActivity(...)` route
 * SUCCEEDS.
 *
 * HOW, step by step:
 *  1. Guards have already run (an unauthenticated or forbidden request never
 *     reaches an interceptor), so everything logged was really allowed.
 *  2. If the action needs a "before" snapshot (a delete's title, a move's old
 *     column) it is loaded now, BEFORE the handler changes anything.
 *  3. The handler runs. If it throws (validation error, 404...), nothing is
 *     logged - a failed request changed nothing.
 *  4. On success, the action's describer turns request + response + snapshot
 *     into entries, which `ActivityService` stores.
 *
 * BEST-EFFORT, by design: any failure while logging is caught and written to the
 * server log, and the user's request still succeeds. The alternative -
 * recording inside the same database transaction as the change - is stricter
 * (no change without a record) but would mean threading the actor and
 * organization through every service method; see docs/phase-15-concepts.md
 * for the trade-off. The honest consequence: if the database fails between a
 * change and its log write, the change exists without an entry.
 *
 * Registered globally (`APP_INTERCEPTOR` in `ActivityModule`); routes without
 * the decorator pass straight through at the cost of one metadata lookup.
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActivityInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly activity: ActivityService,
    private readonly snapshots: ActivitySnapshotService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const action = this.reflector.get<LoggedActivityAction | undefined>(
      LOGS_ACTIVITY_KEY,
      context.getHandler(),
    );
    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const actorId: unknown = request.user?.id;
    if (typeof actorId !== 'string') {
      return next.handle();
    }
    const params: Record<string, string | undefined> = request.params ?? {};
    const body = asObject(request.body);

    return from(this.takeSnapshot(action, params, body)).pipe(
      mergeMap((before) =>
        next.handle().pipe(
          mergeMap((result) =>
            from(
              this.record(action, actorId, {
                params,
                body,
                response: asObject(result),
                before,
              }),
            ).pipe(mergeMap(() => [result])),
          ),
        ),
      ),
    );
  }

  private async takeSnapshot(
    action: LoggedActivityAction,
    params: Record<string, string | undefined>,
    body: JsonObject,
  ): Promise<JsonObject | null> {
    const kind = ACTIVITY_SPECS[action].snapshot;
    if (!kind) {
      return null;
    }
    try {
      return await this.snapshots.load(kind, params, body);
    } catch (error) {
      this.logger.warn(
        `Could not take the "${kind}" snapshot for ${action}: ${String(error)}`,
      );
      return null;
    }
  }

  private async record(
    action: LoggedActivityAction,
    actorId: string,
    context: DescribeContext,
  ): Promise<void> {
    try {
      const drafts = ACTIVITY_SPECS[action].describe(context);
      await this.activity.record(actorId, drafts);
    } catch (error) {
      this.logger.error(
        `Could not record activity "${action}": ${String(error)}`,
      );
    }
  }
}
