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
  MinLength,
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

  /**
   * Required, and deliberately held to a minimum length. A short or
   * predictable JWT secret would let an attacker forge valid access tokens
   * for any user - this is not a hypothetical, it's one of the most common
   * real-world JWT implementation mistakes. 32 characters of randomness is a
   * reasonable floor; generate one with `openssl rand -base64 32`.
   */
  @IsNotEmpty({ message: 'JWT_ACCESS_SECRET is required' })
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  /**
   * Required, and MUST be a different value than JWT_ACCESS_SECRET. If both
   * tokens shared a secret, a leaked access token's signing key could be
   * used to forge a refresh token too, defeating the entire point of having
   * two separately-scoped tokens.
   */
  @IsNotEmpty({ message: 'JWT_REFRESH_SECRET is required' })
  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET must be at least 32 characters',
  })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;
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

  // A cross-field rule that class-validator's per-property decorators can't
  // express directly: if both secrets were ever the same, a leaked access
  // token's signing key could be used to forge a refresh token too,
  // defeating the entire point of having two separately-scoped tokens.
  if (
    validatedConfig.JWT_ACCESS_SECRET &&
    validatedConfig.JWT_ACCESS_SECRET === validatedConfig.JWT_REFRESH_SECRET
  ) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    );
  }

  return validatedConfig;
}
