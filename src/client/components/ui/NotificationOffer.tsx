import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { BellIcon } from "./icons";

interface NotificationOfferProps {
  onTurnOn: () => void;
  onDismiss: () => void;
  /** Turning on is under way (the browser's question is open). */
  busy?: boolean;
  /** What it says the person would hear about. */
  children?: ReactNode;
  className?: string;
}

/**
 * The one-time offer to turn notifications on, drawn on the recessed wash of Today's quiet lines (a note on the
 * fridge, not a card, so a print waiting for its answer stays the first surface): a bell, what they would hear
 * about, "Turn on" and "Not now". "Not now" is for good, so the words say it is easy to change later.
 */
export function NotificationOffer({ onTurnOn, onDismiss, busy, children, className }: NotificationOfferProps) {
  return (
    <section
      aria-label="Turn on notifications"
      className={cn("bg-ink/4 flex flex-col gap-3 rounded-lg p-4", className)}
    >
      <div className="flex items-start gap-3">
        <BellIcon size={20} className="text-tomato mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-body text-ink font-semibold">Hear when a print is done</p>
          <p className="text-small text-ink-soft mt-0.5">
            {children ??
              "A nudge when a print is done and waiting for its answer. You can change this any time in Notifications."}
          </p>
        </div>
      </div>
      <div className="flex gap-2 pl-8">
        <Button variant="primary" size="md" loading={busy} onClick={onTurnOn}>
          Turn on
        </Button>
        <Button variant="quiet" size="md" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
