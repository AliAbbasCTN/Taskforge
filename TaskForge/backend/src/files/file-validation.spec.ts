import {
  ALLOWED_FILE_TYPES,
  extensionOf,
  isPlainText,
  validateFile,
} from './file-validation';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = Buffer.from('GIF89a-rest');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n...');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

describe('extensionOf', () => {
  it.each([
    ['photo.PNG', 'png'],
    ['report.final.pdf', 'pdf'],
    ['README', ''],
    ['.bashrc', ''],
    ['trailing.', ''],
    ['', ''],
  ])('%s -> "%s"', (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });
});

describe('validateFile', () => {
  it.each([
    ['a.png', PNG, 'image/png'],
    ['a.jpg', JPEG, 'image/jpeg'],
    ['a.JPEG', JPEG, 'image/jpeg'],
    ['a.gif', GIF, 'image/gif'],
    ['a.webp', WEBP, 'image/webp'],
    ['a.pdf', PDF, 'application/pdf'],
    ['a.txt', Buffer.from('héllo wörld'), 'text/plain'],
    ['a.csv', Buffer.from('a,b\n1,2\n'), 'text/csv'],
    ['a.md', Buffer.from('# Title'), 'text/markdown'],
    ['a.docx', ZIP, ALLOWED_FILE_TYPES.docx.mimeType],
    ['a.xlsx', ZIP, ALLOWED_FILE_TYPES.xlsx.mimeType],
    ['a.pptx', ZIP, ALLOWED_FILE_TYPES.pptx.mimeType],
  ])(
    'accepts %s and reports the SERVER-decided MIME type',
    (name, data, mime) => {
      const result = validateFile(name, data);
      expect(result).toEqual({
        ok: true,
        extension: name.split('.').pop()!.toLowerCase(),
        mimeType: mime,
      });
    },
  );

  it('rejects an empty file', () => {
    expect(validateFile('a.txt', Buffer.alloc(0))).toEqual({
      ok: false,
      reason: 'The file is empty',
    });
  });

  it.each([
    'run.exe',
    'page.html',
    'logo.svg',
    'x.js',
    'x.sh',
    'a.zip',
    'noext',
    '.png',
  ])('rejects the disallowed or missing extension %s', (name) => {
    const result = validateFile(name, PNG);
    expect(result.ok).toBe(false);
  });

  it('rejects a file whose bytes do not match its extension (a renamed file)', () => {
    const script = Buffer.from('<script>alert(1)</script>');
    expect(validateFile('holiday.png', script).ok).toBe(false);
    expect(validateFile('holiday.pdf', PNG).ok).toBe(false);
    expect(validateFile('holiday.jpg', PNG).ok).toBe(false);
    expect(validateFile('holiday.docx', PDF).ok).toBe(false);
  });

  it('does not accept a RIFF file that is not WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from('WAVEfmt '),
    ]);
    expect(validateFile('a.webp', wav).ok).toBe(false);
  });

  it('treats prototype property names as unknown extensions, not as types', () => {
    expect(validateFile('a.constructor', PNG).ok).toBe(false);
    expect(validateFile('a.__proto__', PNG).ok).toBe(false);
  });

  it('rejects a binary disguised as .txt', () => {
    expect(validateFile('a.txt', Buffer.from([0x68, 0x00, 0x69])).ok).toBe(
      false,
    );
    expect(validateFile('a.csv', Buffer.from([0xff, 0xfe, 0xfd])).ok).toBe(
      false,
    );
  });
});

describe('isPlainText', () => {
  it('accepts UTF-8 and rejects NUL bytes and invalid UTF-8', () => {
    expect(isPlainText(Buffer.from('plain ✓'))).toBe(true);
    expect(isPlainText(Buffer.from([0x61, 0x00]))).toBe(false);
    expect(isPlainText(Buffer.from([0xc3, 0x28]))).toBe(false);
  });
});
