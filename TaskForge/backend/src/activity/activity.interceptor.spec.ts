import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityService } from './activity.service';
import { ActivitySnapshotService } from './activity-snapshot.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const TASK = '44444444-4444-4444-8444-444444444444';

function build(
  options: { action?: string; user?: unknown; type?: string } = {},
) {
  const calls: string[] = [];
  const activity = {
    record: jest.fn().mockImplementation(async () => {
      calls.push('record');
    }),
  };
  const snapshots = {
    load: jest.fn().mockImplementation(async () => {
      calls.push('snapshot');
      return { title: 'Fix login' };
    }),
  };
  const reflector = { get: jest.fn().mockReturnValue(options.action) };
  const interceptor = new ActivityInterceptor(
    reflector as unknown as Reflector,
    activity as unknown as ActivityService,
    snapshots as unknown as ActivitySnapshotService,
  );
  const request = {
    user: 'user' in options ? options.user : { id: 'actor-1' },
    params: { id: ORG, projectId: PROJECT, boardId: 'b1', taskId: TASK },
    body: {},
  };
  const context = {
    getType: () => options.type ?? 'http',
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const handle = (result: unknown) => ({
    handle: () => {
      calls.push('handler');
      return of(result);
    },
  });
  return { interceptor, context, activity, snapshots, calls, handle };
}

describe('ActivityInterceptor', () => {
  it('takes the snapshot BEFORE the handler runs and records AFTER it succeeds', async () => {
    const { interceptor, context, activity, snapshots, calls, handle } = build({
      action: 'task.deleted',
    });

    const result = await lastValueFrom(
      interceptor.intercept(context, handle(undefined)),
    );

    expect(result).toBeUndefined();
    expect(calls).toEqual(['snapshot', 'handler', 'record']);
    expect(snapshots.load).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({ taskId: TASK }),
      {},
    );
    const [actorId, drafts] = activity.record.mock.calls[0];
    expect(actorId).toBe('actor-1');
    expect(drafts[0]).toMatchObject({
      action: 'task.deleted',
      targetName: 'Fix login', // from the snapshot: the task no longer exists
      organizationId: ORG,
      projectId: PROJECT,
    });
  });

  it("passes the handler's response through unchanged", async () => {
    const { interceptor, context, handle } = build({ action: 'task.created' });
    const response = { id: TASK, title: 'New' };

    expect(
      await lastValueFrom(interceptor.intercept(context, handle(response))),
    ).toBe(response);
  });

  it('records NOTHING when the handler fails', async () => {
    const { interceptor, context, activity } = build({
      action: 'task.deleted',
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => new Error('404')),
        }),
      ),
    ).rejects.toThrow('404');

    expect(activity.record).not.toHaveBeenCalled();
  });

  it('a failure while recording never fails the request', async () => {
    const { interceptor, context, activity, handle } = build({
      action: 'task.created',
    });
    activity.record.mockRejectedValue(new Error('db down'));

    const response = { id: TASK, title: 'New' };
    expect(
      await lastValueFrom(interceptor.intercept(context, handle(response))),
    ).toBe(response);
  });

  it('a failing snapshot still lets the request through and the entry be recorded', async () => {
    const { interceptor, context, activity, snapshots, handle } = build({
      action: 'task.deleted',
    });
    snapshots.load.mockRejectedValue(new Error('db down'));

    await lastValueFrom(interceptor.intercept(context, handle(undefined)));

    expect(activity.record).toHaveBeenCalledTimes(1);
    expect(activity.record.mock.calls[0][1][0].targetName).toBeUndefined();
  });

  it('does not touch routes without @LogsActivity', async () => {
    const { interceptor, context, activity, snapshots, calls, handle } = build({
      action: undefined,
    });

    await lastValueFrom(interceptor.intercept(context, handle('x')));

    expect(calls).toEqual(['handler']);
    expect(snapshots.load).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('skips non-HTTP contexts and requests with no authenticated user', async () => {
    const ws = build({ action: 'task.created', type: 'ws' });
    await lastValueFrom(ws.interceptor.intercept(ws.context, ws.handle('x')));
    expect(ws.activity.record).not.toHaveBeenCalled();

    const anonymous = build({ action: 'task.created', user: undefined });
    await lastValueFrom(
      anonymous.interceptor.intercept(anonymous.context, anonymous.handle('x')),
    );
    expect(anonymous.activity.record).not.toHaveBeenCalled();
  });
});
