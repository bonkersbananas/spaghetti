import { actionsFor, nudgeMessage } from "@shared/push";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { BellIcon } from "./icons";
import { NotificationPreview } from "./NotificationPreview";

interface NotificationOfferProps {
  onTurnOn: () => void;
  onDismiss: () => void;
  /** Turning on is under way (the browser's question is open). */
  busy?: boolean;
  /** What is in it for them, one sentence. */
  children?: ReactNode;
  className?: string;
}

const example = nudgeMessage("off_the_bed", { id: "example", itemId: "example" }, "Tugboat");

/**
 * The one-time offer to turn notifications on, one of the soft cards of Today and Now (the cream surface of the
 * scout's row): the bell, what is in it for them, a quiet "Turn on" (never tomato: capture stays the one primary
 * action) and "Not now". On a phone the buttons sit beside the words, so the card is about two rows tall; from md
 * the real nudge is drawn beside them, as the Notifications sheet shows it.
 */
export function NotificationOffer({ onTurnOn, onDismiss, busy, children, className }: NotificationOfferProps) {
  return (
    <section
      aria-label="Turn on notifications"
      className={cn(
        "bg-cream shadow-soft grid grid-cols-[1fr_auto] items-center gap-x-4 rounded-lg p-3.5 md:grid-cols-[1fr_17rem] md:gap-x-8 md:gap-y-3 md:p-5",
        className,
      )}
    >
      <div className="min-w-0 md:col-start-1">
        <p className="text-body text-ink flex items-center gap-2 font-semibold">
          <BellIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
          Hear when a print is done
        </p>
        <p className="text-small text-ink-soft mt-1">{children ?? "So each one gets its answer while it's fresh."}</p>
      </div>
      <div className="flex flex-col items-stretch gap-1 md:col-start-1 md:row-start-2 md:flex-row md:items-center md:gap-2">
        <Button variant="secondary" size="sm" loading={busy} onClick={onTurnOn}>
          Turn on
        </Button>
        <Button variant="quiet" size="sm" onClick={onDismiss}>
          Not now
        </Button>
      </div>
      <NotificationPreview
        title={example.title}
        body={example.body}
        actions={actionsFor("desktop")}
        className="bg-paper hidden md:col-start-2 md:row-span-2 md:row-start-1 md:block"
      />
    </section>
  );
}
