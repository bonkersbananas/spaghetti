import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "./icons";

export type StepState = "todo" | "active" | "done";

/** A numbered list of things to do in order, each with a state: not yet, now, done. */
export function Steps({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("flex flex-col gap-6", className)}>{children}</ol>;
}

interface StepProps {
  n: number;
  title: string;
  state?: StepState;
  children?: ReactNode;
}

/**
 * One step: a round numeral (semolina while it is the one to do, a basil check once it is done, a quiet well before),
 * its title, and what to do under it. The state is said in words for screen readers, never by color alone.
 */
export function Step({ n, title, state = "todo", children }: StepProps) {
  return (
    <li className="flex gap-3 md:gap-4" aria-current={state === "active" ? "step" : undefined}>
      <span
        aria-hidden
        className={cn(
          "text-small tabular flex size-8 shrink-0 items-center justify-center rounded-full font-semibold",
          state === "done" && "bg-basil-soft text-basil-ink",
          state === "active" && "bg-semolina-soft text-semolina-ink",
          state === "todo" && "bg-ink/5 text-ink-faint",
        )}
      >
        {state === "done" ? <CheckIcon size={16} weight="bold" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-body text-ink pt-1 font-semibold">
          {title}
          <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (now)" : ""}</span>
        </h3>
        {children && <div className="text-body text-ink-soft mt-2 flex flex-col gap-3">{children}</div>}
      </div>
    </li>
  );
}
