import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../database/prisma.service';

/**
 * WHAT: A health-check endpoint reporting whether the service and its
 * dependencies are usable.
 *
 * WHY it now checks the database: in Phase 01 this endpoint only proved the
 * Node process was running. That is a weak signal - the process can be alive
 * while the database is unreachable, in which case every real request would
 * fail. A health check should reflect whether the service can actually do
 * its job.
 *
 * WHY the status code changes: monitoring tools and container orchestrators
 * decide "healthy vs unhealthy" from the HTTP status code, not the response
 * body. Returning 503 Service Unavailable when the database is down is what
 * makes this endpoint useful to Docker (Phase 18) and CI (Phase 19).
 *
 * WHERE: `GET /health`.
 *
 * HOW: `SELECT 1` is the cheapest possible query that proves a working
 * round-trip to PostgreSQL. It touches no tables and returns immediately.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const databaseStatus = await this.checkDatabase();
    const isHealthy = databaseStatus === 'up';

    res.status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: isHealthy ? 'ok' : 'error',
      environment: this.configService.get<string>('app.nodeEnv'),
      dependencies: {
        database: databaseStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
