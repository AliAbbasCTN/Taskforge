import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * WHAT: A thin NestJS-managed wrapper around Prisma's generated
 * `PrismaClient`.
 *
 * WHY: `PrismaClient` opens a connection pool to PostgreSQL. We want exactly
 * ONE instance shared across the whole application - creating a new client
 * per request would exhaust the database's connection limit very quickly.
 * Wrapping it in an `@Injectable()` service lets NestJS's dependency
 * injection container own that single instance and hand it to any service
 * that asks for it.
 *
 * It also lets us hook into Nest's lifecycle: connect when the app starts,
 * disconnect cleanly when it shuts down.
 *
 * WHERE: Provided by `DatabaseModule` (which is global), injected into any
 * service that needs database access - currently `UsersService`.
 *
 * HOW: By extending `PrismaClient`, this class inherits every generated
 * query method (`this.user.findMany()`, `this.user.create()`, and later
 * `this.project`, `this.task`, etc.) while adding Nest lifecycle behaviour
 * on top.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      // Prisma can emit query/error events. We log errors and warnings so
      // database problems surface in the application logs rather than
      // silently disappearing.
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  /**
   * Called by NestJS during shutdown (enabled via `app.enableShutdownHooks()`
   * in main.ts). Releases the connection pool cleanly instead of letting it
   * be dropped abruptly - important in containerised environments where the
   * orchestrator sends SIGTERM before stopping a container.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from the database');
  }
}
