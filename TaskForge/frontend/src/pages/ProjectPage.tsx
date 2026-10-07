import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, ErrorBox, FormError, Loading } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { LabelManager } from '../components/LabelManager';
import { useBoards, useCreateBoard } from '../hooks/useBoards';
import { useOrganization } from '../hooks/useOrganizations';
import {
  useProject,
  useProjectActions,
  useProjectMembers,
} from '../hooks/useProjects';
import { initialOf } from '../utils/format';
import { canManageProject } from '../utils/permissions';

/**
 * WHAT: One project - its details, its boards, and who is on it.
 *
 * WHAT YOU SEE depends on your role, via `canManageProject`. Remember that
 * is only about which buttons to show: a project member who somehow sent the
 * archive request anyway would get a 403 from the backend.
 */
export default function ProjectPage() {
  const { orgId = '', projectId = '' } = useParams();
  const navigate = useNavigate();
  const { organization } = useOrganization(orgId);
  const project = useProject(orgId, projectId);
  const boards = useBoards(orgId, projectId);
  const members = useProjectMembers(orgId, projectId);
  const createBoard = useCreateBoard(orgId, projectId);
  const { archive, unarchive, remove } = useProjectActions(orgId, projectId);
  const [boardName, setBoardName] = useState('');

  async function handleCreateBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const board = await createBoard.mutateAsync(boardName.trim());
      setBoardName('');
      navigate(`/orgs/${orgId}/projects/${projectId}/boards/${board.id}`);
    } catch {
      // Displayed from `createBoard.error` below.
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      'Delete this project permanently? Its boards and tasks will be deleted too. This cannot be undone.',
    );
    if (!confirmed) {
      return;
    }
    try {
      await remove.mutateAsync();
      navigate(`/orgs/${orgId}`, { replace: true });
    } catch {
      // Displayed from `remove.error` below.
    }
  }

  if (project.isError) {
    return (
      <ErrorBox error={project.error} onRetry={() => void project.refetch()} />
    );
  }
  if (!project.data) {
    return <Loading label="Loading project" />;
  }

  const data = project.data;
  const archived = data.status === 'ARCHIVED';
  const canManage = canManageProject(organization?.role, data.currentUserRole);
  const actionError = archive.error ?? unarchive.error ?? remove.error;

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={`/orgs/${orgId}`}>{organization?.name ?? 'Organization'}</Link>
      </nav>

      <header className="page-header">
        <div className="title-line">
          <h1>{data.name}</h1>
          {archived && <span className="tag tag-muted">Archived</span>}
        </div>
        {data.description && <p>{data.description}</p>}
        {canManage && (
          <div className="actions">
            {archived ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={unarchive.isPending}
                  onClick={() => unarchive.mutate()}
                >
                  Unarchive project
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={remove.isPending}
                  onClick={() => void handleDelete()}
                >
                  Delete permanently
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={archive.isPending}
                onClick={() => archive.mutate()}
              >
                Archive project
              </button>
            )}
          </div>
        )}
        <FormError error={actionError} />
      </header>

      {archived && (
        <p className="notice">
          This project is archived, so it is read-only. Unarchive it to make
          changes.
        </p>
      )}

      <section aria-labelledby="boards-heading">
        <h2 id="boards-heading">Boards</h2>
        {boards.isError && (
          <ErrorBox error={boards.error} onRetry={() => void boards.refetch()} />
        )}
        {boards.isPending && <Loading label="Loading boards" />}
        {boards.data?.length === 0 && (
          <EmptyState title="No boards yet.">
            {canManage && !archived
              ? 'Create the first board below to start tracking tasks.'
              : 'A project lead can create the first board.'}
          </EmptyState>
        )}
        {boards.data && boards.data.length > 0 && (
          <ul className="rows">
            {boards.data.map((board) => (
              <li key={board.id}>
                <Link
                  to={`/orgs/${orgId}/projects/${projectId}/boards/${board.id}`}
                  className="row"
                >
                  <span className="row-title">{board.name}</span>
                  <span className="muted">
                    {board._count.columns}{' '}
                    {board._count.columns === 1 ? 'column' : 'columns'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {canManage && !archived && (
          <form onSubmit={handleCreateBoard} className="inline-form panel">
            <FormField
              label="New board"
              required
              minLength={2}
              maxLength={150}
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createBoard.isPending}
            >
              {createBoard.isPending ? 'Creating…' : 'Create board'}
            </button>
          </form>
        )}
        <FormError error={createBoard.error} />
      </section>

      <LabelManager
        orgId={orgId}
        projectId={projectId}
        canManage={canManage && !archived}
      />

      <section aria-labelledby="members-heading">
        <h2 id="members-heading">People on this project</h2>
        {members.isError && <ErrorBox error={members.error} />}
        {members.isPending && <Loading label="Loading members" />}
        {members.data && (
          <ul className="rows">
            {members.data.map((member) => (
              <li key={member.membershipId} className="row row-static">
                <span className="avatar" aria-hidden="true">
                  {initialOf(member.user.name)}
                </span>
                <span className="row-main">
                  <span className="row-title">{member.user.name}</span>
                  <span className="row-sub">{member.user.email}</span>
                </span>
                <span className="tag">
                  {member.role === 'LEAD' ? 'Lead' : 'Member'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
