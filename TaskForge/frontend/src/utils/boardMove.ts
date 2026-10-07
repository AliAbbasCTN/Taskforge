import type { BoardView } from '../types/api';
import { clampIndex } from './ordering';

/**
 * WHAT: Computes what the board will look like after moving a task - without
 * asking the server.
 *
 * WHY: this powers OPTIMISTIC updates. Waiting for the server before moving a
 * card makes dragging feel laggy: you drop it, it snaps back, and a moment
 * later jumps to the right place. Instead we show the expected result at once
 * and let the server's real answer replace it when it arrives (or roll back
 * if the server refuses).
 *
 * It is a PURE function (no React, no network, never mutates its input), which
 * is exactly what makes it easy to test. It mirrors the backend's rules: take
 * the task out of its column, insert it into the target column at `position`
 * (`undefined` = bottom), and renumber both columns 0, 1, 2...
 *
 * An unknown task or column returns the board unchanged.
 */
export function applyMove(
  board: BoardView,
  taskId: string,
  columnId: string,
  position?: number,
): BoardView {
  const task = board.columns
    .flatMap((column) => column.tasks)
    .find((candidate) => candidate.id === taskId);
  const target = board.columns.find((column) => column.id === columnId);
  if (!task || !target) {
    return board;
  }

  const renumber = <T extends { position: number }>(items: T[]): T[] =>
    items.map((item, index) => ({ ...item, position: index }));

  return {
    ...board,
    columns: board.columns.map((column) => {
      const remaining = column.tasks.filter((t) => t.id !== taskId);
      if (column.id !== columnId) {
        return { ...column, tasks: renumber(remaining) };
      }
      const index = clampIndex(position, remaining.length);
      const moved = { ...task, columnId };
      return {
        ...column,
        tasks: renumber([
          ...remaining.slice(0, index),
          moved,
          ...remaining.slice(index),
        ]),
      };
    }),
  };
}
