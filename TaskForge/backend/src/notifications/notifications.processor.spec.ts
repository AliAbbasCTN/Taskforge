import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnrecoverableError, type Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

describe('NotificationsProcessor', () => {
  let notifications: { deliver: jest.Mock };
  let processor: NotificationsProcessor;

  const job = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'job-1',
      data: { notificationId: 'n1' },
      attemptsMade: 1,
      opts: { attempts: 5 },
      ...overrides,
    }) as unknown as Job;

  beforeEach(() => {
    notifications = { deliver: jest.fn().mockResolvedValue(undefined) };
    processor = new NotificationsProcessor(
      notifications as unknown as NotificationsService,
    );
  });

  describe('process', () => {
    it('delivers the notification described by the job', async () => {
      await processor.process(job());

      expect(notifications.deliver).toHaveBeenCalledWith({
        notificationId: 'n1',
      });
    });

    it('lets ordinary failures through so the queue retries them', async () => {
      notifications.deliver.mockRejectedValue(new Error('db timeout'));

      await expect(processor.process(job())).rejects.toThrow('db timeout');
    });

    it('stops retrying (UnrecoverableError) when the recipient or project was deleted', async () => {
      notifications.deliver.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('FK failed', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await expect(processor.process(job())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });
  });

  describe('failure monitoring', () => {
    let warn: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('logs a WARNING for a failed attempt that will be retried', () => {
      processor.onFailed(job({ attemptsMade: 2 }), new Error('timeout'));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('will retry'));
      expect(error).not.toHaveBeenCalled();
    });

    it('logs an ERROR once retries are exhausted - the point where a person must look', () => {
      processor.onFailed(job({ attemptsMade: 5 }), new Error('timeout'));

      expect(error).toHaveBeenCalledWith(expect.stringContaining('GIVING UP'));
    });

    it('logs an ERROR immediately for an unrecoverable failure, however many attempts remain', () => {
      processor.onFailed(
        job({ attemptsMade: 1 }),
        new UnrecoverableError('recipient gone'),
      );

      expect(error).toHaveBeenCalledWith(expect.stringContaining('GIVING UP'));
    });
  });
});
