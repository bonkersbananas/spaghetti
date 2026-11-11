import { Fragment, useState } from "react";
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
 * A line to copy and paste somewhere else (Terminal): monospace on a recessed well, wrapping instead of scrolling
 * sideways so the whole of it can be read on a phone, the short words (a pairing code) never split, selectable in one tap, with a Copy button that says "Copied".
 */
export function CommandBlock({ command, label, className }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="sr-only">{label}</p>
      <code className="bg-well shadow-well text-small text-ink block rounded-lg p-3 font-mono leading-relaxed select-all">
        {command.split(" ").map((word, i) => (
          // Break between words, never inside a short one (the pairing code stays whole); only a long address may break.
          // biome-ignore lint/suspicious/noArrayIndexKey: the words never reorder
          <Fragment key={i}>
            {i > 0 && " "}
            <span className={word.length > 24 ? "break-all" : "whitespace-nowrap"}>{word}</span>
          </Fragment>
        ))}
      </code>
      <Button
        variant="primary"
        size="sm"
        icon={copied ? CheckIcon : CopyIcon}
        className="self-start max-md:w-full"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          });
        }}
      >
        {copied ? "Copied" : "Copy command"}
      </Button>
    </div>
  );
}
