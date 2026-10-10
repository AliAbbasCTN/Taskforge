import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeGateway } from './realtime.gateway';
import { MAX_PROJECT_ROOMS_PER_SOCKET } from './realtime.events';
import { RealtimeService } from './realtime.service';

const PROJECT = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_PROJECT = 'bbbbbbbb-0000-4000-8000-000000000001';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwt: { verifyAsync: jest.Mock };
  let access: { canAccessProject: jest.Mock };
  let realtime: { attach: jest.Mock };

  const socketWith = (overrides: Record<string, unknown> = {}) => {
    const socket = {
      handshake: { auth: { token: 'good-token' } },
      data: {} as Record<string, unknown>,
      rooms: new Set<string>(['socket-id']),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      once: jest.fn(),
      ...overrides,
    };
    return socket as unknown as Socket & typeof socket;
  };

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    access = { canAccessProject: jest.fn() };
    realtime = { attach: jest.fn() };
    gateway = new RealtimeGateway(
      jwt as unknown as JwtService,
      access as unknown as RealtimeAccessService,
      realtime as unknown as RealtimeService,
    );
  });

  describe('authenticate', () => {
    it('records who the socket is and when its token expires', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', exp: 2000 });
      const socket = socketWith();

      await gateway.authenticate(socket);

      expect(socket.data.userId).toBe('user-1');
      expect(socket.data.tokenExpiresAt).toBe(2000 * 1000);
    });

    it.each([undefined, '', 42, null, {}])(
      'rejects a missing or non-string token (%p) without even verifying',
      async (token) => {
        const socket = socketWith({ handshake: { auth: { token } } });

        await expect(gateway.authenticate(socket)).rejects.toThrow();
        expect(jwt.verifyAsync).not.toHaveBeenCalled();
      },
    );

    it('rejects a token that fails verification (forged, malformed, expired)', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(gateway.authenticate(socketWith())).rejects.toThrow();
    });
  });

  describe('afterInit: the handshake middleware', () => {
    const run = async (verify: () => Promise<unknown>) => {
      jwt.verifyAsync.mockImplementation(verify);
      let middleware!: (socket: Socket, next: (err?: Error) => void) => void;
      const server = {
        use: (fn: typeof middleware) => {
          middleware = fn;
        },
      } as unknown as Server;
      gateway.afterInit(server);

      const next = jest.fn();
      middleware(socketWith(), next);
      await new Promise((resolve) => setImmediate(resolve));
      return next;
    };

    it('attaches the server to the realtime service', async () => {
      await run(async () => ({ sub: 'u', exp: 1 }));

      expect(realtime.attach).toHaveBeenCalledTimes(1);
    });

    it('lets an authenticated socket through', async () => {
      const next = await run(async () => ({ sub: 'u', exp: 1 }));

      expect(next).toHaveBeenCalledWith();
    });

    it('refuses an unauthenticated socket with a generic "unauthorized"', async () => {
      const next = await run(async () => {
        throw new Error('jwt malformed: internal detail');
      });

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0] as Error;
      expect(error.message).toBe('unauthorized');
    });
  });

  describe('handleConnection', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('puts the socket in its personal room', () => {
      const socket = socketWith();
      socket.data.userId = 'user-1';
      socket.data.tokenExpiresAt = Date.now() + 60_000;

      gateway.handleConnection(socket);

      expect(socket.join).toHaveBeenCalledWith('user:user-1');
    });

    it('drops a socket that somehow has no user', () => {
      const socket = socketWith();

      gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('closes the socket when its access token expires', () => {
      const socket = socketWith();
      socket.data.userId = 'user-1';
      socket.data.tokenExpiresAt = Date.now() + 1000;

      gateway.handleConnection(socket);
      jest.advanceTimersByTime(999);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('cancels the expiry timer if the socket disconnects first', () => {
      const socket = socketWith();
      socket.data.userId = 'user-1';
      socket.data.tokenExpiresAt = Date.now() + 1000;

      gateway.handleConnection(socket);
      const onDisconnect = socket.once.mock.calls.find(
        ([event]: [string]) => event === 'disconnect',
      )[1];
      onDisconnect();
      jest.advanceTimersByTime(5000);

      expect(socket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleJoin', () => {
    const authedSocket = () => {
      const socket = socketWith();
      socket.data.userId = 'user-1';
      return socket;
    };

    it('joins the project room when access is granted', async () => {
      access.canAccessProject.mockResolvedValue(true);
      const socket = authedSocket();

      const ack = await gateway.handleJoin(socket, { projectId: PROJECT });

      expect(ack).toEqual({ ok: true });
      expect(access.canAccessProject).toHaveBeenCalledWith('user-1', PROJECT);
      expect(socket.join).toHaveBeenCalledWith(`project:${PROJECT}`);
    });

    it('refuses, WITHOUT joining, when access is denied - and says only "not found"', async () => {
      access.canAccessProject.mockResolvedValue(false);
      const socket = authedSocket();

      const ack = await gateway.handleJoin(socket, { projectId: PROJECT });

      expect(ack).toEqual({ ok: false, error: 'Project not found' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('gives the same answer for a malformed id, never touching the database', async () => {
      const ack = await gateway.handleJoin(authedSocket(), {
        projectId: 'not-a-uuid',
      });

      expect(ack).toEqual({ ok: false, error: 'Project not found' });
      expect(access.canAccessProject).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 42, {}])(
      'rejects a non-string projectId (%p)',
      async (projectId) => {
        const ack = await gateway.handleJoin(authedSocket(), { projectId });

        expect(ack.ok).toBe(false);
      },
    );

    it('refuses a socket with no authenticated user', async () => {
      const ack = await gateway.handleJoin(socketWith(), {
        projectId: PROJECT,
      });

      expect(ack).toEqual({ ok: false, error: 'Not authenticated' });
    });

    it('caps how many project rooms one socket can hold', async () => {
      const socket = authedSocket();
      for (let i = 0; i < MAX_PROJECT_ROOMS_PER_SOCKET; i++) {
        socket.rooms.add(`project:room-${i}`);
      }

      const ack = await gateway.handleJoin(socket, {
        projectId: OTHER_PROJECT,
      });

      expect(ack.ok).toBe(false);
      expect(access.canAccessProject).not.toHaveBeenCalled();
    });

    it('still allows re-joining a room the socket is already in at the cap', async () => {
      access.canAccessProject.mockResolvedValue(true);
      const socket = authedSocket();
      for (let i = 0; i < MAX_PROJECT_ROOMS_PER_SOCKET - 1; i++) {
        socket.rooms.add(`project:room-${i}`);
      }
      socket.rooms.add(`project:${PROJECT}`);

      const ack = await gateway.handleJoin(socket, { projectId: PROJECT });

      expect(ack).toEqual({ ok: true });
    });
  });

  describe('handleLeave', () => {
    it('leaves the room', async () => {
      const socket = socketWith();

      await gateway.handleLeave(socket, { projectId: PROJECT });

      expect(socket.leave).toHaveBeenCalledWith(`project:${PROJECT}`);
    });

    it('ignores a malformed id', async () => {
      const socket = socketWith();

      await gateway.handleLeave(socket, { projectId: 'nope' });

      expect(socket.leave).not.toHaveBeenCalled();
    });
  });
});
