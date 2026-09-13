import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Global validation: every incoming request body/query is validated against
  // its DTO. `whitelist` strips unknown properties, `forbidNonWhitelisted`
  // rejects requests that contain properties the DTO doesn't declare, and
  // `transform` auto-converts payloads into typed DTO instances.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

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

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
  logger.log(`TaskForge backend listening on http://localhost:${port}`);
}

bootstrap();
