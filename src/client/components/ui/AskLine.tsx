import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";
import { Skeleton } from "./Skeleton";

interface AskLineProps {
  /** The small glyph of whoever asks: the printer for "Is this Herb planter?". */
  icon: Icon;
  /** The question in a few words, its one name in `AskName` ("Is this <AskName>Herb planter</AskName>?"). */
  children?: ReactNode;
  /** Why it asks, or why that guess, in a few faint words under the question ("Same file: planter-v2"). */
  detail?: ReactNode;
  /** The answers, `Button size="sm"`: the likely one first (`secondary`), the others `quiet`. */
  actions?: ReactNode;
  /** The answer is on its way: the line keeps its room, words and buttons as bars, so the card doesn't jump. */
  loading?: boolean;
  className?: string;
}

/**
 * A question one tap answers, in one line on a card: a 16 px glyph, the question in `text-small` (`ink-soft`, its
 * one name in `ink` semibold, as the off-the-bed line says its time), an optional faint reason under it, and the
 * answers at the line's end as small buttons (32 px, a 44 px `touch-target` on phones). On a soft `ink/4` wash, so
 * it reads as something waiting for you without a border; on a narrow card the answers go under the words instead
 * of squeezing them. A region named by its question.
 */
export function AskLine({ icon: Glyph, children, detail, actions, loading, className }: AskLineProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={loading ? undefined : id}
      aria-busy={loading || undefined}
      className={cn(
        "sg-lifted-surface bg-ink/4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md py-2 pr-2 pl-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-[1_1_12rem] items-start gap-2">
        <Glyph size={16} aria-hidden className="text-ink-faint mt-0.5 shrink-0" />
        {loading ? (
          <div aria-hidden className="flex flex-1 flex-col gap-1.5 py-0.5">
            <Skeleton className="h-3.5 w-3/5 rounded-sm" />
            <Skeleton className="h-3 w-2/5 rounded-sm" />
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <p id={id} className="text-small text-ink-soft text-pretty break-words">
              {children}
            </p>
            {detail && <p className="text-small text-ink-faint text-pretty break-words">{detail}</p>}
          </div>
        )}
      </div>
      {loading ? (
        <div aria-hidden className="flex shrink-0 items-center gap-1.5 pl-6">
          <Skeleton className="h-8 w-14 rounded-sm" />
          <Skeleton className="h-8 w-28 rounded-sm" />
        </div>
      ) : (
        // Under the words on a narrow card, they start where the words do (past the glyph).
        actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6">{actions}</div>
      )}
    </section>
  );
}

/** The one name in an `AskLine`'s question: the build it guesses, in `ink` semibold. */
export function AskName({ children }: { children: ReactNode }) {
  return <span className="text-ink font-semibold">{children}</span>;
}
