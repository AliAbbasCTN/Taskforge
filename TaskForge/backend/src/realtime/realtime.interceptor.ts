import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, map, mergeMap, tap } from 'rxjs';
import {
  DISCONNECTS_USER_KEY,
  PUBLISHES_CHANGES_KEY,
  REVALIDATES_USER_KEY,
} from './realtime.decorators';
import {
  ChangeResource,
  PROJECT_CHANGED,
  ProjectChangedEvent,
} from './realtime.events';
import { RealtimeService } from './realtime.service';

/**
 * WHAT: The single place that turns "a request succeeded" into "tell the
 * connected clients". Registered globally (see `RealtimeModule`), it does
 * nothing unless a route carries one of the decorators in
 * `realtime.decorators.ts`.
 *
 * INTERCEPTORS wrap a route handler: code before `next.handle()` runs before
 * the handler, and operators on the returned stream (`tap`, `mergeMap`) run
 * with its result. Because they only see successful results, nothing is
 * announced when the handler throws - a rejected, invalid or forbidden write
 * changes nothing and so tells no one anything.
 *
 * Two behaviours, deliberately different - and deliberately in this ORDER:
 *  - REVOKING access is awaited (`mergeMap`): the response is held until the
 *    user's sockets have been cleaned up, because "removed" must mean removed
 *    by the time the caller hears it.
 *  - PUBLISHING comes after, and is fire-and-forget (`tap`): a failure to
 *    notify must never fail a write that already succeeded.
 */
@Injectable()
export class RealtimeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RealtimeInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly realtime: RealtimeService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const targets = [context.getHandler(), context.getClass()];
    const resource = this.reflector.getAllAndOverride<ChangeResource>(
      PUBLISHES_CHANGES_KEY,
      targets,
    );
    const revalidates = this.reflector.get<boolean>(
      REVALIDATES_USER_KEY,
      context.getHandler(),
    );
    const disconnects = this.reflector.get<boolean>(
      DISCONNECTS_USER_KEY,
      context.getHandler(),
    );

    if (!resource && !revalidates && !disconnects) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      // 1. REVOKE first (and wait for it)...
      mergeMap((result) =>
        from(this.revokeAccess(request, !!revalidates, !!disconnects)).pipe(
          map(() => result),
        ),
      ),
      // 2. ...then ANNOUNCE. In this order, someone who has just lost access
      //    is already out of the room and never hears about their own removal.
      tap(() => {
        if (resource && request.method !== 'GET') {
          this.publish(resource, request);
        }
      }),
    );
  }

  private publish(resource: ChangeResource, request: any): void {
    const projectId: unknown = request.params?.projectId;
    if (typeof projectId !== 'string') {
      return; // e.g. POST /projects: nothing is watching a project that doesn't exist yet
    }
    try {
      const event: ProjectChangedEvent = {
        resource,
        projectId,
        boardId: request.params?.boardId,
        taskId: request.params?.taskId,
        actorId: request.user?.id,
        at: new Date().toISOString(),
      };
      this.realtime.emitToProject(projectId, PROJECT_CHANGED, event);
    } catch (error) {
      this.logger.warn(`Could not publish change: ${String(error)}`);
    }
  }

  private async revokeAccess(
    request: any,
    revalidates: boolean,
    disconnects: boolean,
  ): Promise<void> {
    try {
      if (revalidates && typeof request.params?.userId === 'string') {
        await this.realtime.revalidateUser(request.params.userId);
      }
      if (disconnects && request.user?.id) {
        await this.realtime.disconnectUser(request.user.id);
      }
    } catch (error) {
      this.logger.warn(`Could not update sockets: ${String(error)}`);
    }
  }
}
