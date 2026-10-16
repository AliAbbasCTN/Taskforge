import type { Queue } from 'bullmq';
import { MaintenanceScheduler } from './maintenance.scheduler';

describe('MaintenanceScheduler', () => {
  it('upserts ONE schedule with a fixed id, so restarts never duplicate it', async () => {
    const upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const scheduler = new MaintenanceScheduler({
      upsertJobScheduler,
    } as unknown as Queue);

    await scheduler.onApplicationBootstrap();
    await scheduler.onApplicationBootstrap(); // "a second server instance starting"

    expect(upsertJobScheduler).toHaveBeenCalledTimes(2);
    for (const call of upsertJobScheduler.mock.calls) {
      expect(call).toEqual([
        'purge-old-notifications',
        { pattern: '0 3 * * *' },
        { name: 'purge-old-notifications' },
      ]);
    }
  });

  it('does not crash the application if Redis is unavailable at startup', async () => {
    const scheduler = new MaintenanceScheduler({
      upsertJobScheduler: jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Queue);

    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
