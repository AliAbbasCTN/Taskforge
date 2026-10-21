import { PrismaService } from '../database/prisma.service';
import { OrphanedFilesCleaner } from './orphaned-files.cleaner';
import { StorageService, StoredObjectInfo } from './storage/storage.service';

const NOW = new Date('2026-10-16T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600 * 1000);

function build(objects: StoredObjectInfo[], knownKeys: string[]) {
  const deleted: string[] = [];
  const storage = {
    async *listKeys() {
      for (const object of objects) {
        yield object;
      }
    },
    delete: async (key: string) => {
      deleted.push(key);
    },
  };
  const queries: string[][] = [];
  const prisma = {
    attachment: {
      findMany: async ({ where }: { where: { storageKey: { in: string[] } } }) => {
        queries.push(where.storageKey.in);
        return where.storageKey.in
          .filter((key) => knownKeys.includes(key))
          .map((storageKey) => ({ storageKey }));
      },
    },
  };
  const cleaner = new OrphanedFilesCleaner(
    storage as unknown as StorageService,
    prisma as unknown as PrismaService,
  );
  return { cleaner, deleted, queries };
}

describe('OrphanedFilesCleaner', () => {
  it('deletes old files with no database row, and keeps referenced ones', async () => {
    const { cleaner, deleted } = build(
      [
        { key: 'attachments/kept.png', lastModified: hoursAgo(72) },
        { key: 'attachments/orphan.png', lastModified: hoursAgo(72) },
      ],
      ['attachments/kept.png'],
    );

    const result = await cleaner.sweep(NOW);

    expect(result).toEqual({ scanned: 2, deleted: 1 });
    expect(deleted).toEqual(['attachments/orphan.png']);
  });

  it('never touches a file younger than the grace period (an upload may be in progress)', async () => {
    const { cleaner, deleted, queries } = build(
      [{ key: 'attachments/new.png', lastModified: hoursAgo(1) }],
      [],
    );

    const result = await cleaner.sweep(NOW);

    expect(result).toEqual({ scanned: 1, deleted: 0 });
    expect(deleted).toEqual([]);
    expect(queries).toEqual([]);
  });

  it('checks the database in batches', async () => {
    const objects = Array.from({ length: 450 }, (_, i) => ({
      key: `attachments/f${i}.png`,
      lastModified: hoursAgo(48),
    }));
    const { cleaner, deleted, queries } = build(objects, []);

    const result = await cleaner.sweep(NOW);

    expect(result).toEqual({ scanned: 450, deleted: 450 });
    expect(queries.map((q) => q.length)).toEqual([200, 200, 50]);
    expect(deleted).toHaveLength(450);
  });

  it('does nothing when storage is empty', async () => {
    const { cleaner } = build([], []);
    expect(await cleaner.sweep(NOW)).toEqual({ scanned: 0, deleted: 0 });
  });
});
