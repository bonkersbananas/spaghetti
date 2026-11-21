import type { Person } from "@shared/api";
import { lazy, Suspense, useRef, useState } from "react";
import { PrinterByline } from "@/components/ui/PrinterMark";
import { cn } from "@/lib/cn";

const WhoStarted = lazy(() => import("./WhoStarted"));

export interface PrinterByProps {
  attempt: { id: string; startedBy?: string | null };
  /** Whoever someone said started it (`creditedTo`), resolved by the card, which shows the same until this loads. */
  person?: Person;
  /** The build it is in: a tap says who started the print. Without it (or `readOnly`) the line only says. */
  itemId?: string;
  readOnly?: boolean;
  words?: "md" | "always" | "never";
  className?: string;
}

/**
 * The one place to say who started a print the printer recorded (decision 0076): its `PrinterByline` ("From the
 * printer", or "Sam · from the printer"), as a button. A tap offers the two of you (a sheet on phones, a popover from
 * the line's end on desktop), and the toast has Undo. It never asks. Loaded with the card's other printer parts
 * (`print-place-lazy.ts`), so no screen's first load carries it; the card keeps its room until it comes.
 */
export default function PrinterBy({ attempt, person, itemId, readOnly, words = "md", className }: PrinterByProps) {
  const [open, setOpen] = useState(false);
  // The picker's code comes with the first tap.
  const [asked, setAsked] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!itemId || readOnly) return <PrinterByline person={person} words={words} className={className} />;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          person ? `${person.name} · from the printer. Change who started it` : "From the printer. Say who started it"
        }
        onClick={() => {
          setAsked(true);
          setOpen(true);
        }}
        className={cn(
          "pressable focus-ring touch-target group/by relative -m-1 flex shrink-0 items-center rounded-full p-1",
          className,
        )}
      >
        <PrinterByline person={person} words={words} />
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
