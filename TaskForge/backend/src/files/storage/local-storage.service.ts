import { randomUUID } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import {
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import {
  StorageObjectNotFoundError,
  StorageService,
  StoredObjectInfo,
} from './storage.service';
import { resolveInside } from './storage-key';

const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/**
 * WHAT: Stores files in a folder on the server's disk. The DEVELOPMENT backend
 * (STORAGE_DRIVER=local, the default).
 *
 * Not suitable for production on its own: a container's disk disappears when
 * the container is replaced, and two server instances would each have their
 * own private folder. That is exactly the problem S3 solves - see
 * `S3StorageService` and docs/phase-13-concepts.md.
 *
 * Every key is resolved through `resolveInside`, so it can never point outside
 * the root folder.
 */
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(rootDir: string) {
    super();
    this.root = resolve(rootDir);
  }

  // The content type matters to S3 (it is stored with the object) but not to a
  // plain file on disk, so this backend accepts it for interface compatibility
  // and ignores it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const target = resolveInside(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    // Write to a temporary name, then rename. A rename within one folder is
    // atomic, so a reader (or a crash) can never observe a half-written file.
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<Readable> {
    const target = resolveInside(this.root, key);
    try {
      const info = await stat(target);
      if (!info.isFile()) {
        throw new StorageObjectNotFoundError(key);
      }
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    const target = resolveInside(this.root, key);
    try {
      await unlink(target);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  async *listKeys(prefix: string): AsyncIterable<StoredObjectInfo> {
    // Walk the folder tree iteratively (an explicit stack, not recursion, so a
    // very deep tree cannot overflow the call stack).
    const stack: string[] = [this.root];
    while (stack.length > 0) {
      const directory = stack.pop() as string;
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isNotFound(error)) {
          continue; // the uploads folder does not exist yet: nothing stored
        }
        throw error;
      }
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          const key = fullPath
            .slice(this.root.length + 1)
            .split('\\')
            .join('/');
          if (key.startsWith(prefix)) {
            const info = await stat(fullPath);
            yield { key, lastModified: info.mtime };
          }
        }
      }
    }
  }
}
