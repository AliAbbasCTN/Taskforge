import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { adapterRedisOptions } from '../queues/redis-config';
import { watchRedisClient } from '../queues/redis-connection-logger';
import type { ServerOptions } from 'socket.io';

/**
 * WHAT: Tells Socket.IO which website origin may connect.
 *
 * The HTTP API's CORS setting (`app.enableCors` in main.ts) does NOT cover the
 * socket server - it is a separate server with its own CORS handling. Without
 * this, a browser on http://localhost:5173 would be blocked from connecting.
 * It reuses the same `CORS_ORIGIN` value so the two can't disagree.
 *
 * (Authentication does not depend on this: even an allowed origin must present
 * a valid access token. CORS only decides which BROWSER PAGES may try.)
 */
export class SocketIoAdapter extends IoAdapter {
  private readonly logger = new Logger(SocketIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string,
    private readonly redisUrl?: string,
  ) {
    super(app);
  }

  /**
   * Connects the Socket.IO "Redis adapter".
   *
   * THE PROBLEM IT SOLVES: rooms and connected sockets live in ONE process's
   * memory. Run two server instances behind a load balancer and a browser
   * connected to instance A is invisible to instance B - so when a request
   * handled by B emits `project:changed`, the people connected to A never hear
   * it. The Redis adapter relays every emit and room operation through Redis
   * pub/sub, so all instances behave as one big server. It also makes
   * `fetchSockets()` (used to revoke access when someone is removed) see
   * sockets on EVERY instance.
   *
   * Two connections are needed because a Redis connection that has subscribed
   * can do nothing but listen: one to publish, one to subscribe.
   *
   * Without a `redisUrl` (e.g. in tests) this is a no-op and the default
   * in-memory adapter is used - correct for a single instance.
   */
  connectToRedis(): void {
    if (!this.redisUrl) {
      return;
    }
    // `adapterRedisOptions` makes pending commands wait for Redis instead of
    // failing after 20 retries - which used to crash the whole process when
    // Redis was down at startup (an unhandled rejection from the adapter's
    // SUBSCRIBE). See its documentation.
    const publisher = new Redis(adapterRedisOptions(this.redisUrl));
    const subscriber = publisher.duplicate();
    // An unhandled 'error' event would also crash the process; log it instead
    // (throttled - a down Redis would otherwise fire several per second). The
    // clients reconnect by themselves.
    watchRedisClient(publisher, 'Socket.IO adapter (publisher)', this.logger);
    watchRedisClient(subscriber, 'Socket.IO adapter (subscriber)', this.logger);
    this.adapterConstructor = createAdapter(publisher, subscriber);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
