import { useState, type FormEvent } from 'react';
import { Link, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { BoardLane } from '../components/BoardLane';
import type { BoardOutletContext } from '../components/boardContext';
import { ErrorBox, FormError, Loading } from '../components/Feedback';
import { TaskFilterBar } from '../components/TaskFilters';
import { TaskListView } from '../components/TaskListView';
import { useBoard, useBoardActions } from '../hooks/useBoards';
import { useLabels } from '../hooks/useLabels';
import { useProjectRealtime } from '../hooks/useRealtime';
import { useOrganization } from '../hooks/useOrganizations';
import { useProject, useProjectMembers } from '../hooks/useProjects';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
  type TaskFilters,
} from '../utils/filters';
import { canManageProject, canWriteTasks } from '../utils/permissions';

/**
 * WHAT: The board screen - kanban lanes or a sortable list, with filters, and
 * the task detail panel opened on top via the nested route.
 *
 * STATE LIVES IN THE URL: the active filters and the view (`?view=list`) are
 * query parameters, read here with `useSearchParams`. That makes a filtered
 * board linkable and bookmarkable, and the back button undoes a filter.
 *
 * DATA FLOW: the board comes from ONE request. Adding a task refetches it;
 * MOVING a task updates the screen optimistically first (see
 * `useBoardActions`) and then reconciles with the server.
 *
 * WHY drag-and-drop is switched off while a filter is active: a drop position
 * is an index among ALL the cards in a column, but a filtered lane shows only
 * some of them. "Drop between the 2nd and 3rd visible card" no longer maps to
 * a real position, so the board would silently reorder the wrong thing. The
 * "Move to" menu (bottom of the column) still works.
 */
export default function BoardPage() {
  const { orgId = '', projectId = '', boardId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromSearchParams(searchParams);
  const view = searchParams.get('view') === 'list' ? 'list' : 'board';
  const filtered = hasActiveFilters(filters);

  // Join the project's live room: other people's changes refetch this board.
  useProjectRealtime(projectId);

  const board = useBoard(orgId, projectId, boardId, filters);
  const project = useProject(orgId, projectId);
  const members = useProjectMembers(orgId, projectId);
  const labels = useLabels(orgId, projectId);
  const { organization } = useOrganization(orgId);
  const { createColumn, createTask, moveTask } = useBoardActions(
    orgId,
    projectId,
    boardId,
    filters,
  );
  const [columnName, setColumnName] = useState('');

  function setFilters(next: TaskFilters) {
    setSearchParams(filtersToSearchParams(next, searchParams));
  }

  function setView(next: 'board' | 'list') {
    const params = new URLSearchParams(searchParams);
    if (next === 'list') {
      params.set('view', 'list');
    } else {
      params.delete('view');
    }
    setSearchParams(params);
  }

  async function handleAddColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createColumn.mutateAsync(columnName.trim());
      setColumnName('');
    } catch {
      // Displayed from `createColumn.error` below.
    }
  }

  if (board.isError) {
    return <ErrorBox error={board.error} onRetry={() => void board.refetch()} />;
  }
  if (project.isError) {
    return <ErrorBox error={project.error} />;
  }
  if (!board.data || !project.data) {
    return <Loading label="Loading board" />;
  }

  const { columns } = board.data;
  const archived = project.data.status === 'ARCHIVED';
  const role = project.data.currentUserRole;
  const canWrite = !archived && canWriteTasks(organization?.role, role);
  const canManage = !archived && canManageProject(organization?.role, role);
  const actionError =
    createTask.error ?? moveTask.error ?? createColumn.error ?? null;

  const outletContext: BoardOutletContext = {
    columns: columns.map((column) => ({ id: column.id, name: column.name })),
    canWrite,
    canModerate: !archived && canManageProject(organization?.role, role),
    archived,
    orgRole: organization?.role,
  };

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={`/orgs/${orgId}`}>{organization?.name ?? 'Organization'}</Link>
        <Link to={`/orgs/${orgId}/projects/${projectId}`}>
          {project.data.name}
        </Link>
      </nav>

      <header className="page-header">
        <h1>{board.data.name}</h1>
      </header>

      {archived && (
        <p className="notice">
          This project is archived, so the board is read-only.
        </p>
      )}

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          {(['board', 'list'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={view === option ? 'segment is-active' : 'segment'}
              onClick={() => setView(option)}
            >
              {option === 'board' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
        <TaskFilterBar
          filters={filters}
          onChange={setFilters}
          members={members.data ?? []}
          labels={labels.data ?? []}
        />
      </div>

      {filtered && view === 'board' && canWrite && (
        <p className="muted">
          Drag-and-drop is off while filters are on. Use each task's "Move to"
          menu, or clear the filters.
        </p>
      )}
      <FormError error={actionError} />

      {view === 'board' ? (
        <div className="board">
          {columns.map((column, index) => (
            <BoardLane
              key={column.id}
              column={column}
              stage={columns.length > 1 ? index / (columns.length - 1) : 0}
              allColumns={columns}
              canWrite={canWrite}
              canDrag={canWrite && !filtered}
              busy={moveTask.isPending}
              onAddTask={(columnId, title) =>
                createTask.mutateAsync({ columnId, title })
              }
              onMoveTask={(taskId, columnId, position) =>
                moveTask.mutate({ taskId, columnId, position })
              }
            />
          ))}

          {canManage && (
            <form onSubmit={handleAddColumn} className="lane lane-new">
              <label htmlFor="new-column">New column</label>
              <input
                id="new-column"
                required
                maxLength={100}
                value={columnName}
                onChange={(event) => setColumnName(event.target.value)}
              />
              <button
                type="submit"
                className="btn"
                disabled={createColumn.isPending}
              >
                Add column
              </button>
            </form>
          )}
        </div>
      ) : (
        <TaskListView
          // A new filter set starts again at page 1.
          key={JSON.stringify(filters)}
          orgId={orgId}
          projectId={projectId}
          boardId={boardId}
          filters={filters}
        />
      )}

      {/* The task panel (route `tasks/:taskId`) renders here, over the board. */}
      <Outlet context={outletContext} />
    </>
  );
}
