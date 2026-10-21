/** The two events of an ioredis client this helper cares about. */
export interface RedisEventSource {
  on(event: 'error', listener: (error: Error & { code?: string }) => void): unknown;
  on(event: 'ready', listener: () => void): unknown;
}

export interface WarnLogger {
  warn(message: string): void;
  log(message: string): void;
}

/** Fewest milliseconds between two "connection error" log lines per client. */
export const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * WHAT: Logs a Redis client's connection problems WITHOUT flooding the log,
 * and without ever crashing the process.
 *
 * Two jobs in one place:
 *  1. Registering an 'error' listener at all. Node's EventEmitter THROWS when
 *     an 'error' event has no listener, which would take the process down.
 *  2. Throttling. A client that cannot reach Redis fires an error on every
 *     retry - several per second - and the useful information ("Redis is
 *     down") is the same each time. We log the first error, then at most one
 *     reminder per `intervalMs`, and a line when the connection comes back.
 *
 * It also fixes an unhelpful message: connecting to `localhost` tries both
 * IPv6 and IPv4, and Node reports that as an `AggregateError` whose `message`
 * is EMPTY - the text lives in `code` (e.g. ECONNREFUSED).
 */
export function watchRedisClient(
  client: RedisEventSource,
  label: string,
  logger: WarnLogger,
  options: { intervalMs?: number; now?: () => number } = {},
): void {
  const intervalMs = options.intervalMs ?? REDIS_ERROR_LOG_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastLoggedAt: number | null = null;
  let suppressed = 0;
  let down = false;

  client.on('error', (error) => {
    down = true;
    const current = now();
    if (lastLoggedAt !== null && current - lastLoggedAt < intervalMs) {
      suppressed += 1;
      return;
    }
    const reason = error.message || error.code || error.name || 'unknown error';
    const extra = suppressed > 0 ? ` (${suppressed} similar errors not shown)` : '';
    logger.warn(`${label}: cannot reach Redis - ${reason}${extra}. Retrying in the background.`);
    lastLoggedAt = current;
    suppressed = 0;
  });

  client.on('ready', () => {
    if (down) {
      logger.log(`${label}: connection to Redis restored`);
    }
    down = false;
    lastLoggedAt = null;
    suppressed = 0;
  });
}
