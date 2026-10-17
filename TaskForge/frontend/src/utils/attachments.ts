/**
 * Client-side pre-checks for attachments, and display helpers.
 *
 * These exist for SPEED AND KINDNESS, not security: they let the user learn
 * "that file is too big / not allowed" instantly instead of after uploading
 * 10 MB. The server re-checks everything (size, type AND the file's real
 * contents) and is the only authority - anyone can bypass this code. The
 * numbers mirror the backend defaults (backend/src/files); if the server's
 * UPLOAD_MAX_FILE_SIZE_MB is changed, a too-large file is simply rejected by
 * the server with a clear message, which the UI shows.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Mirrors ALLOWED_FILE_TYPES on the server. */
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'csv',
  'md',
  'docx',
  'xlsx',
  'pptx',
] as const;

/** Value for `<input type="file" accept>`: ".png,.jpg,...". */
export const ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(',');

/** "2.4 MB", "340 KB", "12 B". Uses 1024-based units, like most file managers. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Returns a message if the file should not even be sent, or null if it looks fine. */
export function checkAttachmentFile(file: {
  name: string;
  size: number;
}): string | null {
  if (file.size === 0) {
    return 'That file is empty.';
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `That file is too large. The limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`;
  }
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (
    !(ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)
  ) {
    return `Files of this type are not allowed. Allowed types: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}.`;
  }
  return null;
}
