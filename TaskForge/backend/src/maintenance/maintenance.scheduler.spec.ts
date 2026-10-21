import type { Queue } from 'bullmq';
import { MaintenanceScheduler } from './maintenance.scheduler';

describe('MaintenanceScheduler', () => {
  it('upserts each schedule with a fixed id, so restarts never duplicate them', async () => {
    const upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const scheduler = new MaintenanceScheduler({
      upsertJobScheduler,
    } as unknown as Queue);

    await scheduler.onApplicationBootstrap();
    await scheduler.onApplicationBootstrap(); // "a second server instance starting"

    // Two schedules per start; same ids both times, so Redis ends up with two.
    expect(upsertJobScheduler).toHaveBeenCalledTimes(4);
    const ids = upsertJobScheduler.mock.calls.map((call) => call[0]);
    expect(ids).toEqual([
      'purge-old-notifications',
      'sweep-orphaned-files',
      'purge-old-notifications',
      'sweep-orphaned-files',
    ]);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'purge-old-notifications',
      { pattern: '0 3 * * *' },
      { name: 'purge-old-notifications' },
    );
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'sweep-orphaned-files',
      { pattern: '30 3 * * *' },
      { name: 'sweep-orphaned-files' },
    );
  });

  it('does not crash the application if Redis is unavailable at startup', async () => {
    const scheduler = new MaintenanceScheduler({
      upsertJobScheduler: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Queue);

    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('keeps retrying in the background and registers once Redis comes back', async () => {
    const upsertJobScheduler = jest
      .fn()
      // Both schedules fail on the first attempt, then everything succeeds.
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(undefined);
    const scheduler = new MaintenanceScheduler({
      upsertJobScheduler,
    } as unknown as Queue);
    scheduler.retryDelayMs = 10;

    await scheduler.onApplicationBootstrap();
    expect(upsertJobScheduler).toHaveBeenCalledTimes(2); // the failed attempt

    await new Promise((resolve) => setTimeout(resolve, 200));
    scheduler.onModuleDestroy();

    expect(upsertJobScheduler).toHaveBeenCalledTimes(4); // retried exactly once, then stopped
  });

  it('stops retrying when the application shuts down', async () => {
    const upsertJobScheduler = jest.fn().mockRejectedValue(new Error('down'));
    const scheduler = new MaintenanceScheduler({
      upsertJobScheduler,
    } as unknown as Queue);
    scheduler.retryDelayMs = 10;

    await scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();
    const callsAtShutdown = upsertJobScheduler.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(upsertJobScheduler).toHaveBeenCalledTimes(callsAtShutdown);
  });
});
