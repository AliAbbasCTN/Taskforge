/** Where in the storage backend TaskForge keeps task attachments. */
export const STORAGE_KEY_PREFIX = 'attachments/';

/** The default per-file size limit, used when UPLOAD_MAX_FILE_SIZE_MB is unset. */
export const DEFAULT_MAX_FILE_SIZE_MB = 10;

/** A task can carry at most this many attachments - a guard against one task
 * (or a script) filling the storage. */
export const MAX_ATTACHMENTS_PER_TASK = 20;

/** The longest display name we store. Matches the VARCHAR(255) column with room
 * to spare, and keeps the UI sane. */
export const MAX_FILE_NAME_LENGTH = 100;

/**
 * A stored file with no database row is only treated as an ORPHAN (and
 * deleted by the nightly sweep) once it is older than this. The grace period
 * is what makes the sweep safe: an upload writes the file first and the row a
 * moment later, so a brand-new file with no row is just "in progress", not
 * garbage.
 */
export const ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
