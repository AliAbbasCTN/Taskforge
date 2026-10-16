import { UnrecoverableError, type Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { MaintenanceProcessor } from './maintenance.processor';

describe('MaintenanceProcessor', () => {
  let processor: MaintenanceProcessor;
  let prisma: { notification: { deleteMany: jest.Mock } };

  beforeEach(() => {
    prisma = {
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 7 }) },
    };
    processor = new MaintenanceProcessor(prisma as unknown as PrismaService);
  });

  it('deletes only notifications READ before the 90-day cutoff', async () => {
    const now = new Date('2026-06-15T12:00:00.000Z');

    const result = await processor.purgeOldNotifications(now);

    expect(result).toEqual({ deleted: 7 });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      // 90 days before 2026-06-15 is 2026-03-17. `readAt < cutoff` can never
      // match an unread (NULL) notification.
      where: { readAt: { lt: new Date('2026-03-17T12:00:00.000Z') } },
    });
  });

  it('runs the purge for the purge job', async () => {
    const result = await processor.process({
      name: 'purge-old-notifications',
    } as Job);

    expect(result).toEqual({ deleted: 7 });
  });

  it('refuses an unknown job without retrying it', async () => {
    await expect(
      processor.process({ name: 'mystery' } as Job),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });
});
