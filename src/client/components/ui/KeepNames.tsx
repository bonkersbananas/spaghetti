/** A file's name in running text: "UOBF-fit-test-ring.3mf", "planter-v2.gcode.3mf" (no spaces, a slicer's ending). */
const FILE_NAME = /[^\s()“”"]+\.(?:gcode\.3mf|3mf|gcode|bgcode|stl|step|stp|obj)\b/gi;

/** Longer than this, a name may break like any word, or it would run past a phone's line. */
const LONGEST = 36;

const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Running text with each name in it kept whole on one line: the `names` given (a file's name as people see it,
 * "bath-boat"), and any file name with its slicer's ending. "it printed bath-boat" never breaks after "bath-", which
 * reads as two names. A name too long for a phone's line still breaks where it must.
 */
export function KeepNames({ text, names = [] }: { text: string; names?: readonly string[] }) {
  const kept = names.filter((name) => name && name.length <= LONGEST).map(literally);
  const pattern = new RegExp([FILE_NAME.source, ...kept].join("|"), "gi");
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
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
