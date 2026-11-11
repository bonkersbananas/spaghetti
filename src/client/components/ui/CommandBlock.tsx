import { Fragment, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { CheckIcon, CopyIcon } from "./icons";

interface CommandBlockProps {
  /** The text to run, exactly as it should be pasted. */
  command: string;
  /** What it is, for screen readers: "Terminal command". */
  label: string;
  className?: string;
}

/**
 * The command with its soft break points: after a space and after each slash, nowhere else, so it wraps the way a
 * person would break it ("…/bridge/" then "install.sh") and the pairing code stays whole.
 */
function breakable(command: string) {
  return command.split(/(?<=[ /])/).map((piece, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the pieces never reorder
    <Fragment key={i}>
      <span className="whitespace-pre">{piece}</span>
      <wbr />
    </Fragment>
  ));
}

/**
 * A line to copy and paste somewhere else (Terminal): monospace on a recessed well, wrapping instead of scrolling
 * sideways so the whole of it can be read on a phone, it breaks only after a space or a slash, selectable in one tap, with a Copy button that says "Copied".
 */
export function CommandBlock({ command, label, className }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const line = useRef<HTMLElement>(null);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="sr-only">{label}</p>
      <code
        ref={line}
        className="bg-well shadow-well text-small text-ink block rounded-lg p-3 font-mono leading-relaxed select-all"
      >
        {breakable(command)}
      </code>
      <Button
        variant="primary"
        size="sm"
        icon={copied ? CheckIcon : CopyIcon}
        className="self-start max-md:w-full"
        onClick={() => {
          setFailed(false);
          (navigator.clipboard?.writeText(command) ?? Promise.reject(new Error("no clipboard"))).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            },
            () => {
              // No permission to copy: select the line so a press of Copy on the keyboard does it.
              if (line.current) window.getSelection()?.selectAllChildren(line.current);
              setFailed(true);
            },
          );
        }}
      >
        {copied ? "Copied" : failed ? "Selected: press ⌘C" : "Copy command"}
      </Button>
    </div>
  );
}
