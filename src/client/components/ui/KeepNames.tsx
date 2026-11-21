/** A file's name in running text: "UOBF-fit-test-ring.3mf", "planter-v2.gcode.3mf" (no spaces, a slicer's ending). */
const FILE_NAME = /[^\s()“”"]+\.(?:gcode\.3mf|3mf|gcode|bgcode|stl|step|stp|obj)\b/gi;

/** Longer than this, a name may break like any word, or it would run past a phone's line. */
const LONGEST = 36;

/**
 * Running text with each file name kept whole on one line: "Same file as bath-boat.gcode.3mf" never breaks after
 * "bath-", which reads as two names. A name too long for a phone's line still breaks where it must.
 */
export function KeepNames({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FILE_NAME)) {
    const name = match[0];
    if (name.length > LONGEST) continue;
    parts.push(
      text.slice(last, match.index),
      <span key={match.index} className="whitespace-nowrap">
        {name}
      </span>,
    );
    last = match.index + name.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * A name the printer or a person gave (a print's job name, a build's title) set in running text: `ink-soft` medium,
 * no quotes, and whole on one line when it is short enough ("cable-clip-v3" never breaks after "cable-clip-").
 */
export function KeptName({ children }: { children: string }) {
  return (
    <span
      className={
        children.length > LONGEST
          ? "text-ink-soft font-medium break-words"
          : "text-ink-soft font-medium whitespace-nowrap"
      }
    >
      {children}
    </span>
  );
}
