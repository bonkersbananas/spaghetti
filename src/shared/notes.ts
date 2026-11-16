/** How a note is set on a note card (components/ui/NoteFace.tsx). */
export type NoteSize = "xl" | "lg" | "md" | "sm";

/**
 * How large a note is set on its card: the shorter it is, the larger, so it
 * fills the card the way a line on a recipe card would. A new paragraph
 * counts as a short line's worth, and a long word (a link, "D-shaft,") steps
 * down a size so it never has to break.
 */
export function noteSize(note: string): NoteSize {
  const text = note.trim();
  const weight = text.length + 16 * (text.match(/\n+/g)?.length ?? 0);
  const longestWord = Math.max(0, ...text.split(/\s+/).map((word) => word.length));
  const order: NoteSize[] = ["xl", "lg", "md", "sm"];
  let step = weight <= 32 ? 0 : weight <= 72 ? 1 : weight <= 130 ? 2 : 3;
  // The longest word each size fits on one line of the card.
  const fits = [9, 12, 17];
  while (step < 3 && longestWord > (fits[step] ?? 0)) step += 1;
  return order[step] ?? "sm";
}

/** A soft hyphen: where a word may break, with a hyphen drawn only if it does. */
const SOFT_HYPHEN = "­";

/**
 * A title made safe for a narrow card: a word too long for any line (more than `longest` characters) gets a soft
 * hyphen between each pair of letters, at least three from either end, so the browser breaks it where the line ends,
 * with a hyphen, instead of cutting it with none ("Supercalifr / agilistic…"). Shorter words are left alone, so they
 * move to the next line whole.
 */
export function hyphenateLongWords(text: string, longest = 18): string {
  return text.replace(/\S+/g, (word) => {
    if (word.length <= longest) return word;
    const chars = [...word];
    let out = "";
    for (let i = 0; i < chars.length; i++) {
      out += chars[i];
      const between = i >= 2 && i < chars.length - 3;
      if (between && /\p{L}/u.test(chars[i] ?? "") && /\p{L}/u.test(chars[i + 1] ?? "")) out += SOFT_HYPHEN;
    }
    return out;
  });
}
