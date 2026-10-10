import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  DisconnectsUserSockets,
  PublishesChanges,
  RevalidatesUserRooms,
} from './realtime.decorators';
import { RealtimeInterceptor } from './realtime.interceptor';
import { RealtimeService } from './realtime.service';

// A stand-in controller using the REAL decorators, so the test exercises the
// same metadata the real controllers set.
@PublishesChanges('tasks')
class SampleController {
  write() {
    return undefined;
  }

  @RevalidatesUserRooms()
  removeMember() {
    return undefined;
  }

  @DisconnectsUserSockets()
  logout() {
    return undefined;
  }
}

class UndecoratedController {
  write() {
    return undefined;
  }
}

describe('RealtimeInterceptor', () => {
  let realtime: {
    emitToProject: jest.Mock;
    revalidateUser: jest.Mock;
    disconnectUser: jest.Mock;
  };
  let interceptor: RealtimeInterceptor;

  const contextFor = (
    controller: { prototype: object },
    method: string,
    request: object,
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      getClass: () => controller,
      getHandler: () =>
        (controller.prototype as Record<string, () => void>)[method],
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  const writeRequest = (overrides: Record<string, unknown> = {}) => ({
    method: 'POST',
    user: { id: 'actor-1' },
    params: { projectId: 'p1', boardId: 'b1', taskId: 't1' },
    ...overrides,
  });

  beforeEach(() => {
    realtime = {
      emitToProject: jest.fn(),
      revalidateUser: jest.fn().mockResolvedValue(undefined),
      disconnectUser: jest.fn().mockResolvedValue(undefined),
    };
    interceptor = new RealtimeInterceptor(
      new Reflector(),
      realtime as unknown as RealtimeService,
    );
  });

  const run = (context: ExecutionContext, handler: CallHandler) =>
    lastValueFrom(interceptor.intercept(context, handler));

  describe('publishing changes', () => {
    it('announces a successful write with IDS ONLY and returns the response unchanged', async () => {
      const result = await run(
        contextFor(SampleController, 'write', writeRequest()),
        handlerReturning({ secretTitle: 'Hidden' }),
      );

      expect(result).toEqual({ secretTitle: 'Hidden' });
      expect(realtime.emitToProject).toHaveBeenCalledTimes(1);
      const [projectId, event, payload] = realtime.emitToProject.mock.calls[0];
      expect(projectId).toBe('p1');
      expect(event).toBe('project:changed');
      expect(payload).toEqual({
        resource: 'tasks',
        projectId: 'p1',
        boardId: 'b1',
        taskId: 't1',
        actorId: 'actor-1',
        at: expect.any(String),
      });
      // Nothing from the response body leaks into the event.
      expect(JSON.stringify(payload)).not.toContain('Hidden');
    });

    it.each(['PATCH', 'PUT', 'DELETE'])('announces %s too', async (method) => {
      await run(
        contextFor(SampleController, 'write', writeRequest({ method })),
        handlerReturning(null),
      );

      expect(realtime.emitToProject).toHaveBeenCalledTimes(1);
    });

    it('never announces a read', async () => {
      await run(
        contextFor(SampleController, 'write', writeRequest({ method: 'GET' })),
        handlerReturning([]),
      );

      expect(realtime.emitToProject).not.toHaveBeenCalled();
    });

    it('announces nothing when the handler fails (a rejected write changes nothing)', async () => {
      await expect(
        run(contextFor(SampleController, 'write', writeRequest()), {
          handle: () => throwError(() => new Error('403')),
        }),
      ).rejects.toThrow('403');

      expect(realtime.emitToProject).not.toHaveBeenCalled();
    });

    it('announces nothing for a route with no project in its URL (POST /projects)', async () => {
      await run(
        contextFor(SampleController, 'write', writeRequest({ params: {} })),
        handlerReturning({}),
      );

      expect(realtime.emitToProject).not.toHaveBeenCalled();
    });

    it('ignores routes that did not opt in', async () => {
      await run(
        contextFor(UndecoratedController, 'write', writeRequest()),
        handlerReturning({}),
      );

      expect(realtime.emitToProject).not.toHaveBeenCalled();
    });

    it('never lets a publishing failure fail the request that already succeeded', async () => {
      realtime.emitToProject.mockImplementation(() => {
        throw new Error('socket exploded');
      });

      await expect(
        run(
          contextFor(SampleController, 'write', writeRequest()),
          handlerReturning('ok'),
        ),
      ).resolves.toBe('ok');
    });
  });

  describe('revoking access', () => {
    it("re-checks the TARGET user's sockets, and finishes BEFORE the response is delivered", async () => {
      let finished = false;
      realtime.revalidateUser.mockImplementation(async () => {
        await Promise.resolve();
        finished = true;
      });

      await run(
        contextFor(
          SampleController,
          'removeMember',
          writeRequest({
            method: 'DELETE',
            params: { projectId: 'p1', userId: 'target-9' },
          }),
        ),
        handlerReturning('done'),
      );

      expect(realtime.revalidateUser).toHaveBeenCalledWith('target-9');
      expect(finished).toBe(true);
    });

    it('revokes BEFORE it announces, so a removed user never hears about their own removal', async () => {
      const order: string[] = [];
      realtime.revalidateUser.mockImplementation(async () => {
        order.push('revalidate');
      });
      realtime.emitToProject.mockImplementation(() => {
        order.push('publish');
      });

      await run(
        contextFor(
          SampleController,
          'removeMember',
          writeRequest({
            method: 'DELETE',
            params: { projectId: 'p1', userId: 'target-9' },
          }),
        ),
        handlerReturning('done'),
      );

      expect(order).toEqual(['revalidate', 'publish']);
    });

    it('does not fail the request if revalidation errors', async () => {
      realtime.revalidateUser.mockRejectedValue(new Error('boom'));

      await expect(
        run(
          contextFor(
            SampleController,
            'removeMember',
            writeRequest({ params: { projectId: 'p1', userId: 'target-9' } }),
          ),
          handlerReturning('done'),
        ),
      ).resolves.toBe('done');
    });

    it("closes the CALLER's sockets on logout", async () => {
      await run(
        contextFor(SampleController, 'logout', writeRequest({ params: {} })),
        handlerReturning(undefined),
      );

      expect(realtime.disconnectUser).toHaveBeenCalledWith('actor-1');
    });
  });
});
