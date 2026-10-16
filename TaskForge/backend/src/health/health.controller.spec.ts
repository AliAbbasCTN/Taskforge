import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import {
  QueueMonitorService,
  QueueSnapshot,
} from '../queues/queue-monitor.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let queueMonitor: { snapshot: jest.Mock };

  const redisUp: QueueSnapshot = {
    redis: 'up',
    queues: {
      notifications: { waiting: 0, active: 0, delayed: 0, failed: 2 },
      maintenance: { waiting: 0, active: 0, delayed: 1, failed: 0 },
    },
  };
  const redisDown: QueueSnapshot = { redis: 'down', queues: null };

  /**
   * Minimal stand-in for the Express Response object. The controller only
   * ever calls `res.status(...)`, so that is all the mock needs to provide.
   */
  const mockResponse = () =>
    ({ status: jest.fn() }) as unknown as Parameters<
      HealthController['check']
    >[0];

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    queueMonitor = { snapshot: jest.fn().mockResolvedValue(redisUp) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ConfigService, useValue: { get: () => 'test' } },
        { provide: PrismaService, useValue: prisma },
        { provide: QueueMonitorService, useValue: queueMonitor },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok with a 200 when the database and Redis are reachable, including queue counts', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = mockResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('ok');
    expect(result.dependencies).toEqual({ database: 'up', redis: 'up' });
    expect(result.queues).toEqual(redisUp.queues);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('reports DEGRADED (still 200) when only Redis is down - the app keeps serving requests', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    queueMonitor.snapshot.mockResolvedValue(redisDown);
    const res = mockResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('degraded');
    expect(result.dependencies).toEqual({ database: 'up', redis: 'down' });
    expect(result.queues).toBeNull();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('reports error with a 503 when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = mockResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('error');
    expect(result.dependencies.database).toBe('down');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('a database outage is an error even if Redis is also down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    queueMonitor.snapshot.mockResolvedValue(redisDown);
    const res = mockResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('error');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
