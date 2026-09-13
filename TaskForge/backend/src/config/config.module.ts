import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { validateEnv } from './env.validation';

/**
 * WHAT: TaskForge's configuration module, wrapping `@nestjs/config`.
 *
 * WHY: `isGlobal: true` means every other module can inject `ConfigService`
 * without re-importing this module. `load: [configuration]` gives us the
 * namespaced `app.*` / `cors.*` shape. `validate` fails startup immediately
 * if the environment is misconfigured, per env.validation.ts.
 *
 * WHERE: Imported once, in `app.module.ts`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
