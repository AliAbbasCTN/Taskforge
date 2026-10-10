import type { Server } from 'socket.io';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  let access: { canAccessProject: jest.Mock };
  let service: RealtimeService;
  let emit: jest.Mock;
  let to: jest.Mock;
  let fetchSockets: jest.Mock;
  let server: Server;

  const fakeSocket = (rooms: string[]) => ({
    rooms: new Set(rooms),
    leave: jest.fn(),
    disconnect: jest.fn(),
  });

  beforeEach(() => {
    access = { canAccessProject: jest.fn() };
    service = new RealtimeService(access as unknown as RealtimeAccessService);
    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    fetchSockets = jest.fn();
    server = {
      to,
      in: jest.fn(() => ({ fetchSockets })),
    } as unknown as Server;
  });

  describe('before a socket server is attached (unit tests, plain HTTP app)', () => {
    it('every method is a harmless no-op', async () => {
      expect(() => service.emitToProject('p', 'e', {})).not.toThrow();
      expect(() => service.emitToUser('u', 'e', {})).not.toThrow();
      await expect(service.revalidateUser('u')).resolves.toBeUndefined();
      await expect(service.disconnectUser('u')).resolves.toBeUndefined();
    });
  });

  describe('once attached', () => {
    beforeEach(() => service.attach(server));

    it('emits to the project room and the user room by name', () => {
      service.emitToProject('p1', 'project:changed', { a: 1 });
      service.emitToUser('u1', 'notification:created', { b: 2 });

      expect(to).toHaveBeenNthCalledWith(1, 'project:p1');
      expect(to).toHaveBeenNthCalledWith(2, 'user:u1');
      expect(emit).toHaveBeenNthCalledWith(1, 'project:changed', { a: 1 });
      expect(emit).toHaveBeenNthCalledWith(2, 'notification:created', { b: 2 });
    });

    it('revalidateUser removes sockets ONLY from project rooms the user can no longer access', async () => {
      const socket = fakeSocket([
        'socket-id',
        'user:u1',
        'project:allowed',
        'project:revoked',
      ]);
      fetchSockets.mockResolvedValue([socket]);
      access.canAccessProject.mockImplementation(
        async (_user: string, projectId: string) => projectId === 'allowed',
      );

      await service.revalidateUser('u1');

      expect(socket.leave).toHaveBeenCalledTimes(1);
      expect(socket.leave).toHaveBeenCalledWith('project:revoked');
    });

    it("revalidateUser covers every one of the user's sockets (all tabs and devices)", async () => {
      const tab1 = fakeSocket(['project:p']);
      const tab2 = fakeSocket(['project:p']);
      fetchSockets.mockResolvedValue([tab1, tab2]);
      access.canAccessProject.mockResolvedValue(false);

      await service.revalidateUser('u1');

      expect(tab1.leave).toHaveBeenCalledWith('project:p');
      expect(tab2.leave).toHaveBeenCalledWith('project:p');
    });

    it('disconnectUser closes every connection', async () => {
      const a = fakeSocket([]);
      const b = fakeSocket([]);
      fetchSockets.mockResolvedValue([a, b]);

      await service.disconnectUser('u1');

      expect(a.disconnect).toHaveBeenCalledWith(true);
      expect(b.disconnect).toHaveBeenCalledWith(true);
    });
  });
});
