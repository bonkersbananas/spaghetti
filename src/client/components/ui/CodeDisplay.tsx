import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { CheckIcon, CopyIcon } from "./icons";

interface CodeDisplayProps {
  /** "ABCD-EFGH": shown in two groups, copied as written. */
  code: string;
  className?: string;
}

/** A short code to read out or type on another device: large, grouped, easy to tell the letters apart, with Copy. */
export function CodeDisplay({ code, className }: CodeDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [first, second] = code.split("-");
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <p className="text-ink text-title flex gap-4 font-mono font-semibold tracking-widest">
        <span className="sr-only">{code}</span>
        <span aria-hidden>{first}</span>
        <span aria-hidden>{second}</span>
      </p>
      <Button
        variant="quiet"
        size="sm"
        icon={copied ? CheckIcon : CopyIcon}
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          });
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
}
