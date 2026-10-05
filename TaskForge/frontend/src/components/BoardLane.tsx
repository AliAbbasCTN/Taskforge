import { useState, type CSSProperties, type FormEvent } from 'react';
import type { BoardColumn } from '../types/api';
import { TaskCard } from './TaskCard';

interface BoardLaneProps {
  column: BoardColumn;
  /** Position of this lane in the workflow: 0 (first) to 1 (last). */
  stage: number;
  allColumns: BoardColumn[];
  canWrite: boolean;
  busy: boolean;
  onAddTask: (columnId: string, title: string) => Promise<unknown>;
  onMoveTask: (taskId: string, columnId: string) => void;
}

/**
 * WHAT: One column ("lane") of the board: its name, its tasks in the order
 * the server returned them, and a form to add a task.
 *
 * `stage` colours the lane's top rule along a gradient from slate (start of
 * the workflow) to green (end). The colour carries information - how far along
 * work in this lane is - rather than decorating.
 */
export function BoardLane({
  column,
  stage,
  allColumns,
  canWrite,
  busy,
  onAddTask,
  onMoveTask,
}: BoardLaneProps) {
  const [title, setTitle] = useState('');
  const headingId = `lane-${column.id}`;
  const otherColumns = allColumns.filter((c) => c.id !== column.id);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    try {
      await onAddTask(column.id, trimmed);
      setTitle('');
    } catch {
      // Keep what the user typed so they can retry; the page shows the error.
    }
  }

  return (
    <section
      className="lane"
      style={{ '--stage': stage } as CSSProperties}
      aria-labelledby={headingId}
    >
      <header className="lane-header">
        <h2 id={headingId}>{column.name}</h2>
        <span className="lane-count" aria-label={`${column.tasks.length} tasks`}>
          {column.tasks.length}
        </span>
      </header>

      {column.tasks.length === 0 ? (
        <p className="lane-empty">Nothing here yet.</p>
      ) : (
        <ul className="task-list">
          {column.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              otherColumns={otherColumns}
              canMove={canWrite}
              disabled={busy}
              onMove={(columnId) => onMoveTask(task.id, columnId)}
            />
          ))}
        </ul>
      )}

      {canWrite && (
        <form onSubmit={handleSubmit} className="add-task">
          <label className="visually-hidden" htmlFor={`add-${column.id}`}>
            New task in {column.name}
          </label>
          <input
            id={`add-${column.id}`}
            placeholder="Add a task"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" className="btn btn-quiet" disabled={!title.trim()}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}
