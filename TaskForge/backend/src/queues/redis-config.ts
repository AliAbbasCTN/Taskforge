import type { RedisOptions } from 'ioredis';

const DEFAULT_REDIS_PORT = 6379;

/**
 * WHAT: Turns a `redis://` URL into the options object the Redis client
 * library wants.
 *
 * WHY: configuration is ONE string (`REDIS_URL`) - easy to set, the same
 * shape every hosting provider hands out - but BullMQ takes separate
 * host/port/password fields. Parsing it in one tested place beats scattering
 * string handling around.
 *
 *   redis://localhost:6379
 *   redis://:s3cret@cache.example.com:6380/2     (password, port, database 2)
 *   rediss://user:pw@host:6380                   (TLS - note the double "s")
 */
export function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol "${parsed.protocol}"`);
  }

  let db: number | undefined;
  if (parsed.pathname.length > 1) {
    db = Number(parsed.pathname.slice(1));
    if (!Number.isInteger(db) || db < 0) {
      throw new Error(`Invalid Redis database "${parsed.pathname.slice(1)}"`);
    }
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : DEFAULT_REDIS_PORT,
    // Credentials in a URL are percent-encoded ("p%40ss" is "p@ss").
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
