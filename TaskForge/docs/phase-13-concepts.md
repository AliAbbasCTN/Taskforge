# Phase 13 — File Uploads: Concepts

## The Problem: A File Is Someone Else's Data

Until now everything TaskForge stored was text we could validate field by field. A file is different: it is an opaque blob of bytes chosen by the user, **with a name and a type label that the user also chose**. Accepting files safely is mostly about *not believing* any of that.

Three questions drive the whole phase:

1. **What may we accept?** (validation)
2. **Where do the bytes live, and who can reach them?** (storage and authorization)
3. **How do we keep two separate systems — the file store and the database — consistent?** (cleanup)

## 1. What We Accept — Never Trust the Client

An upload arrives as `multipart/form-data`: a file name, a `Content-Type` header, and the bytes. The first two are just text written by the sender. Renaming `evil.html` to `holiday.png`, or sending `Content-Type: image/png` with a script inside, costs an attacker nothing.

So `file-validation.ts` applies independent checks:

| Check | Why |
|---|---|
| **Extension allow-list** (png, jpg, gif, webp, pdf, txt, csv, md, docx, xlsx, pptx) | An *allow*-list names only the safe types; a block-list must name every dangerous one and always misses some. SVG, HTML, JS, executables and archives are deliberately absent (SVG can carry scripts). |
| **Magic numbers** — the file's first bytes must match its extension | A PNG always starts `89 50 4E 47…`, a PDF with `%PDF-`. A renamed file fails. Text formats have no magic number, so we require valid UTF-8 with no NUL bytes. Office files are ZIP containers, so we check for the ZIP signature. |
| **Server-decided MIME type** | The type we store and serve comes from our table, never from the client's header. |
| **Size limit** (`UPLOAD_MAX_FILE_SIZE_MB`, default 10) | Enforced by Multer *while parsing*, so an oversized upload is cut off early with HTTP 413. |
| **Count limit** (20 per task) | Stops one task, or a script, from filling storage. |

**What this does not do:** scan for viruses, or prove a `.docx` is a well-formed Word file. Those need antivirus scanning and deep parsing — listed under future hardening below. This is why we also *serve files safely* (section 4).

### Safe file names
The name is chosen by the sender too: it can be `../../etc/passwd`, contain control characters, or be 5,000 characters long. `file-names.ts` strips any path, replaces control and reserved characters, trims dots and spaces, caps the length while keeping the extension, and repairs the UTF-8-read-as-Latin-1 mangling some parsers cause. The result is only a **display name** — it is never used to decide where a file is written.

## 2. Where the Bytes Live — Server-Generated Storage Keys

Each file is stored under a **storage key** the server generates:

```
attachments/<organizationId>/<projectId>/<taskId>/<random-uuid>.<ext>
```

Every part is an id the server looked up, a random UUID, or an extension already checked against the allow-list. There is **nothing for an attacker to influence**, which removes **path traversal** (a name like `../../server.js` written to disk) by construction. As defence in depth, the local driver also resolves every key and refuses any that would land outside the uploads folder (`resolveInside`). The random UUID makes keys unguessable and means two uploads called `report.pdf` never overwrite each other.

The database row (`Attachment`) stores the metadata — display name, MIME type, size, uploader, storage key. The API **never returns the storage key**: responses use an explicit `select`.

## 3. The Storage Abstraction — Local in Dev, S3 in Production

`StorageService` is an abstract class with four methods: `put`, `get`, `delete`, `listKeys`. Everything else in TaskForge depends on *that*, never on the file system or S3. This is the **Dependency Inversion** principle: high-level code (`AttachmentsService`) depends on an abstraction, and the concrete choice is made in one place (`createStorage`) from one environment variable, `STORAGE_DRIVER`. Tests substitute a fake; a future Azure or GCS backend is one new class.

| | `LocalStorageService` (dev) | `S3StorageService` (production) |
|---|---|---|
| Stores bytes | a folder on disk (`backend/uploads/`) | an S3 bucket |
| Survives a container being replaced? | **No** | Yes |
| Works with several server instances? | **No** (each has its own folder) | Yes (shared) |
| Writes atomically? | Temp file + rename | S3 `PutObject` is atomic |

**Why S3 for production:** durable (designed for eleven nines), shared by every instance, independent of any one container's life — the same "don't keep state in one process" idea as Phase 12's Redis. The factory logs a warning if you run local storage with `NODE_ENV=production`.

### S3 credentials: there are none in our code
The AWS SDK finds credentials itself ("default credential provider chain"): environment variables, a shared credentials file, or — best in production — an **IAM role** attached to the server, which needs no keys at all. TaskForge's `.env` therefore only names the bucket and region. Give that role *only* `s3:PutObject`, `GetObject`, `DeleteObject` and `ListBucket` on this one bucket (**least privilege**), and keep the bucket **private** (Block Public Access on).

`S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` exist so the same code runs against MinIO or LocalStack for testing without a real AWS account.

## 4. Who Can Reach a File — Downloads Go Through the API

A file is never fetched straight from storage by the browser. The `download` route runs the same guard chain as every other task route (JWT → organization membership → project access → board), then streams the bytes. Consequences:

- Permission is checked **on every download**. A leaked URL is useless to an outsider (they get 404, exactly like a nonexistent id — Phase 4).
- An attachment is only reachable through **its own task**: the lookup is scoped by attachment id *and* task *and* board, so using a task you can see to reach a file on a task you can't is a 404.

The response is also hardened, because uploaded content is untrusted:

- `Content-Disposition: attachment` — the browser *saves* the file instead of displaying it inside TaskForge's own origin;
- `X-Content-Type-Options: nosniff` — the browser must trust our stated type;
- `Content-Security-Policy: default-src 'none'; sandbox` — even if something were rendered, it could run nothing;
- `Cache-Control: private, no-store`.

**Guards run before interceptors in NestJS**, so authentication, membership and the write permission are all checked *before* the multipart body is parsed — an outsider cannot make the server buffer a 10 MB upload.

**Trade-off — pre-signed URLs.** At scale, streaming every file through the API costs server bandwidth. The alternative is to authorize in the API and then hand the client a short-lived, pre-signed S3 URL to download directly. It is a good optimization once needed; streaming is simpler, keeps authorization in one place, and is right for this phase.

**Permissions:** anyone who can see the project may list and download. Uploading and deleting need `project:tasks:write` on a non-archived project. You may delete your own uploads; a project lead, or an organization admin/manager, may delete anyone's — the same rule as comments.

## 5. Two Systems, No Shared Transaction — Consistency and Cleanup

A file's bytes (storage) and its row (PostgreSQL) cannot be saved in one atomic transaction. Whichever you do first, a crash between the two leaves a mismatch. This is the same *dual-write problem* as Phase 12's job queue, and the answer is again to choose **which failure is harmless**:

- **Upload:** bytes first, row second. If the row can't be written, the bytes are removed again. The reverse order could leave a *row pointing at nothing* — a broken attachment users can see. A crash in the gap leaves only an invisible *orphan file*.
- **Delete:** row first, bytes second. The attachment disappears immediately and can never dangle; a failure removing the bytes only leaves an orphan.

Orphans also appear when a **task, column, board or project is deleted**: database cascades remove the rows, but nobody tells the file store. Making every future "delete X" feature remember to delete files is fragile, so instead a **scheduled background job** — `sweep-orphaned-files`, nightly at 03:30 in Phase 12's maintenance queue — lists stored files and deletes those no row refers to. Safety rules:

- only keys under `attachments/` are considered;
- a file must be **older than 24 hours** to be an orphan (an in-flight upload writes the file a moment before its row, so "no row yet" is normal for a new file);
- a file is deleted only when the database has **no row** for it, so a bug can fail to clean up but can never delete a file still attached to a task;
- it is **idempotent**, like every maintenance job, so retries are harmless.

## The Frontend

`TaskAttachments` sits in the task detail panel: list, upload, download, delete.

- **Upload** uses `FormData`. The HTTP client deliberately sets *no* `Content-Type`, so the browser can add the `multipart/form-data; boundary=…` header itself; setting it by hand would break the upload.
- **Download:** a plain link cannot send the `Authorization` header, so the app fetches the bytes with the normal API client, wraps them in a temporary `blob:` URL, and clicks a hidden link to save them.
- **Client-side checks** (size, extension) give instant feedback only. The server re-validates everything and is the sole authority.
- File names are rendered as React text children, which are escaped — a name containing HTML shows literally.
- Real-time: attachment changes publish a `project:changed` event (`resource: attachments`), so everyone viewing the task sees new files appear.

## New Environment Variables

All optional. See `backend/.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_DIR` | `uploads` | local driver: folder (relative to `backend/`) |
| `UPLOAD_MAX_FILE_SIZE_MB` | `10` | per-file limit, 1–100 |
| `S3_BUCKET`, `S3_REGION` | — | required when `STORAGE_DRIVER=s3` (startup fails otherwise) |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | — | S3-compatible services only |

## Known Limitations and Future Hardening

- **No virus scanning.** A production system handling untrusted files would scan uploads (e.g. ClamAV) before accepting them.
- **Office files are checked only as ZIP containers**, not parsed as real documents.
- **The 20-file limit is checked, then the row inserted**, so two truly simultaneous uploads could briefly exceed it by one. For a soft safety limit that is acceptable.
- **Uploads are buffered in memory** (capped by the size limit) so their bytes can be inspected before being kept. Very large files would need streaming validation.
- **Storage is not part of `/health`** yet; it can be added with the other production-readiness checks in Phase 20.

## Where to Look

| Concern | File |
|---|---|
| Validation rules | `backend/src/files/file-validation.ts` |
| Safe names, download header | `backend/src/files/file-names.ts` |
| Storage keys, path-traversal guard | `backend/src/files/storage/storage-key.ts` |
| The storage contract | `backend/src/files/storage/storage.service.ts` |
| Local / S3 backends | `backend/src/files/storage/local-storage.service.ts`, `s3-storage.service.ts` |
| Choosing the backend | `backend/src/files/storage/storage.factory.ts` |
| Orphan cleanup | `backend/src/files/orphaned-files.cleaner.ts` |
| Routes and business rules | `backend/src/attachments/` |
| UI | `frontend/src/components/TaskAttachments.tsx` |
