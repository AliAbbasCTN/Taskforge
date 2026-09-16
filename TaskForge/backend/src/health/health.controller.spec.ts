import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ConfigService, useValue: { get: () => 'test' } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok with a 200 when the database is reachable', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = mockResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('ok');
    expect(result.dependencies.database).toBe('up');
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
});
