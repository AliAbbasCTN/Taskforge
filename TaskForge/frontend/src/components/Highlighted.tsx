import { splitHighlight } from '../utils/highlight';

/**
 * Renders search-highlighted text. Every part is a React text child (escaped),
 * so user content can never become markup; matched parts are wrapped in
 * `<mark>`. See `splitHighlight` for why the server sends markers, not HTML.
 */
export function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitHighlight(text).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : part.text,
      )}
    </>
  );
}
