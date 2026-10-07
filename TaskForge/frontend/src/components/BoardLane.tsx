import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from 'react';
import type { BoardColumn } from '../types/api';
import { computeDropIndex } from '../utils/dropIndex';
import { TaskCard } from './TaskCard';

interface BoardLaneProps {
  column: BoardColumn;
  /** Position of this lane in the workflow: 0 (first) to 1 (last). */
  stage: number;
  allColumns: BoardColumn[];
  canWrite: boolean;
  /** Drag-and-drop on? Off while a filter hides some tasks (see BoardPage). */
  canDrag: boolean;
  busy: boolean;
  onAddTask: (columnId: string, title: string) => Promise<unknown>;
  onMoveTask: (taskId: string, columnId: string, position?: number) => void;
}

/**
 * WHAT: One column ("lane") of the board: its name, its tasks in the order
 * the server returned them, and a form to add a task. It is also a DROP
 * TARGET for dragged cards.
 *
 * HOW A DROP WORKS: the browser fires `dragover` continuously while a card is
 * over the lane - we must `preventDefault()` there, or the browser refuses
 * to allow a drop at all. On `drop` we read the dragged task's id from the
 * payload, work out the insertion index from where the mouse was released
 * (`computeDropIndex`), and report it upward. The page then moves the task
 * optimistically and tells the server.
 */
export function BoardLane({
  column,
  stage,
  allColumns,
  canWrite,
  canDrag,
  busy,
  onAddTask,
  onMoveTask,
}: BoardLaneProps) {
  const [title, setTitle] = useState('');
  const [dropTarget, setDropTarget] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
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

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!canDrag) {
      return;
    }
    event.preventDefault(); // required: this is what makes the lane droppable
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    // `dragleave` also fires when moving onto a child; only clear the highlight
    // when the pointer really left the lane.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropTarget(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropTarget(false);
    const taskId = event.dataTransfer.getData('text/plain');
    if (!canDrag || !taskId) {
      return;
    }
    const cards = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-task-id]') ?? [],
    );
    const rects = cards.map((card) => {
      const box = card.getBoundingClientRect();
      return {
        id: card.dataset.taskId ?? '',
        top: box.top,
        height: box.height,
      };
    });
    onMoveTask(taskId, column.id, computeDropIndex(rects, event.clientY, taskId));
  }

  return (
    <section
      className={dropTarget ? 'lane is-drop-target' : 'lane'}
      style={{ '--stage': stage } as CSSProperties}
      aria-labelledby={headingId}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        <ul className="task-list" ref={listRef}>
          {column.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              otherColumns={otherColumns}
              canMove={canWrite}
              canDrag={canDrag}
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
