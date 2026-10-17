import {
  contentDispositionAttachment,
  repairUtf8FileName,
  sanitizeFileName,
} from './file-names';

describe('sanitizeFileName', () => {
  it('strips any path, whichever slash style', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\ada\\cv.pdf')).toBe('cv.pdf');
    expect(sanitizeFileName('/abs/path/file.txt')).toBe('file.txt');
  });

  it('replaces control and reserved characters', () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*.txt')).toBe('a_b_c_d_e_f_g_.txt');
    expect(sanitizeFileName('line\nbreak\r\n.txt')).toBe('line_break__.txt');
  });

  it('removes leading dots and trailing dots/spaces, and collapses whitespace', () => {
    expect(sanitizeFileName('...hidden.txt')).toBe('hidden.txt');
    expect(sanitizeFileName('  my   report .pdf  ')).toBe('my report .pdf');
    expect(sanitizeFileName('name.txt. .')).toBe('name.txt');
  });

  it('falls back to "file" when nothing is left', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('/')).toBe('file');
  });

  it('keeps the extension when shortening a long name', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const result = sanitizeFileName(long);
    expect(result.length).toBe(100);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('keeps international names intact', () => {
    expect(sanitizeFileName('Résumé 履歴書.pdf')).toBe('Résumé 履歴書.pdf');
  });
});

describe('repairUtf8FileName', () => {
  it('repairs UTF-8 that was mis-decoded as Latin-1', () => {
    const mangled = Buffer.from('Résumé.pdf', 'utf8').toString('latin1');
    expect(mangled).not.toBe('Résumé.pdf');
    expect(repairUtf8FileName(mangled)).toBe('Résumé.pdf');
  });

  it('leaves correct, ASCII and genuine Latin-1 names alone', () => {
    expect(repairUtf8FileName('plain.txt')).toBe('plain.txt');
    expect(repairUtf8FileName('履歴書.pdf')).toBe('履歴書.pdf');
    expect(repairUtf8FileName('caf\u00e9.txt')).toBe('caf\u00e9.txt');
  });
});

describe('contentDispositionAttachment', () => {
  it('always says attachment, so browsers save instead of rendering', () => {
    expect(contentDispositionAttachment('a.pdf')).toMatch(/^attachment;/);
  });

  it('cannot be broken out of with quotes or newlines', () => {
    const header = contentDispositionAttachment('evil".txt');
    expect(header).toContain('filename="evil_.txt"');
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('carries the real UTF-8 name percent-encoded', () => {
    const header = contentDispositionAttachment('Résumé (1).pdf');
    expect(header).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%281%29.pdf");
    expect(header).toContain('filename="R_sum_ (1).pdf"');
  });
});
