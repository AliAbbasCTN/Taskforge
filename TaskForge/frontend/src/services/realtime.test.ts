import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests the socket client's BOOKKEEPING - rooms, re-joining, reconnecting with
 * a fresh token - against a fake Socket.IO socket, so no server is needed.
 * (The real connection is covered by the backend's realtime e2e tests.)
 */

const { sockets, FakeSocket, refreshTokens } = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeSocket {
    connected = false;
    connectCalls = 0;
    emitted: unknown[][] = [];
    private handlers = new Map<string, Handler[]>();
    io = { on: () => undefined };

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(...args: unknown[]) {
      this.emitted.push(args);
      return this;
    }
    connect() {
      this.connectCalls += 1;
      return this;
    }
    disconnect() {
      this.connected = false;
      return this;
    }
    removeAllListeners() {
      this.handlers.clear();
      return this;
    }
    /** Simulates the server/transport raising `event`. */
    trigger(event: string, ...args: unknown[]) {
      if (event === 'connect') {
        this.connected = true;
      }
      if (event === 'disconnect') {
        this.connected = false;
      }
      (this.handlers.get(event) ?? []).forEach((handler) => handler(...args));
    }
  }

  return {
    sockets: [] as FakeSocket[],
    FakeSocket,
    refreshTokens: vi.fn(),
  };
});

vi.mock('socket.io-client', () => ({
  io: () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  },
}));
vi.mock('./http', () => ({ API_URL: 'http://api.test', refreshTokens }));
vi.mock('./tokenStore', () => ({
  tokenStore: { getAccessToken: () => 'token' },
}));

type Realtime = typeof import('./realtime');

describe('realtime client', () => {
  let realtime: Realtime;
  const current = () => sockets[sockets.length - 1];
  const joins = (socket: InstanceType<typeof FakeSocket>) =>
    socket.emitted.filter(([event]) => event === 'project:join');
  const leaves = (socket: InstanceType<typeof FakeSocket>) =>
    socket.emitted.filter(([event]) => event === 'project:leave');
  /** Lets promise callbacks (the async reconnect) run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    vi.resetModules(); // the client keeps module-level state; start clean
    sockets.length = 0;
    refreshTokens.mockReset();
    realtime = await import('./realtime');
  });

  describe('rooms', () => {
    it('asks to join once connected, and again after every reconnect', () => {
      realtime.connectRealtime();
      realtime.joinProject('p1'); // joined BEFORE the socket connected
      expect(joins(current())).toHaveLength(0);

      current().trigger('connect');
      expect(joins(current())).toEqual([['project:join', { projectId: 'p1' }]]);

      // Rooms live per-connection on the server; a new connection starts empty.
      current().trigger('disconnect', 'transport close');
      current().trigger('connect');
      expect(joins(current())).toHaveLength(2);
    });

    it('joins immediately when already connected', () => {
      realtime.connectRealtime();
      current().trigger('connect');

      realtime.joinProject('p1');

      expect(joins(current())).toHaveLength(1);
    });

    it('reference-counts: two watchers share one join, and the room is left only when the LAST stops', () => {
      realtime.connectRealtime();
      current().trigger('connect');

      const first = realtime.joinProject('p1');
      const second = realtime.joinProject('p1');
      expect(joins(current())).toHaveLength(1);

      first();
      expect(leaves(current())).toHaveLength(0);
      second();
      expect(leaves(current())).toEqual([['project:leave', { projectId: 'p1' }]]);
    });

    it('releasing twice does not leave early', () => {
      realtime.connectRealtime();
      current().trigger('connect');
      const first = realtime.joinProject('p1');
      realtime.joinProject('p1');

      first();
      first();

      expect(leaves(current())).toHaveLength(0);
    });

    it('forgets every room on disconnect', () => {
      realtime.connectRealtime();
      realtime.joinProject('p1');
      realtime.disconnectRealtime();

      realtime.connectRealtime();
      current().trigger('connect');

      expect(joins(current())).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('forwards project changes and notifications to listeners until they unsubscribe', () => {
      realtime.connectRealtime();
      const onChange = vi.fn();
      const onNotification = vi.fn();
      const stopChange = realtime.onProjectChanged(onChange);
      realtime.onNotification(onNotification);

      current().trigger('project:changed', { resource: 'tasks' });
      current().trigger('notification:created', { id: 'n1' });
      stopChange();
      current().trigger('project:changed', { resource: 'tasks' });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onNotification).toHaveBeenCalledWith({ id: 'n1' });
    });
  });

  describe('connection state', () => {
    it('follows the socket and notifies subscribers', () => {
      const listener = vi.fn();
      realtime.onConnectionState(listener);
      expect(realtime.getConnectionState()).toBe('disconnected');

      realtime.connectRealtime();
      expect(realtime.getConnectionState()).toBe('connecting');
      current().trigger('connect');
      expect(realtime.getConnectionState()).toBe('connected');
      current().trigger('disconnect', 'transport close');
      expect(realtime.getConnectionState()).toBe('disconnected');
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('token expiry and rejection', () => {
    it('after the SERVER closes the socket (token expired), refreshes and reconnects', async () => {
      refreshTokens.mockResolvedValue(true);
      realtime.connectRealtime();
      current().trigger('connect');
      const connectsBefore = current().connectCalls;

      current().trigger('disconnect', 'io server disconnect');
      await flush();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(current().connectCalls).toBe(connectsBefore + 1);
    });

    it('does NOT try to recover when the client itself closed the connection', async () => {
      realtime.connectRealtime();
      current().trigger('connect');

      current().trigger('disconnect', 'io client disconnect');
      await flush();

      expect(refreshTokens).not.toHaveBeenCalled();
    });

    it('stays disconnected if the session cannot be refreshed', async () => {
      refreshTokens.mockResolvedValue(false);
      realtime.connectRealtime();

      current().trigger('connect_error', new Error('unauthorized'));
      await flush();

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(current().connectCalls).toBe(1); // only the initial connect
      expect(realtime.getConnectionState()).toBe('disconnected');
    });

    it('gives up after repeated rejections instead of burning refresh tokens forever', async () => {
      refreshTokens.mockResolvedValue(true);
      realtime.connectRealtime();

      for (let attempt = 0; attempt < 5; attempt++) {
        current().trigger('connect_error', new Error('unauthorized'));
        await flush();
      }

      expect(refreshTokens).toHaveBeenCalledTimes(2);
    });

    it('does not treat an ordinary network failure as an auth problem', async () => {
      realtime.connectRealtime();

      current().trigger('connect_error', new Error('xhr poll error'));
      await flush();

      expect(refreshTokens).not.toHaveBeenCalled();
    });
  });
});
