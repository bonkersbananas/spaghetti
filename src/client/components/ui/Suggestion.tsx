import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { ExternalIcon, PriceIcon } from "./icons";

interface SuggestionCardProps {
  /** What the suggested page is called. */
  title: string | null;
  /** The suggested page, opened in a new tab so a person can check it before saying yes. */
  href: string;
  onUse: () => void;
  onDismiss: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * "Is this it?": a page the app thinks is the thing, for a person to confirm. Never used silently: "Use it" is the
 * primary choice, "Not this one" the quiet one, and the title opens the page to check first.
 */
export function SuggestionCard({ title, href, onUse, onDismiss, disabled, className }: SuggestionCardProps) {
  return (
    <section
      aria-label="A Prisjakt page that might be it"
      className={cn("bg-ink/4 flex flex-col gap-3 rounded-lg p-3", className)}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-small text-ink-faint">Is this it?</p>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="focus-ring text-body text-ink pressable inline-flex min-h-11 items-center gap-2 rounded-xs font-semibold hover:underline hover:underline-offset-4"
        >
          <PriceIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{title ?? "A page on Prisjakt"}</span>
          <ExternalIcon size={14} weight="bold" className="text-ink-faint shrink-0" aria-hidden />
          <span className="sr-only"> (opens Prisjakt in a new tab)</span>
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={disabled} onClick={onUse}>
          Use it
        </Button>
        <Button variant="quiet" disabled={disabled} onClick={onDismiss}>
          Not this one
        </Button>
      </div>
    </section>
  );
}

/** A quiet line for a search on its way or one that found nothing. */
export function SuggestionNote({ children }: { children: ReactNode }) {
  return <p className="text-small text-ink-faint">{children}</p>;
}
