import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * WHAT: A minimal health-check endpoint.
 *
 * WHY: Load balancers, container orchestrators (e.g. Docker, Kubernetes),
 * and uptime monitors all need a cheap, dependency-free endpoint to poll to
 * know "is this instance alive and accepting requests?". It's also the
 * simplest possible way to verify the backend is wired together correctly.
 *
 * WHERE: `GET /health`.
 *
 * HOW: For now this only confirms the process is up and can read config -
 * it does not check the database or Redis, because those don't exist yet.
 * Once Phase 02 (database) and Phase 12 (Redis) land, this will be upgraded
 * to a real dependency health check (likely using `@nestjs/terminus`) that
 * verifies the database connection and Redis connection are healthy too.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      environment: this.configService.get<string>('app.nodeEnv'),
      timestamp: new Date().toISOString(),
    };
  }
}
