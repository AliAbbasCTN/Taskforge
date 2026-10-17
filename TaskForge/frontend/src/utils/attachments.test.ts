import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  checkAttachmentFile,
  formatFileSize,
} from './attachments';

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [340 * 1024, '340 KB'],
    [1024 * 1024, '1.0 MB'],
    [2.4 * 1024 * 1024, '2.4 MB'],
    [10 * 1024 * 1024, '10 MB'],
  ])('%s bytes -> %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('checkAttachmentFile', () => {
  it('accepts an allowed file within the limit, whatever the extension case', () => {
    expect(checkAttachmentFile({ name: 'shot.PNG', size: 1000 })).toBeNull();
    expect(
      checkAttachmentFile({ name: 'a.pdf', size: MAX_ATTACHMENT_BYTES }),
    ).toBeNull();
  });

  it('rejects empty, oversized and disallowed files with a reason', () => {
    expect(checkAttachmentFile({ name: 'a.png', size: 0 })).toMatch(/empty/);
    expect(
      checkAttachmentFile({ name: 'a.png', size: MAX_ATTACHMENT_BYTES + 1 }),
    ).toMatch(/too large/);
    expect(checkAttachmentFile({ name: 'run.exe', size: 10 })).toMatch(
      /not allowed/,
    );
    expect(checkAttachmentFile({ name: 'noextension', size: 10 })).toMatch(
      /not allowed/,
    );
    expect(checkAttachmentFile({ name: 'logo.svg', size: 10 })).toMatch(
      /not allowed/,
    );
  });

  it('builds the accept attribute from the allow-list', () => {
    expect(ATTACHMENT_ACCEPT.startsWith('.png,.jpg')).toBe(true);
    expect(ATTACHMENT_ACCEPT).toContain('.pdf');
    expect(ATTACHMENT_ACCEPT).not.toContain('svg');
  });
});
