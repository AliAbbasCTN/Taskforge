import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { isUuid } from '../common/utils/is-uuid';
import { RealtimeAccessService } from './realtime-access.service';
import {
  JoinAck,
  MAX_PROJECT_ROOMS_PER_SOCKET,
  PROJECT_JOIN,
  PROJECT_LEAVE,
} from './realtime.events';
import { projectIdFromRoom, projectRoom, userRoom } from './realtime.rooms';
import { RealtimeService } from './realtime.service';

interface AccessTokenPayload {
  sub: string;
  exp: number;
}

/**
 * WHAT: The WebSocket endpoint. It handles three things: WHO may connect,
 * WHICH rooms they may join, and WHEN a connection must end.
 *
 * WEBSOCKETS IN ONE PARAGRAPH: HTTP is request/response - the client always
 * speaks first and the connection is over once the answer arrives, so a server
 * can never tell a client "something just happened". A WebSocket is a single
 * long-lived, two-way connection: after an initial HTTP "upgrade" handshake
 * either side can send messages at any time. Socket.IO is a library on top
 * that adds what raw WebSockets lack: named events, automatic reconnection,
 * rooms, and acknowledgements (a reply to a specific message).
 *
 * AUTHENTICATION happens in a handshake MIDDLEWARE (below), before the
 * connection exists, so an unauthenticated socket never reaches any handler.
 * The browser can't set an `Authorization` header on a WebSocket, so the token
 * travels in the handshake's `auth` object instead.
 *
 * EXPIRY: an access token lives 15 minutes, but a socket can live for days. A
 * connection that outlived its token would be a session the server can no
 * longer vouch for, so each socket is closed when its token expires. The
 * client reconnects with a freshly refreshed token (see the frontend's
 * `services/realtime.ts`).
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly access: RealtimeAccessService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);

    // Runs for every connection attempt, BEFORE the 'connection' event.
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error('unauthorized')),
      );
    });
  }

  /**
   * Verifies the access token from the handshake and records who this socket
   * belongs to. Throws if the token is missing, malformed, forged or expired.
   * (Same secret and expiry rules as the HTTP `JwtStrategy`.)
   */
  async authenticate(socket: Socket): Promise<void> {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Missing token');
    }
    const payload =
      await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    socket.data.userId = payload.sub;
    socket.data.tokenExpiresAt = payload.exp * 1000;
  }

  handleConnection(client: Socket): void {
    const userId: string | undefined = client.data.userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.join(userRoom(userId));
    this.scheduleExpiry(client);
  }

  /** Disconnects `client` the moment its access token expires. */
  scheduleExpiry(client: Socket): NodeJS.Timeout {
    const remainingMs = Math.max(
      0,
      (client.data.tokenExpiresAt as number) - Date.now(),
    );
    const timer = setTimeout(() => client.disconnect(true), remainingMs);
    client.once('disconnect', () => clearTimeout(timer));
    return timer;
  }

  /**
   * Client asks to watch a project. The answer comes back as the message's
   * ACKNOWLEDGEMENT (the handler's return value), so the client knows whether
   * it worked rather than waiting for events that will never arrive.
   *
   * The error text is deliberately the same for "doesn't exist" and "not
   * yours" - the 404-not-403 rule from the HTTP API, applied to sockets.
   */
  @SubscribeMessage(PROJECT_JOIN)
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: unknown },
  ): Promise<JoinAck> {
    const userId: string | undefined = client.data.userId;
    const projectId = body?.projectId;

    if (!userId) {
      return { ok: false, error: 'Not authenticated' };
    }
    if (!isUuid(projectId)) {
      return { ok: false, error: 'Project not found' };
    }

    const alreadyIn = [...client.rooms].filter((room) =>
      projectIdFromRoom(room),
    );
    if (
      !client.rooms.has(projectRoom(projectId)) &&
      alreadyIn.length >= MAX_PROJECT_ROOMS_PER_SOCKET
    ) {
      return { ok: false, error: 'Too many projects open at once' };
    }

    if (!(await this.access.canAccessProject(userId, projectId))) {
      return { ok: false, error: 'Project not found' };
    }

    await client.join(projectRoom(projectId));
    return { ok: true };
  }

  @SubscribeMessage(PROJECT_LEAVE)
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: unknown },
  ): Promise<JoinAck> {
    const projectId = body?.projectId;
    if (isUuid(projectId)) {
      await client.leave(projectRoom(projectId));
    }
    return { ok: true };
  }
}
