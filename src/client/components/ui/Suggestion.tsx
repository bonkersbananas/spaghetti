import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { ClaudeLine } from "./ClaudeLine";
import { CheckIcon, ExternalIcon, PriceIcon } from "./icons";

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
        <ClaudeLine>Claude found this on Prisjakt. Is this it?</ClaudeLine>
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

interface MatchRowProps {
  /** The thing on the list, as it is called there. */
  name: string;
  /** What the page Claude found is called. */
  title: string | null;
  /** The page, opened in a new tab to check first. */
  href: string;
  /** Answered here: the row stays where it is (so the next one doesn't slide under a thumb) and says so. */
  answer?: "used" | "dismissed";
  /** The cheapest price, once a used page has been read ("149 kr"). */
  price?: string;
  onUse: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

/** "A title of several words ↗": the arrow kept with the last word, so it never wraps onto a line of its own. */
function TitleWithArrow({ title }: { title: string }) {
  const at = title.trimEnd().lastIndexOf(" ");
  const head = at > 0 ? title.slice(0, at + 1) : "";
  const last = at > 0 ? title.slice(at + 1) : title;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {last}
        <ExternalIcon size={12} weight="bold" className="text-ink-faint ml-1 inline align-baseline" aria-hidden />
      </span>
    </>
  );
}

/**
 * One of several pages to confirm at once ("Match prices"): the page Claude found, by its own title (a link to check
 * it), the thing it would be for as a small caption under it, and "Use it" or "Not this one"; once used, the price
 * read from it. Calmer than a `SuggestionCard`: the sheet's description says once who found them.
 */
export function MatchRow({ name, title, href, answer, price, onUse, onDismiss, disabled }: MatchRowProps) {
  return (
    <div className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="focus-ring touch-target text-body text-ink pressable relative self-start rounded-xs font-semibold break-words hover:underline hover:underline-offset-4"
        >
          <TitleWithArrow title={title ?? "A page on Prisjakt"} />
          <span className="sr-only"> (opens Prisjakt in a new tab)</span>
        </a>
        <p className="text-small text-ink-faint flex min-w-0 items-center gap-1.5">
          <PriceIcon size={14} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate">For “{name}”</span>
        </p>
      </div>
      {answer ? (
        <p role="status" className="text-small text-ink-faint flex min-h-8 shrink-0 items-center gap-1.5">
          {answer === "used" ? (
            <>
              <CheckIcon size={14} weight="bold" className="text-basil-ink" aria-hidden />
              {price ? (
                <>
                  Matched · <span className="text-ink-soft font-semibold tabular-nums">{price}</span>
                </>
              ) : (
                "Matched: reading its prices…"
              )}
            </>
          ) : (
            "Not this one"
          )}
        </p>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" className="touch-target relative" disabled={disabled} onClick={onUse}>
            Use it
          </Button>
          <Button variant="quiet" size="sm" className="touch-target relative" disabled={disabled} onClick={onDismiss}>
            Not this one
          </Button>
        </div>
      )}
    </div>
  );
}
