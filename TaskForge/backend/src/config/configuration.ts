/**
 * WHAT: A factory function that reads raw `process.env` values and groups
 * them into a typed, namespaced configuration object.
 *
 * WHY: Reading `process.env.SOME_VAR` directly, scattered across the
 * codebase, makes it hard to know what environment variables exist, easy to
 * typo a name, and impossible to get autocomplete/type safety. Centralizing
 * it here means the rest of the app calls `configService.get('app.port')`
 * instead, and there is exactly one place that knows about `process.env`.
 *
 * WHERE: Loaded by `ConfigModule.forRoot({ load: [configuration] })` in
 * `config.module.ts`, and consumed anywhere via NestJS's `ConfigService`.
 */
export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
  database: {
    // Prisma reads DATABASE_URL directly from the environment, so this entry
    // is not what configures Prisma. It is exposed here so the rest of the
    // application (and the env validation below) treat it as a first-class
    // piece of configuration rather than a hidden implicit dependency.
    url: process.env.DATABASE_URL,
  },
  redis: {
    // Used for the job queues (BullMQ) and for relaying real-time events
    // between server instances (the Socket.IO Redis adapter). The default
    // matches the Redis container in docker-compose.yml.
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  storage: {
    // Where uploaded files are kept: 'local' (a folder on disk - development)
    // or 's3' (an AWS S3 bucket - production). See docs/phase-13-concepts.md.
    driver: process.env.STORAGE_DRIVER || 'local',
    // Relative paths are resolved from the backend's working directory.
    localDir: process.env.STORAGE_LOCAL_DIR || 'uploads',
    // The per-file size limit, converted from megabytes to bytes once, here.
    maxFileSizeBytes:
      parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || '10', 10) * 1024 * 1024,
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION,
      // Only for S3-compatible services such as MinIO or LocalStack.
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      // NOTE: there are deliberately NO AWS credentials here. The AWS SDK finds
      // them itself (environment, shared credentials file, or an IAM role).
    },
  },
  jwt: {
    // Access tokens are short-lived: if one is ever stolen (e.g. via an XSS
    // attack in a future frontend), the window an attacker can use it in is
    // small. Refresh tokens live much longer, but are only ever sent to
    // `/auth/refresh`, are hashed at rest, and are rotated on every use -
    // see docs/phase-03-concepts.md for the full reasoning.
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
});
