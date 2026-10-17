import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ORPHAN_GRACE_PERIOD_MS, STORAGE_KEY_PREFIX } from './files.constants';
import { StorageService } from './storage/storage.service';

/** How many stored keys are checked against the database in one query. */
const BATCH_SIZE = 200;

/**
 * WHAT: Finds files in storage that no database row refers to, and deletes them.
 *
 * WHY orphans exist: a file's bytes and its `Attachment` row live in two
 * different systems (storage and PostgreSQL), and no transaction spans both.
 * So there are gaps:
 *   - Deleting a TASK (or column, board, project, organisation) deletes its
 *     Attachment rows through database cascades - the files stay behind.
 *   - A delete that removes the row but then fails to remove the file.
 *   - An upload that stored the file but crashed before inserting the row.
 * The alternative - making every one of those code paths find and delete files
 * itself - means every future "delete X" feature must remember to. A periodic
 * sweep fixes ALL gaps in one place, including ones nobody has thought of yet.
 * This is the same idea as Phase 12's notification purge: housekeeping done by
 * a scheduled background job (see `MaintenanceProcessor`).
 *
 * SAFETY:
 *   - Only keys under `attachments/` are ever considered.
 *   - A file must be older than the grace period (24h) before it can be an
 *     orphan. An in-progress upload writes the file first and the row a moment
 *     later, so "no row yet" is normal for a brand-new file.
 *   - Idempotent: running it twice is harmless, so the queue may retry it.
 *
 * Because a file is deleted only when the database has NO row for it, the worst
 * a bug here can do is fail to clean up - it can never delete a file that is
 * still attached to a task.
 */
@Injectable()
export class OrphanedFilesCleaner {
  private readonly logger = new Logger(OrphanedFilesCleaner.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  async sweep(
    now: Date = new Date(),
  ): Promise<{ scanned: number; deleted: number }> {
    const cutoff = now.getTime() - ORPHAN_GRACE_PERIOD_MS;
    let scanned = 0;
    let deleted = 0;
    let candidates: string[] = [];

    const flush = async () => {
      if (candidates.length === 0) {
        return;
      }
      const known = await this.prisma.attachment.findMany({
        where: { storageKey: { in: candidates } },
        select: { storageKey: true },
      });
      const knownKeys = new Set(known.map((row) => row.storageKey));
      for (const key of candidates) {
        if (!knownKeys.has(key)) {
          await this.storage.delete(key);
          deleted += 1;
        }
      }
      candidates = [];
    };

    for await (const object of this.storage.listKeys(STORAGE_KEY_PREFIX)) {
      scanned += 1;
      if (object.lastModified.getTime() > cutoff) {
        continue; // too new to judge
      }
      candidates.push(object.key);
      if (candidates.length >= BATCH_SIZE) {
        await flush();
      }
    }
    await flush();

    this.logger.log(
      `Orphan sweep finished: scanned ${scanned} stored file(s), deleted ${deleted}`,
    );
    return { scanned, deleted };
  }
}
