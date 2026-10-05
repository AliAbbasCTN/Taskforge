import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TasksService } from './tasks.service';

/**
 * UNIT tests for the rules that live in TasksService: assignees must be
 * project members, columns must belong to the board, tasks are scoped to the
 * board, and moves keep both orderings dense. (Guards and real SQL are
 * covered by the e2e tests.)
 */
describe('TasksService', () => {
  let service: TasksService;
  let tx: {
    boardColumn: { findFirst: jest.Mock };
    task: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let prisma: {
    $transaction: jest.Mock;
    projectMembership: { findUnique: jest.Mock };
    task: { findFirst: jest.Mock; update: jest.Mock };
  };

  const projectId = 'project-1';
  const boardId = 'board-1';
  const userId = 'user-1';

  const updatesOf = (mock: jest.Mock) =>
    mock.mock.calls.map((c) => [c[0].where.id, c[0].data.position]);

  beforeEach(() => {
    tx = {
      boardColumn: { findFirst: jest.fn().mockResolvedValue({ id: 'col' }) },
      task: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'result' }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (cb) => cb(tx)),
      projectMembership: { findUnique: jest.fn() },
      task: { findFirst: jest.fn(), update: jest.fn() },
    };
    service = new TasksService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('rejects an assignee who is not a member of the project (422)', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.create(projectId, boardId, {
          columnId: 'col',
          title: 'Do it',
          assigneeId: userId,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(tx.task.create).not.toHaveBeenCalled();
    });

    it('rejects a column that is not on this board (422)', async () => {
      tx.boardColumn.findFirst.mockResolvedValue(null);

      await expect(
        service.create(projectId, boardId, { columnId: 'x', title: 'Do it' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(tx.task.create).not.toHaveBeenCalled();
    });

    it('appends to the bottom of the column by default', async () => {
      tx.task.findMany.mockResolvedValue([
        { id: 't1', position: 0 },
        { id: 't2', position: 1 },
      ]);
      tx.task.create.mockResolvedValue({ id: 'new', position: 2 });

      await service.create(projectId, boardId, {
        columnId: 'col',
        title: 'Third',
      });

      expect(tx.task.create.mock.calls[0][0].data.position).toBe(2);
      expect(tx.task.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('requires at least one field', async () => {
      await expect(
        service.update(projectId, boardId, 'task', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears assignee, due date and description when given null', async () => {
      prisma.task.findFirst.mockResolvedValue({ id: 'task' });
      prisma.task.update.mockResolvedValue({ id: 'task' });

      await service.update(projectId, boardId, 'task', {
        assigneeId: null,
        dueDate: null,
        description: null,
      });

      expect(prisma.task.update.mock.calls[0][0].data).toEqual({
        assigneeId: null,
        dueDate: null,
        description: null,
      });
      // Clearing needs no membership lookup.
      expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a non-member assignee (422)', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.update(projectId, boardId, 'task', { assigneeId: userId }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('404s for a task that is not on this board', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(
        service.update(projectId, boardId, 'task', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('move', () => {
    it('reorders within the same column', async () => {
      tx.task.findFirst.mockResolvedValue({ id: 't3', columnId: 'col' });
      tx.task.findMany.mockResolvedValue([
        { id: 't1', position: 0 },
        { id: 't2', position: 1 },
        { id: 't3', position: 2 },
      ]);

      await service.move(boardId, 't3', { columnId: 'col', position: 0 });

      expect(updatesOf(tx.task.update)).toEqual([
        ['t3', 0],
        ['t1', 1],
        ['t2', 2],
      ]);
    });

    it('moves across columns: closes the source gap and inserts into the target', async () => {
      tx.task.findFirst.mockResolvedValue({ id: 't2', columnId: 'src' });
      tx.task.findMany
        .mockResolvedValueOnce([
          { id: 't1', position: 0 },
          { id: 't2', position: 1 },
          { id: 't3', position: 2 },
        ]) // source column
        .mockResolvedValueOnce([
          { id: 'x1', position: 0 },
          { id: 'x2', position: 1 },
        ]); // target column

      await service.move(boardId, 't2', { columnId: 'dst', position: 1 });

      const calls = tx.task.update.mock.calls.map((c) => c[0]);
      // Source: t3 slides up from 2 to 1 (t1 is unchanged).
      expect(calls).toContainEqual({
        where: { id: 't3' },
        data: { position: 1 },
      });
      // The task itself joins the target column...
      expect(calls).toContainEqual({
        where: { id: 't2' },
        data: { columnId: 'dst', position: 2 },
      });
      // ...and is slid into slot 1, pushing x2 down.
      expect(calls).toContainEqual({
        where: { id: 't2' },
        data: { position: 1 },
      });
      expect(calls).toContainEqual({
        where: { id: 'x2' },
        data: { position: 2 },
      });
    });

    it('rejects a target column from another board (422) and changes nothing', async () => {
      tx.task.findFirst.mockResolvedValue({ id: 't1', columnId: 'src' });
      tx.boardColumn.findFirst.mockResolvedValue(null);

      await expect(
        service.move(boardId, 't1', { columnId: 'foreign' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(tx.task.update).not.toHaveBeenCalled();
    });

    it('404s for a task from another board', async () => {
      tx.task.findFirst.mockResolvedValue(null);

      await expect(
        service.move(boardId, 'nope', { columnId: 'col' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the task and closes the gap in its column', async () => {
      tx.task.findFirst.mockResolvedValue({ id: 't1', columnId: 'col' });
      tx.task.findMany.mockResolvedValue([
        { id: 't2', position: 1 },
        { id: 't3', position: 2 },
      ]);

      await service.remove(boardId, 't1');

      expect(tx.task.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(updatesOf(tx.task.update)).toEqual([
        ['t2', 0],
        ['t3', 1],
      ]);
    });
  });
});
