import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * WHAT: A class describing every environment variable TaskForge expects,
 * with validation rules attached.
 *
 * WHY: If a required environment variable is missing or malformed (e.g.
 * DATABASE_URL is absent), we want the application to fail fast at startup
 * with a clear error - not fail confusingly later at runtime when the first
 * database query is attempted.
 *
 * WHERE: Used by `ConfigModule.forRoot({ validate })` in `config.module.ts`.
 */
enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

class EnvironmentVariables {
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV?: NodeEnv;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  /**
   * Required. Without a database connection string the application cannot
   * function at all, so this is the one variable that has no default and
   * must be supplied.
   *
   * `protocols: ['postgresql', 'postgres']` catches the common mistake of
   * pasting a connection string for the wrong database engine.
   */
  @IsNotEmpty({ message: 'DATABASE_URL is required' })
  @IsUrl(
    { protocols: ['postgresql', 'postgres'], require_tld: false },
    { message: 'DATABASE_URL must be a valid PostgreSQL connection string' },
  )
  DATABASE_URL!: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment variables:\n${errors
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validatedConfig;
}
