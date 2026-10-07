import { describe, expect, it } from 'vitest';
import type { BoardColumn, BoardView, Task } from '../types/api';
import { applyMove } from './boardMove';

const task = (id: string, columnId: string, position: number): Task => ({
  id,
  columnId,
  title: id,
  description: null,
  priority: 'MEDIUM',
  dueDate: null,
  assigneeId: null,
  position,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  assignee: null,
  labels: [],
});

const column = (id: string, position: number, tasks: Task[]): BoardColumn => ({
  id,
  boardId: 'b',
  name: id,
  position,
  tasks,
});

const board = (): BoardView => ({
  id: 'b',
  projectId: 'p',
  name: 'Board',
  columns: [
    column('todo', 0, [task('A', 'todo', 0), task('B', 'todo', 1), task('C', 'todo', 2)]),
    column('doing', 1, [task('D', 'doing', 0)]),
    column('done', 2, []),
  ],
});

const ids = (b: BoardView, columnId: string) =>
  b.columns.find((c) => c.id === columnId)!.tasks.map((t) => t.id);
const positions = (b: BoardView, columnId: string) =>
  b.columns.find((c) => c.id === columnId)!.tasks.map((t) => t.position);

describe('applyMove', () => {
  it('reorders within a column and renumbers it', () => {
    const result = applyMove(board(), 'C', 'todo', 0);

    expect(ids(result, 'todo')).toEqual(['C', 'A', 'B']);
    expect(positions(result, 'todo')).toEqual([0, 1, 2]);
  });

  it('moves across columns: closes the gap behind and makes room ahead', () => {
    const result = applyMove(board(), 'B', 'doing', 0);

    expect(ids(result, 'todo')).toEqual(['A', 'C']);
    expect(positions(result, 'todo')).toEqual([0, 1]);
    expect(ids(result, 'doing')).toEqual(['B', 'D']);
    expect(positions(result, 'doing')).toEqual([0, 1]);
  });

  it("updates the moved task's columnId", () => {
    const result = applyMove(board(), 'A', 'done');

    expect(result.columns[2].tasks[0].columnId).toBe('done');
  });

  it('appends to the bottom when no position is given', () => {
    expect(ids(applyMove(board(), 'A', 'doing'), 'doing')).toEqual(['D', 'A']);
  });

  it('drops into an empty column', () => {
    const result = applyMove(board(), 'D', 'done', 0);

    expect(ids(result, 'done')).toEqual(['D']);
    expect(ids(result, 'doing')).toEqual([]);
  });

  it('clamps an out-of-range position, like the server does', () => {
    expect(ids(applyMove(board(), 'A', 'doing', 99), 'doing')).toEqual(['D', 'A']);
    expect(ids(applyMove(board(), 'A', 'doing', -5), 'doing')).toEqual(['A', 'D']);
  });

  it('returns the board unchanged for an unknown task or column', () => {
    const original = board();

    expect(applyMove(original, 'nope', 'doing')).toBe(original);
    expect(applyMove(original, 'A', 'nope')).toBe(original);
  });

  it('never mutates its input', () => {
    const original = board();
    const snapshot = JSON.stringify(original);

    applyMove(original, 'A', 'doing', 0);

    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
