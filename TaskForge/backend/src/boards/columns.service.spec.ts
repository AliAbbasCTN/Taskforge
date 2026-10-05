import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ColumnsService } from './columns.service';

/**
 * UNIT tests for the column rules: ordering stays dense, and a column that
 * still holds tasks can't be deleted. The transaction callback is run
 * against a mock `tx` so the logic inside it is exercised directly.
 */
describe('ColumnsService', () => {
  let service: ColumnsService;
  let tx: {
    boardColumn: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    task: { count: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  const boardId = 'board-1';

  beforeEach(() => {
    tx = {
      boardColumn: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      task: { count: jest.fn() },
    };
    prisma = { $transaction: jest.fn(async (cb) => cb(tx)) };
    service = new ColumnsService(prisma as unknown as PrismaService);
  });

  const three = [
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
  ];

  describe('create', () => {
    it('appends at the end when no position is given, without renumbering others', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);
      tx.boardColumn.create.mockResolvedValue({ id: 'new', position: 3 });

      await service.create(boardId, { name: 'Review' });

      expect(tx.boardColumn.create).toHaveBeenCalledWith({
        data: { boardId, name: 'Review', position: 3 },
      });
      expect(tx.boardColumn.update).not.toHaveBeenCalled();
    });

    it('inserts at the requested position and shifts the later columns', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);
      tx.boardColumn.create.mockResolvedValue({ id: 'new', position: 3 });

      await service.create(boardId, { name: 'Backlog', position: 0 });

      const updates = tx.boardColumn.update.mock.calls.map((c) => [
        c[0].where.id,
        c[0].data.position,
      ]);
      expect(updates).toEqual(
        expect.arrayContaining([
          ['new', 0],
          ['a', 1],
          ['b', 2],
          ['c', 3],
        ]),
      );
    });
  });

  describe('update', () => {
    it('requires at least one field', async () => {
      await expect(service.update(boardId, 'a', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s for a column that is not on this board', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);

      await expect(
        service.update(boardId, 'not-here', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('moves a column and renumbers only the ones that changed', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);

      await service.update(boardId, 'a', { position: 2 });

      const updates = tx.boardColumn.update.mock.calls.map((c) => [
        c[0].where.id,
        c[0].data.position,
      ]);
      expect(updates).toEqual([
        ['b', 0],
        ['c', 1],
        ['a', 2],
      ]);
    });
  });

  describe('remove', () => {
    it('refuses to delete a column that still has tasks', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);
      tx.task.count.mockResolvedValue(2);

      await expect(service.remove(boardId, 'b')).rejects.toThrow(
        ConflictException,
      );
      expect(tx.boardColumn.delete).not.toHaveBeenCalled();
    });

    it('deletes an empty column and closes the gap it leaves', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);
      tx.task.count.mockResolvedValue(0);

      await service.remove(boardId, 'a');

      expect(tx.boardColumn.delete).toHaveBeenCalledWith({
        where: { id: 'a' },
      });
      const updates = tx.boardColumn.update.mock.calls.map((c) => [
        c[0].where.id,
        c[0].data.position,
      ]);
      expect(updates).toEqual([
        ['b', 0],
        ['c', 1],
      ]);
    });

    it('404s for a column from another board', async () => {
      tx.boardColumn.findMany.mockResolvedValue(three);

      await expect(service.remove(boardId, 'elsewhere')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
