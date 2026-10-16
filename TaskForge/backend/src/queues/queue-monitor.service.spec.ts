import type { Queue } from 'bullmq';
import { QueueMonitorService } from './queue-monitor.service';

describe('QueueMonitorService', () => {
  const queueReturning = (counts: Record<string, number>) =>
    ({ getJobCounts: jest.fn().mockResolvedValue(counts) }) as unknown as Queue;

  it("reports Redis up with each queue's counts", async () => {
    const service = new QueueMonitorService(
      queueReturning({ waiting: 2, active: 1, delayed: 3, failed: 4 }),
      queueReturning({ delayed: 1 }),
    );

    await expect(service.snapshot()).resolves.toEqual({
      redis: 'up',
      queues: {
        notifications: { waiting: 2, active: 1, delayed: 3, failed: 4 },
        // Counts Redis doesn't report default to 0.
        maintenance: { waiting: 0, active: 0, delayed: 1, failed: 0 },
      },
    });
  });

  it('reports Redis down (instead of throwing) when a queue cannot be read', async () => {
    const broken = {
      getJobCounts: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Queue;
    const service = new QueueMonitorService(broken, queueReturning({}));

    await expect(service.snapshot()).resolves.toEqual({
      redis: 'down',
      queues: null,
    });
  });
});
