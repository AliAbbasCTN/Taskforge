/** The characters the backend wraps around matched words (never HTML). */
export const HIGHLIGHT_START = '⟦';
export const HIGHLIGHT_END = '⟧';

export interface HighlightPart {
  text: string;
  /** True for the words that matched the search. */
  match: boolean;
}

/**
 * WHAT: Splits text like `Fix ⟦login⟧ redirect` into
 * `[{Fix , false}, {login, true}, { redirect, false}]`.
 *
 * WHY not just return HTML like `Fix <mark>login</mark> redirect` from the
 * server: task titles and descriptions are typed by users. Turning a
 * server-built HTML string into the page needs `dangerouslySetInnerHTML`, and
 * the moment any user text isn't perfectly escaped, someone can inject a
 * script (XSS). Instead the server uses plain marker characters and React
 * renders every part as TEXT (escaped automatically); only the parts flagged
 * `match` get wrapped in a `<mark>` element that WE choose.
 *
 * Tolerant of imperfect input: an unmatched start marker treats the rest as a
 * match, a stray end marker is ignored, and markers are never shown.
 */
export function splitHighlight(text: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let buffer = '';
  let matching = false;

  const flush = () => {
    if (buffer !== '') {
      parts.push({ text: buffer, match: matching });
      buffer = '';
    }
  };

  for (const character of text) {
    if (character === HIGHLIGHT_START) {
      flush();
      matching = true;
    } else if (character === HIGHLIGHT_END) {
      flush();
      matching = false;
    } else {
      buffer += character;
    }
  }
  flush();
  return parts;
}
