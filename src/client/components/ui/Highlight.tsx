import { highlight, type SearchTerm, type Segment } from "@shared/search";

interface HighlightProps {
  /** The text, with the words that start with a search term marked… */
  text?: string;
  terms?: readonly SearchTerm[];
  /** …or pieces already marked (a snippet from the server). */
  segments?: Segment[];
  className?: string;
}

/**
 * Text with the words a search matched marked on a semolina highlight, like
 * a pen stroke in a notebook. Used in search results.
 */
export function Highlight({ text = "", terms = [], segments, className }: HighlightProps) {
  const pieces = segments ?? highlight(text, terms);
  return (
    <span className={className}>
      {pieces.map((piece, index) =>
        piece.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are a fixed split of this text.
          <mark key={index} className="bg-semolina-soft text-ink rounded-xs box-decoration-clone px-0.5">
            {piece.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are a fixed split of this text.
          <span key={index}>{piece.text}</span>
        ),
      )}
    </span>
  );
}
