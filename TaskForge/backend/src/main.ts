import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createAppValidationPipe } from './common/pipes/app-validation.pipe';
import { SocketIoAdapter } from './realtime/socket-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Global validation: every incoming request body/query is validated against
  // its DTO. `whitelist` strips unknown properties, `forbidNonWhitelisted`
  // rejects requests that contain properties the DTO doesn't declare, and
  // `transform` auto-converts payloads into typed DTO instances.
  app.useGlobalPipes(createAppValidationPipe());

  // Global exception filter: guarantees every error response (expected or
  // unexpected) follows the same consistent JSON shape, and never leaks
  // internal details such as stack traces in production.
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS is enabled now so the future React frontend (Phase 09) can call
  // this API during local development without extra rework later.
  app.enableCors({
    origin: configService.get<string>('cors.origin'),
    credentials: true,
  });

  // The WebSocket server needs its own CORS setting (see SocketIoAdapter).
  app.useWebSocketAdapter(
    new SocketIoAdapter(app, configService.get<string>('cors.origin') ?? ''),
  );

  // Lets NestJS run module shutdown hooks (including closing the Prisma
  // connection pool) when the process receives SIGTERM/SIGINT, instead of
  // dropping in-flight work. This matters once we run in containers.
  app.enableShutdownHooks();

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
  logger.log(`TaskForge backend listening on http://localhost:${port}`);
}

bootstrap();
