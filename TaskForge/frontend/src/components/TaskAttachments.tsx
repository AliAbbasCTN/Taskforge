import { useRef, useState, type ChangeEvent } from 'react';
import { useAttachmentActions, useAttachments } from '../hooks/useAttachments';
import type { Attachment } from '../types/api';
import {
  ATTACHMENT_ACCEPT,
  checkAttachmentFile,
  formatFileSize,
} from '../utils/attachments';
import { getErrorMessage } from '../utils/errors';
import { EmptyState, ErrorBox, FormError, Loading } from './Feedback';

interface TaskAttachmentsProps {
  orgId: string;
  projectId: string;
  boardId: string;
  taskId: string;
  currentUserId: string;
  /** May upload (false while the project is archived). */
  canWrite: boolean;
  /** May delete other people's files. A UI hint; the server decides. */
  canModerate: boolean;
}

/**
 * WHAT: The files attached to a task: list, upload, download, delete.
 *
 * Upload flow: the user picks a file -> we run quick client-side checks
 * (`checkAttachmentFile`: size and type, for instant feedback only) -> send it
 * as multipart/form-data -> the server re-validates everything, including the
 * file's real contents, and answers 201 or an error we display.
 *
 * Download flow: a protected file cannot be a plain link (a link cannot send
 * the Authorization header), so we fetch the bytes with the normal API client,
 * wrap them in a temporary `blob:` URL, click a hidden link to make the browser
 * save the file, then free the URL.
 *
 * File NAMES are rendered as plain text children, which React escapes, so a
 * name containing HTML is displayed literally and never runs.
 */
export function TaskAttachments({
  orgId,
  projectId,
  boardId,
  taskId,
  currentUserId,
  canWrite,
  canModerate,
}: TaskAttachmentsProps) {
  const attachments = useAttachments(orgId, projectId, boardId, taskId);
  const { upload, remove, download } = useAttachmentActions(
    orgId,
    projectId,
    boardId,
    taskId,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so choosing the same file again still fires `change`.
    event.target.value = '';
    setClientError(null);
    upload.reset();
    if (!file) {
      return;
    }
    const problem = checkAttachmentFile(file);
    if (problem) {
      setClientError(problem);
      return;
    }
    try {
      await upload.mutateAsync(file);
    } catch {
      // Shown from `upload.error`.
    }
  }

  async function handleDownload(attachment: Attachment) {
    setDownloadError(null);
    setDownloadingId(attachment.id);
    try {
      const blob = await download(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(getErrorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section aria-labelledby="attachments-heading" className="attachments">
      <h3 id="attachments-heading">Attachments</h3>

      {attachments.isError && (
        <ErrorBox
          error={attachments.error}
          onRetry={() => void attachments.refetch()}
        />
      )}
      {attachments.isPending && <Loading label="Loading attachments" />}
      {attachments.data?.length === 0 && (
        <EmptyState title="No attachments yet.">
          {canWrite ? 'Add a file below.' : undefined}
        </EmptyState>
      )}

      <ul className="attachment-list">
        {attachments.data?.map((attachment) => {
          const isMine = attachment.uploader?.id === currentUserId;
          return (
            <li key={attachment.id} className="attachment">
              <div className="attachment-info">
                <strong className="attachment-name">{attachment.fileName}</strong>
                <span className="muted">
                  {formatFileSize(attachment.sizeBytes)} ·{' '}
                  {attachment.uploader?.name ?? 'Former member'} ·{' '}
                  <time dateTime={attachment.createdAt}>
                    {new Date(attachment.createdAt).toLocaleDateString()}
                  </time>
                </span>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="link-button"
                  disabled={downloadingId === attachment.id}
                  onClick={() => void handleDownload(attachment)}
                >
                  {downloadingId === attachment.id ? 'Downloading…' : 'Download'}
                </button>
                {canWrite && (isMine || canModerate) && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete "${attachment.fileName}"?`)) {
                        remove.mutate(attachment.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {clientError && (
        <p role="alert" className="form-error">
          {clientError}
        </p>
      )}
      <FormError error={upload.error} />
      <FormError error={remove.error} />
      {downloadError && (
        <p role="alert" className="form-error">
          {downloadError}
        </p>
      )}

      {canWrite && (
        <div>
          <input
            ref={fileInput}
            id="attachment-file"
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="visually-hidden"
            onChange={(event) => void handleFileChosen(event)}
          />
          <button
            type="button"
            className="btn"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? 'Uploading…' : 'Add attachment'}
          </button>
        </div>
      )}
    </section>
  );
}
