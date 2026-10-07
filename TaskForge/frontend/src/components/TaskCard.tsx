import { useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Task, TaskPriority } from '../types/api';
import { formatDueDate, initialOf, isOverdue } from '../utils/format';
import { LabelChip } from './LabelChip';

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

interface TaskCardProps {
  task: Task;
  /** The other columns this task could be moved to. */
  otherColumns: { id: string; name: string }[];
  canMove: boolean;
  /** Whether drag-and-drop is on (off while filters hide some tasks). */
  canDrag: boolean;
  disabled: boolean;
  onMove: (columnId: string) => void;
}

/**
 * WHAT: One task on the board. Its title opens the detail panel; the card can
 * be dragged to another lane (or position), and a "Move to" menu does the
 * same without a mouse.
 *
 * DRAG AND DROP uses the browser's built-in HTML5 API - no library. The card
 * is `draggable`; on drag start it puts its id in the drag payload, and the
 * LANE it is dropped on reads that id back (see `BoardLane`). The `<select>`
 * stays as the keyboard, screen-reader and touch-screen route, because the
 * HTML5 drag API doesn't work for any of those.
 */
export function TaskCard({
  task,
  otherColumns,
  canMove,
  canDrag,
  disabled,
  onMove,
}: TaskCardProps) {
  const location = useLocation();
  const [dragging, setDragging] = useState(false);

  function handleDragStart(event: DragEvent<HTMLLIElement>) {
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }

  return (
    <li
      className={dragging ? 'task is-dragging' : 'task'}
      data-task-id={task.id}
      draggable={canDrag && !disabled}
      onDragStart={handleDragStart}
      onDragEnd={() => setDragging(false)}
    >
      {/* Relative link: resolves against this board's route. Keeping
          `search` preserves the active filters behind the panel. */}
      <Link
        to={{ pathname: `tasks/${task.id}`, search: location.search }}
        className="task-title"
      >
        {task.title}
      </Link>

      {task.labels.length > 0 && (
        <ul className="chips" aria-label="Labels">
          {task.labels.map((label) => (
            <li key={label.id}>
              <LabelChip label={label} />
            </li>
          ))}
        </ul>
      )}

      <div className="task-meta">
        <span className={`priority priority-${task.priority.toLowerCase()}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.dueDate && (
          <span className={isOverdue(task.dueDate) ? 'due due-overdue' : 'due'}>
            Due {formatDueDate(task.dueDate)}
          </span>
        )}
        {task.assignee && (
          <span
            className="avatar avatar-small"
            role="img"
            aria-label={`Assigned to ${task.assignee.name}`}
          >
            {initialOf(task.assignee.name)}
          </span>
        )}
      </div>

      {canMove && otherColumns.length > 0 && (
        <select
          className="task-move"
          aria-label={`Move "${task.title}" to another column`}
          value=""
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) {
              onMove(event.target.value);
            }
          }}
        >
          <option value="">Move to…</option>
          {otherColumns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}
