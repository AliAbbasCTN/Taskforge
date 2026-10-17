/**
 * WHAT: Decides whether an uploaded file is one TaskForge is willing to store,
 * and what it really is.
 *
 * WHY we do not trust what the client says: an upload arrives with a file NAME
 * and a Content-Type header, and both are written by the sender. Someone can
 * rename `malware.html` to `holiday.png`, or send `Content-Type: image/png`
 * with a script inside. Trusting either would let an attacker store and later
 * serve content of their choosing. So we apply three independent checks:
 *
 *   1. The EXTENSION must be on an allow-list (not a block-list: a block-list
 *      has to name every dangerous type, an allow-list only the safe ones).
 *   2. The file's first bytes - its "magic number" - must match that
 *      extension's real format. A `.png` must begin with the PNG signature.
 *   3. The MIME type we store and later serve is OURS, taken from the
 *      allow-list table, never the client's header.
 *
 * Text formats (txt, csv, md) have no magic number, so for them we check the
 * content is valid UTF-8 with no NUL bytes - which is what separates text from
 * a disguised binary.
 *
 * What this does NOT do: scan for viruses, or prove a `.docx` is a well-formed
 * Word document (we only verify it is a ZIP container, which is what Office
 * files are). Those need antivirus/deep parsing and are called out as future
 * hardening in docs/phase-13-concepts.md. This is also why files are always
 * served as downloads, never rendered by the browser - see the download route.
 *
 * Deliberately NOT allowed: SVG (an image format that can contain scripts),
 * HTML/JS, executables and archives.
 *
 * Pure functions, no NestJS - which makes them trivial to test exhaustively.
 */

export interface AllowedFileType {
  /** The MIME type TaskForge stores and serves for this extension. */
  mimeType: string;
  /** How to confirm the bytes really are this format. */
  check: (data: Buffer) => boolean;
}

const startsWith = (data: Buffer, bytes: number[], offset = 0): boolean =>
  data.length >= offset + bytes.length &&
  bytes.every((byte, index) => data[offset + index] === byte);

const ascii = (text: string): number[] =>
  Array.from(text).map((char) => char.charCodeAt(0));

const isPng = (data: Buffer) =>
  startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = (data: Buffer) => startsWith(data, [0xff, 0xd8, 0xff]);
const isGif = (data: Buffer) =>
  startsWith(data, ascii('GIF87a')) || startsWith(data, ascii('GIF89a'));
// WebP is a RIFF container: "RIFF" + 4 size bytes + "WEBP".
const isWebp = (data: Buffer) =>
  startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8);
const isPdf = (data: Buffer) => startsWith(data, ascii('%PDF-'));
// Word/Excel/PowerPoint "Open XML" files are ZIP archives: "PK\x03\x04".
const isZipContainer = (data: Buffer) =>
  startsWith(data, [0x50, 0x4b, 0x03, 0x04]);

/**
 * True if `data` looks like human-readable UTF-8 text: valid UTF-8 and no NUL
 * bytes (NUL essentially never appears in real text but is everywhere in
 * binaries).
 */
export function isPlainText(data: Buffer): boolean {
  if (data.includes(0)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

/** The allow-list: lower-case extension (no dot) -> what it must be. */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, AllowedFileType>> = {
  png: { mimeType: 'image/png', check: isPng },
  jpg: { mimeType: 'image/jpeg', check: isJpeg },
  jpeg: { mimeType: 'image/jpeg', check: isJpeg },
  gif: { mimeType: 'image/gif', check: isGif },
  webp: { mimeType: 'image/webp', check: isWebp },
  pdf: { mimeType: 'application/pdf', check: isPdf },
  txt: { mimeType: 'text/plain', check: isPlainText },
  csv: { mimeType: 'text/csv', check: isPlainText },
  md: { mimeType: 'text/markdown', check: isPlainText },
  docx: {
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    check: isZipContainer,
  },
  xlsx: {
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    check: isZipContainer,
  },
  pptx: {
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    check: isZipContainer,
  },
};

/** The extensions TaskForge accepts, for error messages and the UI hint. */
export const ALLOWED_EXTENSIONS: readonly string[] =
  Object.keys(ALLOWED_FILE_TYPES);

export type FileValidationResult =
  | { ok: true; extension: string; mimeType: string }
  | { ok: false; reason: string };

/**
 * The lower-case extension of a file name (no dot), or '' if it has none.
 * "report.final.PDF" -> "pdf"; ".bashrc" and "README" -> ''.
 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return '';
  }
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Validates an uploaded file's name and bytes together. Never throws: it
 * returns a result the caller turns into an HTTP error.
 */
export function validateFile(
  fileName: string,
  data: Buffer,
): FileValidationResult {
  if (data.length === 0) {
    return { ok: false, reason: 'The file is empty' };
  }

  const extension = extensionOf(fileName);
  const type = Object.prototype.hasOwnProperty.call(
    ALLOWED_FILE_TYPES,
    extension,
  )
    ? ALLOWED_FILE_TYPES[extension]
    : undefined;

  if (!type) {
    return {
      ok: false,
      reason: `Files of this type are not allowed. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  if (!type.check(data)) {
    return {
      ok: false,
      reason: `The file's contents do not match its .${extension} extension`,
    };
  }

  return { ok: true, extension, mimeType: type.mimeType };
}
