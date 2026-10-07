import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLabels } from '../hooks/useLabels';
import { useProjectMembers } from '../hooks/useProjects';
import { useTask, useTaskActions } from '../hooks/useTasks';
import type { Task, TaskPriority } from '../types/api';
import { PRIORITIES } from '../utils/filters';
import type { BoardOutletContext } from './boardContext';
import { ErrorBox, FormError, Loading } from './Feedback';
import { FormField } from './FormField';
import { LabelChip } from './LabelChip';
import { PRIORITY_LABEL } from './TaskCard';
import { TaskComments } from './TaskComments';

/**
 * WHAT: The task detail panel - a modal dialog opened by the nested route
 * `.../boards/:boardId/tasks/:taskId`, drawn on top of the board.
 *
 * WHY a ROUTE and not just local state: the open task is in the URL, so it can
 * be linked to, survives a reload, and the back button closes it.
 *
 * WHY the native `<dialog>` element: `showModal()` gives, for free, what is
 * painful to build by hand - focus moves into the dialog and is trapped there,
 * Escape closes it, and the page behind becomes inert for assistive
 * technology.
 */
export function TaskDetailPanel() {
  const { orgId = '', projectId = '', boardId = '', taskId = '' } = useParams();
  const context = useOutletContext<BoardOutletContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const task = useTask(orgId, projectId, boardId, taskId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  // Back to the board, keeping the filters/view in the query string.
  function close() {
    navigate({
      pathname: `/orgs/${orgId}/projects/${projectId}/boards/${boardId}`,
      search: location.search,
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="panel-dialog"
      aria-labelledby="task-panel-title"
      onClose={close} // fires on Escape
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === dialogRef.current) {
          close();
        }
      }}
    >
      <div className="panel-top">
        <h2 id="task-panel-title">Task</h2>
        <button type="button" className="btn btn-quiet" onClick={close}>
          Close
        </button>
      </div>

      {task.isError && (
        <ErrorBox error={task.error} onRetry={() => void task.refetch()} />
      )}
      {!task.data && !task.isError && <Loading label="Loading task" />}
      {task.data && (
        <TaskDetails
          // Re-mount the form whenever the saved task changes, so its fields
          // always start from what the server last returned.
          key={task.data.updatedAt}
          task={task.data}
          orgId={orgId}
          projectId={projectId}
          boardId={boardId}
          context={context}
          onDeleted={close}
        />
      )}
    </dialog>
  );
}

interface TaskDetailsProps {
  task: Task;
  orgId: string;
  projectId: string;
  boardId: string;
  context: BoardOutletContext;
  onDeleted: () => void;
}

function TaskDetails({
  task,
  orgId,
  projectId,
  boardId,
  context,
  onDeleted,
}: TaskDetailsProps) {
  const { user } = useAuth();
  const { canWrite, canModerate, columns } = context;
  const members = useProjectMembers(orgId, projectId);
  const labels = useLabels(orgId, projectId);
  const { update, setLabels, move, remove } = useTaskActions(
    orgId,
    projectId,
    boardId,
    task.id,
  );

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  // <input type="date"> speaks "YYYY-MM-DD"; the API date is a full ISO string.
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? '');
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '');

  const attachedIds = new Set(task.labels.map((label) => label.id));

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate({
      title: title.trim(),
      description: description.trim() === '' ? null : description.trim(),
      priority,
      dueDate: dueDate === '' ? null : dueDate,
      assigneeId: assigneeId === '' ? null : assigneeId,
    });
  }

  function toggleLabel(labelId: string, checked: boolean) {
    const next = new Set(attachedIds);
    if (checked) {
      next.add(labelId);
    } else {
      next.delete(labelId);
    }
    setLabels.mutate([...next]);
  }

  async function handleDelete() {
    if (!window.confirm('Delete this task permanently?')) {
      return;
    }
    try {
      await remove.mutateAsync();
      onDeleted();
    } catch {
      // Shown from `remove.error`.
    }
  }

  const actionError =
    update.error ?? setLabels.error ?? move.error ?? remove.error ?? null;

  return (
    <>
      <form onSubmit={handleSave} className="stack panel-form">
        <FormField
          label="Title"
          required
          maxLength={200}
          disabled={!canWrite}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="field">
          <label htmlFor="task-description">Description</label>
          <textarea
            id="task-description"
            rows={4}
            maxLength={5000}
            disabled={!canWrite}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="task-priority">Priority</label>
            <select
              id="task-priority"
              disabled={!canWrite}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>
          </div>

          <FormField
            label="Due date"
            type="date"
            disabled={!canWrite}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="task-assignee">Assignee</label>
          <select
            id="task-assignee"
            disabled={!canWrite}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.data?.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.name}
              </option>
            ))}
          </select>
        </div>

        {canWrite && (
          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={update.isPending || !title.trim()}
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </form>

      {/* Status and labels apply immediately, so they sit outside the form. */}
      <div className="field">
        <label htmlFor="task-status">Status</label>
        <select
          id="task-status"
          disabled={!canWrite || move.isPending}
          value={task.columnId}
          onChange={(e) => move.mutate(e.target.value)}
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="label-picker">
        <legend>Labels</legend>
        {labels.data?.length === 0 && (
          <p className="muted">
            This project has no labels yet. A project lead can add them on the
            project page.
          </p>
        )}
        <ul className="label-options">
          {labels.data?.map((label) => (
            <li key={label.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={attachedIds.has(label.id)}
                  disabled={!canWrite || setLabels.isPending}
                  onChange={(e) => toggleLabel(label.id, e.target.checked)}
                />
                <LabelChip label={label} />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <FormError error={actionError} />

      <TaskComments
        orgId={orgId}
        projectId={projectId}
        boardId={boardId}
        taskId={task.id}
        currentUserId={user?.id ?? ''}
        canWrite={canWrite}
        canModerate={canModerate}
      />

      {canWrite && (
        <div className="danger-zone">
          <button
            type="button"
            className="btn btn-danger"
            disabled={remove.isPending}
            onClick={() => void handleDelete()}
          >
            Delete task
          </button>
        </div>
      )}
    </>
  );
}
