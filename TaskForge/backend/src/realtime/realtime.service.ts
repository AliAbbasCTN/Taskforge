import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { RealtimeAccessService } from './realtime-access.service';
import { projectIdFromRoom, projectRoom, userRoom } from './realtime.rooms';

/**
 * WHAT: The rest of the application's only way to talk to connected clients.
 * Services and interceptors call `emitToProject(...)`; they never import
 * socket.io themselves.
 *
 * WHY the socket server is "attached" afterwards instead of injected: the
 * server object is created by the gateway when the app starts. Until then (in
 * unit tests, in the plain-HTTP e2e app) there is no server, and every method
 * here is a harmless no-op. That also means nothing outside this file can
 * crash because no one happens to be connected.
 *
 * LIMIT, worth knowing: rooms live in THIS process's memory. With several
 * server instances behind a load balancer, an event emitted on instance A
 * would not reach sockets connected to instance B. The standard fix is the
 * Socket.IO Redis adapter, which relays events between instances - it arrives
 * with Redis in Phase 12.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  constructor(private readonly access: RealtimeAccessService) {}

  attach(server: Server): void {
    this.server = server;
  }

  emitToProject(projectId: string, event: string, payload: unknown): void {
    this.server?.to(projectRoom(projectId)).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  /**
   * Removes `userId`'s sockets from every project room they may no longer
   * watch. Called after anything that can take access away - being removed
   * from a project or organization, or losing an ADMIN/MANAGER role.
   *
   * WHY this exists at all: joining a room is checked ONCE, when the socket
   * asks to join. Without this, removing someone from a project would leave
   * their already-open connection quietly receiving that project's events
   * until they closed the tab - an authorization hole that HTTP does not have,
   * because HTTP checks on every request. A socket is a long-lived session, so
   * revoking access has to be an explicit act.
   *
   * It re-asks the access check for each room instead of being told "remove
   * them from project X": one function covers every way access can be lost.
   */
  async revalidateUser(userId: string): Promise<void> {
    if (!this.server) {
      return;
    }
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    for (const socket of sockets) {
      for (const room of socket.rooms) {
        const projectId = projectIdFromRoom(room);
        if (
          projectId &&
          !(await this.access.canAccessProject(userId, projectId))
        ) {
          socket.leave(room);
          this.logger.debug(`Removed ${userId} from ${room}: access lost`);
        }
      }
    }
  }

  /** Closes every connection a user has (all tabs, all devices). Used on logout. */
  async disconnectUser(userId: string): Promise<void> {
    if (!this.server) {
      return;
    }
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }
  }
}
