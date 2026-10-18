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

/**
 * WHAT: How long to wait before reconnection attempt number `attempt` (1, 2,
 * 3, ...): 200 ms, 400 ms, 600 ms ... never more than 5 seconds.
 *
 * WHY a cap: ioredis' default keeps growing the delay. For a dependency that
 * should come back within seconds (a restarting container) a short, bounded
 * delay means TaskForge reconnects almost as soon as Redis is back.
 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(attempt * 200, 5000);
}

/**
 * WHAT: Options for the two long-lived Redis connections of the Socket.IO
 * adapter (see `SocketIoAdapter`).
 *
 * WHY `maxRetriesPerRequest: null` - the fix for a crash. By default ioredis
 * gives up on a COMMAND after 20 failed reconnect attempts and rejects its
 * promise with `MaxRetriesPerRequestError`. The adapter issues its
 * `SUBSCRIBE` commands once, at startup, and nothing handles that promise - so
 * with Redis down the rejection became an unhandled promise rejection, which
 * terminates a Node.js process. With `null` the commands simply WAIT, queued,
 * until Redis is reachable; ioredis then runs them and the adapter starts
 * working. Until then TaskForge runs normally with single-instance
 * (in-memory) real-time, which is exactly the degraded mode we want.
 */
export function adapterRedisOptions(url: string): RedisOptions {
  return {
    ...parseRedisUrl(url),
    maxRetriesPerRequest: null,
    retryStrategy: reconnectDelayMs,
  };
}
