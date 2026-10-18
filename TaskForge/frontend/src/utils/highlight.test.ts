import { describe, expect, it } from 'vitest';
import { splitHighlight } from './highlight';

describe('splitHighlight', () => {
  it('splits matched words from the surrounding text', () => {
    expect(splitHighlight('Fix ⟦login⟧ redirect')).toEqual([
      { text: 'Fix ', match: false },
      { text: 'login', match: true },
      { text: ' redirect', match: false },
    ]);
  });

  it('handles several matches, and matches at the very start or end', () => {
    expect(splitHighlight('⟦a⟧ b ⟦c⟧')).toEqual([
      { text: 'a', match: true },
      { text: ' b ', match: false },
      { text: 'c', match: true },
    ]);
  });

  it('returns a single plain part when nothing matched, and nothing for empty text', () => {
    expect(splitHighlight('no marks here')).toEqual([
      { text: 'no marks here', match: false },
    ]);
    expect(splitHighlight('')).toEqual([]);
  });

  it('never treats HTML as markup: it stays plain text for React to escape', () => {
    expect(splitHighlight('⟦<script>alert(1)</script>⟧')).toEqual([
      { text: '<script>alert(1)</script>', match: true },
    ]);
  });

  it('tolerates unbalanced markers without showing them', () => {
    expect(splitHighlight('a ⟦b')).toEqual([
      { text: 'a ', match: false },
      { text: 'b', match: true },
    ]);
    expect(splitHighlight('a⟧ b')).toEqual([
      { text: 'a', match: false },
      { text: ' b', match: false },
    ]);
  });

  it('keeps non-BMP characters (emoji) intact', () => {
    expect(splitHighlight('⟦bug⟧ 🐛')).toEqual([
      { text: 'bug', match: true },
      { text: ' 🐛', match: false },
    ]);
  });
});
