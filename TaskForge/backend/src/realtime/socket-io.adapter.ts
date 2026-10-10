import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
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
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });
  }
}
