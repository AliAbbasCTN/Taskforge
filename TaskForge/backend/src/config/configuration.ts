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
});
