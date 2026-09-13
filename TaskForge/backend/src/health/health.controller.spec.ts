import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: () => 'test' },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns a status of ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.environment).toBe('test');
    expect(typeof result.timestamp).toBe('string');
  });
});
