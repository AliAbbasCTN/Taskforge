import type { Task, TaskPriority } from '../types/api';
import { formatDueDate, initialOf, isOverdue } from '../utils/format';

const PRIORITY_LABEL: Record<TaskPriority, string> = {
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
  disabled: boolean;
  onMove: (columnId: string) => void;
}

/**
 * WHAT: One task on the board.
 *
 * A "Move to" menu is how a task changes status for now. Drag-and-drop is
 * Phase 10; this uses a native `<select>` precisely because it already works
 * with a keyboard and a screen reader, and calls the same endpoint drag-and-
 * drop will. The select is CONTROLLED to always show the placeholder: after a
 * move the task simply appears in its new column.
 */
export function TaskCard({
  task,
  otherColumns,
  canMove,
  disabled,
  onMove,
}: TaskCardProps) {
  return (
    <li className="task">
      <p className="task-title">{task.title}</p>

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
