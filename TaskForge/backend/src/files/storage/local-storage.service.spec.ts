import { mkdtemp, readFile, rm, writeFile, utimes, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageService } from './local-storage.service';
import { StorageObjectNotFoundError } from './storage.service';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe('LocalStorageService', () => {
  let dir: string;
  let storage: LocalStorageService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taskforge-storage-'));
    storage = new LocalStorageService(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores bytes and reads them back, creating folders as needed', async () => {
    await storage.put('attachments/o/p/t/file.txt', Buffer.from('hello'), 'text/plain');
    const stream = await storage.get('attachments/o/p/t/file.txt');
    expect((await readAll(stream)).toString()).toBe('hello');
  });

  it('replaces an existing object and leaves no temporary files behind', async () => {
    await storage.put('attachments/a.txt', Buffer.from('one'), 'text/plain');
    await storage.put('attachments/a.txt', Buffer.from('two'), 'text/plain');
    expect((await readAll(await storage.get('attachments/a.txt'))).toString()).toBe('two');

    const keys: string[] = [];
    for await (const object of storage.listKeys('')) {
      keys.push(object.key);
    }
    expect(keys).toEqual(['attachments/a.txt']);
  });

  it('throws StorageObjectNotFoundError for a missing key', async () => {
    await expect(storage.get('attachments/missing.txt')).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('treats deleting a missing object as success', async () => {
    await expect(storage.delete('attachments/missing.txt')).resolves.toBeUndefined();
  });

  it('deletes an object', async () => {
    await storage.put('attachments/a.txt', Buffer.from('x'), 'text/plain');
    await storage.delete('attachments/a.txt');
    await expect(storage.get('attachments/a.txt')).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('refuses keys that escape the storage folder', async () => {
    await expect(
      storage.put('../escape.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('Invalid storage key');
    await expect(storage.get('../../etc/passwd')).rejects.toThrow('Invalid storage key');
    await expect(storage.delete('/etc/passwd')).rejects.toThrow('Invalid storage key');
  });

  it('lists keys under a prefix with their modification time; an empty store lists nothing', async () => {
    const none: string[] = [];
    for await (const object of storage.listKeys('attachments/')) {
      none.push(object.key);
    }
    expect(none).toEqual([]);

    await storage.put('attachments/o/a.txt', Buffer.from('a'), 'text/plain');
    await mkdir(join(dir, 'other'), { recursive: true });
    await writeFile(join(dir, 'other', 'b.txt'), 'b');
    const old = new Date('2020-01-01T00:00:00Z');
    await utimes(join(dir, 'attachments/o/a.txt'), old, old);

    const found: { key: string; lastModified: Date }[] = [];
    for await (const object of storage.listKeys('attachments/')) {
      found.push(object);
    }
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe('attachments/o/a.txt');
    expect(found[0].lastModified.toISOString()).toBe(old.toISOString());
    expect((await readFile(join(dir, 'other', 'b.txt'))).toString()).toBe('b');
  });
});
