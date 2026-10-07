import { useState, type FormEvent } from 'react';
import { useCommentActions, useComments } from '../hooks/useComments';
import type { Comment } from '../types/api';
import { EmptyState, ErrorBox, FormError, Loading } from './Feedback';

interface TaskCommentsProps {
  orgId: string;
  projectId: string;
  boardId: string;
  taskId: string;
  currentUserId: string;
  /** May post and edit comments (false while the project is archived). */
  canWrite: boolean;
  /** May delete other people's comments. A UI hint; the server decides. */
  canModerate: boolean;
}

/**
 * WHAT: The discussion under a task: list, add, edit your own, delete.
 *
 * Comment text is rendered as a plain React text child, which React escapes -
 * a comment containing `<script>` shows up as those literal characters and
 * never runs. (This is also why nothing here ever uses
 * `dangerouslySetInnerHTML`.)
 *
 * The edit/delete buttons you see mirror the server's rules - edit only your
 * own, delete your own or moderate - but they are hints. The server answers
 * 403 to anyone who sends the request anyway.
 */
export function TaskComments({
  orgId,
  projectId,
  boardId,
  taskId,
  currentUserId,
  canWrite,
  canModerate,
}: TaskCommentsProps) {
  const comments = useComments(orgId, projectId, boardId, taskId);
  const { create, update, remove } = useCommentActions(
    orgId,
    projectId,
    boardId,
    taskId,
  );
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await create.mutateAsync(draft.trim());
      setDraft('');
    } catch {
      // Shown from `create.error`; the draft is kept for a retry.
    }
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>, comment: Comment) {
    event.preventDefault();
    try {
      await update.mutateAsync({ commentId: comment.id, body: editDraft.trim() });
      setEditingId(null);
    } catch {
      // Shown from `update.error`.
    }
  }

  function startEditing(comment: Comment) {
    setEditingId(comment.id);
    setEditDraft(comment.body);
  }

  return (
    <section aria-labelledby="comments-heading" className="comments">
      <h3 id="comments-heading">Comments</h3>

      {comments.isError && (
        <ErrorBox error={comments.error} onRetry={() => void comments.refetch()} />
      )}
      {comments.isPending && <Loading label="Loading comments" />}
      {comments.data?.length === 0 && (
        <EmptyState title="No comments yet.">
          {canWrite ? 'Start the conversation below.' : undefined}
        </EmptyState>
      )}

      <ul className="comment-list">
        {comments.data?.map((comment) => {
          const isMine = comment.author?.id === currentUserId;
          return (
            <li key={comment.id} className="comment">
              <div className="comment-head">
                <strong>{comment.author?.name ?? 'Former member'}</strong>
                <time dateTime={comment.createdAt} className="muted">
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
                {comment.editedAt && <span className="muted">(edited)</span>}
              </div>

              {editingId === comment.id ? (
                <form
                  onSubmit={(event) => void handleSaveEdit(event, comment)}
                  className="stack"
                >
                  <label className="visually-hidden" htmlFor={`edit-${comment.id}`}>
                    Edit comment
                  </label>
                  <textarea
                    id={`edit-${comment.id}`}
                    rows={3}
                    maxLength={5000}
                    required
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                  />
                  <FormError error={update.error} />
                  <div className="actions">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={update.isPending || !editDraft.trim()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="comment-body">{comment.body}</p>
                  {canWrite && (isMine || canModerate) && (
                    <div className="actions">
                      {isMine && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => startEditing(comment)}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm('Delete this comment?')) {
                            remove.mutate(comment.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <FormError error={remove.error} />

      {canWrite && (
        <form onSubmit={handleCreate} className="stack comment-form">
          <label htmlFor="new-comment">Add a comment</label>
          <textarea
            id="new-comment"
            rows={3}
            maxLength={5000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <FormError error={create.error} />
          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={create.isPending || !draft.trim()}
            >
              {create.isPending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
