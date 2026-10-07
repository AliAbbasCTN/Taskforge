import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTaskList } from '../hooks/useTasks';
import type { TaskListParams } from '../services/api';
import { formatDueDate, isOverdue } from '../utils/format';
import type { TaskFilters } from '../utils/filters';
import { EmptyState, ErrorBox, Loading } from './Feedback';
import { LabelChip } from './LabelChip';
import { Pagination } from './Pagination';
import { PRIORITY_LABEL } from './TaskCard';

type SortBy = TaskListParams['sortBy'];

const PAGE_SIZE = 10;

const SORTABLE: { field: SortBy; label: string }[] = [
  { field: 'title', label: 'Title' },
  { field: 'priority', label: 'Priority' },
  { field: 'dueDate', label: 'Due' },
  { field: 'createdAt', label: 'Created' },
];

/**
 * WHAT: The same tasks as the board, as a sortable, paginated table.
 *
 * Where the board shows EVERYTHING (a kanban lane has to be whole to make
 * sense), the list fetches ONE PAGE at a time. Sorting, filtering and paging
 * all happen on the server: this component only sends the choices as query
 * parameters and shows the page that comes back.
 *
 * The page remounts (via `key`, set by the parent) whenever the filters
 * change, which resets the page number to 1 - otherwise narrowing the filter
 * while on page 4 could leave you on a page that no longer exists.
 */
export function TaskListView({
  orgId,
  projectId,
  boardId,
  filters,
}: {
  orgId: string;
  projectId: string;
  boardId: string;
  filters: TaskFilters;
}) {
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const tasks = useTaskList(orgId, projectId, boardId, {
    ...filters,
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortOrder,
  });

  function handleSort(field: SortBy) {
    if (field === sortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  if (tasks.isError) {
    return <ErrorBox error={tasks.error} onRetry={() => void tasks.refetch()} />;
  }
  if (!tasks.data) {
    return <Loading label="Loading tasks" />;
  }
  if (tasks.data.total === 0) {
    return (
      <EmptyState title="No tasks match.">
        Try clearing a filter, or add a task from the board view.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="task-table">
          <thead>
            <tr>
              {SORTABLE.map(({ field, label }) => (
                <th
                  key={field}
                  scope="col"
                  aria-sort={
                    sortBy === field
                      ? sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => handleSort(field)}
                  >
                    {label}
                    {sortBy === field && (sortOrder === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
              ))}
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col">Labels</th>
            </tr>
          </thead>
          <tbody>
            {tasks.data.items.map((task) => (
              <tr key={task.id}>
                <td>
                  <Link
                    to={{ pathname: `tasks/${task.id}`, search: location.search }}
                  >
                    {task.title}
                  </Link>
                </td>
                <td>
                  <span className={`priority priority-${task.priority.toLowerCase()}`}>
                    {PRIORITY_LABEL[task.priority]}
                  </span>
                </td>
                <td>
                  {task.dueDate ? (
                    <span className={isOverdue(task.dueDate) ? 'due-overdue' : ''}>
                      {formatDueDate(task.dueDate)}
                    </span>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </td>
                <td className="muted">
                  {new Date(task.createdAt).toLocaleDateString()}
                </td>
                <td>{task.column.name}</td>
                <td>{task.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
                <td>
                  <ul className="chips">
                    {task.labels.map((label) => (
                      <li key={label.id}>
                        <LabelChip label={label} />
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={tasks.data.page}
        totalPages={tasks.data.totalPages}
        total={tasks.data.total}
        onPageChange={setPage}
      />
    </>
  );
}
