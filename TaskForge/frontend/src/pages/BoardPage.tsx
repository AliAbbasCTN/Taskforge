import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BoardLane } from '../components/BoardLane';
import { ErrorBox, FormError, Loading } from '../components/Feedback';
import { useBoard, useBoardActions } from '../hooks/useBoards';
import { useOrganization } from '../hooks/useOrganizations';
import { useProject } from '../hooks/useProjects';
import { canManageProject, canWriteTasks } from '../utils/permissions';

/**
 * WHAT: The kanban board - columns side by side, tasks inside them.
 *
 * DATA FLOW (worth tracing once): the board comes from ONE request
 * (`GET .../boards/:boardId`) that already contains columns -> tasks ->
 * assignees. When you add or move a task, the mutation succeeds, its
 * `onSuccess` invalidates this board's cache entry, TanStack Query refetches,
 * and React re-renders from the server's answer. The client never edits its
 * own copy of the board, so it can't drift from the truth - including the
 * position numbers the server renumbers on every move.
 *
 * The project is fetched too, only to know (a) is it archived (then the
 * whole board is read-only) and (b) what the current user's role is.
 */
export default function BoardPage() {
  const { orgId = '', projectId = '', boardId = '' } = useParams();
  const board = useBoard(orgId, projectId, boardId);
  const project = useProject(orgId, projectId);
  const { organization } = useOrganization(orgId);
  const { createColumn, createTask, moveTask } = useBoardActions(
    orgId,
    projectId,
    boardId,
  );
  const [columnName, setColumnName] = useState('');

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
      <FormError error={actionError} />

      <div className="board">
        {columns.map((column, index) => (
          <BoardLane
            key={column.id}
            column={column}
            stage={columns.length > 1 ? index / (columns.length - 1) : 0}
            allColumns={columns}
            canWrite={canWrite}
            busy={moveTask.isPending}
            onAddTask={(columnId, title) =>
              createTask.mutateAsync({ columnId, title })
            }
            onMoveTask={(taskId, columnId) =>
              moveTask.mutate({ taskId, columnId })
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
    </>
  );
}
