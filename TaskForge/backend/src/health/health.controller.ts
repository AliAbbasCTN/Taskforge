import { ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { ApiEndpoint } from '../common/swagger';
import {
  HealthResponse,
} from '../docs/models';
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../database/prisma.service';
import { QueueMonitorService } from '../queues/queue-monitor.service';

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
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queueMonitor: QueueMonitorService,
  ) {}

  @Get()
  @ApiEndpoint({
    summary: 'Check service health',
    description: 'Reports whether the API and its dependencies work. Public: no token needed, so load balancers and container orchestrators can poll it. Returns **503** when the database is down; **200** with status `degraded` when only Redis is down.',
    ok: HealthResponse,
  })
  @ApiServiceUnavailableResponse({
    description: 'The database is unreachable (`status` is `error`).',
    type: HealthResponse,
  })
  async check(@Res({ passthrough: true }) res: Response) {
    const [databaseStatus, queues] = await Promise.all([
      this.checkDatabase(),
      this.queueMonitor.snapshot(),
    ]);

    // Three levels, because dependencies are not equally essential:
    //   error    - the database is down: nothing works, report 503 so a load
    //              balancer stops sending traffic here.
    //   degraded - Redis is down: the app still serves requests (notifications
    //              fall back to inline delivery, live updates stop reaching
    //              other server instances), so stay 200 but SAY something is
    //              wrong for whoever is watching.
    //   ok       - everything is reachable.
    const status =
      databaseStatus === 'down'
        ? 'error'
        : queues.redis === 'down'
          ? 'degraded'
          : 'ok';

    res.status(
      status === 'error' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK,
    );

    return {
      status,
      environment: this.configService.get<string>('app.nodeEnv'),
      dependencies: {
        database: databaseStatus,
        redis: queues.redis,
      },
      // Job counts per queue (null when Redis can't be reached). `failed`
      // should normally be 0 - a rising number means background work is
      // failing. See docs/phase-12-concepts.md for the monitoring strategy.
      queues: queues.queues,
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
