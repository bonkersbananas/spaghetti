import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckCircleIcon, WarningIcon } from "./icons";
import { PulseDot } from "./PulseDot";

export type LiveState = "waiting" | "connected" | "problem";

/**
 * Something that is happening and will change by itself: a dot that pulses while we wait, a basil check when it
 * has happened, a semolina warning when it needs a person. A polite live region, so the change is announced.
 * A pulse, not a spinner.
 */
export function LiveStatus({
  state,
  children,
  detail,
  className,
}: {
  state: LiveState;
  children: ReactNode;
  /** A longer sentence under the status, in regular weight (what is wrong and what to do). */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "text-body flex items-start gap-3 rounded-lg p-3",
        state === "waiting" && "bg-ink/5 text-ink-soft",
        state === "connected" && "bg-basil-soft text-basil-ink",
        state === "problem" && "bg-semolina-soft text-semolina-ink",
        className,
      )}
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden>
        {state === "waiting" && <PulseDot />}
        {state === "connected" && <CheckCircleIcon size={20} weight="fill" />}
        {state === "problem" && <WarningIcon size={20} weight="fill" />}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{children}</span>
        {detail && <span className="text-small mt-1 block">{detail}</span>}
      </span>
    </p>
  );
}
