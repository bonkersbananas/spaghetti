import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useRef, useState } from "react";
import { Avatar, PrinterMark } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import { peopleQuery } from "@/lib/queries";
import { useWho } from "@/lib/who";

const WhoStarted = lazy(() => import("./who-started-lazy").then((entry) => entry.loadWhoStarted()));

interface PrinterByProps {
  attempt: { id: string; startedBy?: string | null };
  /** The build it is in. With it, a tap says who started the print; without, the line only says whose it is. */
  itemId?: string;
  readOnly?: boolean;
  /**
   * Where "From the printer" is written beside the mark: from tablet width up ("md", in a header where a phone has
   * room for the mark alone), always, or never (a card's corner).
   */
  words?: "md" | "always" | "never";
  className?: string;
}

/**
 * Who a print the printer recorded is by, where an attempt says who did it (decision 0076): the printer's own mark
 * and "From the printer", never the person who paired the bridge; once someone says who started it, their avatar with
 * the printer as its small mark, "Marie · from the printer". With `itemId` it is the one place to say who started it:
 * a tap offers the two of you (a sheet on phones, a popover on desktop), and the toast has Undo. It never asks.
 */
export function PrinterBy({ attempt, itemId, readOnly, words = "md", className }: PrinterByProps) {
  const { data: people } = useQuery(peopleQuery);
  const who = useWho();
  const person = attempt.startedBy ? people?.find((one) => one.id === attempt.startedBy) : undefined;
  const [open, setOpen] = useState(false);
  // The picker's code comes with the first tap.
  const [asked, setAsked] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const text = person ? `${who(person)} · from the printer` : "From the printer";
  const shown = words !== "never";
  const content = (
    <>
      {shown && (
        <span
          className={cn(
            "text-ink-faint duration-fast group-hover/by:text-ink-soft whitespace-nowrap transition-colors",
            words === "md" && "hidden md:inline",
          )}
        >
          {text}
        </span>
      )}
      {person ? (
        <Avatar person={person} size="xs" printer decorative={words === "always"} />
      ) : (
        <PrinterMark size="xs" decorative={words === "always"} />
      )}
    </>
  );
  if (!itemId || readOnly) {
    return <span className={cn("flex shrink-0 items-center gap-2", className)}>{content}</span>;
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={person ? `${text}. Change who started it` : "From the printer. Say who started it"}
        onClick={() => {
          setAsked(true);
          setOpen(true);
        }}
        className={cn(
          "pressable focus-ring touch-target group/by relative -m-1 flex shrink-0 items-center gap-2 rounded-full p-1",
          className,
        )}
      >
        {content}
      </button>
      {asked && (
        <Suspense fallback={null}>
          <WhoStarted
            open={open}
            onOpenChange={setOpen}
            anchor={button}
            itemId={itemId}
            attemptId={attempt.id}
            startedBy={attempt.startedBy ?? null}
          />
        </Suspense>
      )}
    </>
  );
}
