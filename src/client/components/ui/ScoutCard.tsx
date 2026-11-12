import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { CheckIcon, ExternalIcon, PlusIcon, UndoIcon } from "./icons";
import { Photo } from "./Photo";

export interface ScoutCardProps {
  title: string;
  /** The model's page on its site: the picture and the title open it in a new tab. */
  url: string;
  /** "MakerWorld" or "Thingiverse", over the picture. */
  siteName: string;
  /** The picture, large; without one the card shows a plain well. */
  picture?: string;
  /** One short sentence on why it fits the two of you. */
  why: string;
  /** suggested: Keep and Not for us; kept and dismissed: what was done, with a way back. */
  state?: "suggested" | "kept" | "dismissed";
  onKeep?: () => void;
  onDismiss?: () => void;
  /** Takes back a Keep or a "Not for us". */
  onUndo?: () => void;
  /** Where a kept model's idea is (a Link, drawn in place of the Keep button's row). */
  keptLink?: ReactNode;
  className?: string;
}

/**
 * One model the idea scout found (decision 0039): the picture first and large, the title, one sentence on why it
 * fits, and two answers. Keep makes an idea of it; Not for us puts it away for good. Nothing is decided until a
 * tap, and both can be taken back.
 */
export function ScoutCard({
  title,
  url,
  siteName,
  picture,
  why,
  state = "suggested",
  onKeep,
  onDismiss,
  onUndo,
  keptLink,
  className,
}: ScoutCardProps) {
  return (
    <article
      className={cn(
        "bg-cream shadow-soft duration-base flex h-full flex-col rounded-lg p-1.5 transition-opacity",
        state === "dismissed" && "opacity-60",
        className,
      )}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden
        className="relative block aspect-4/3 w-full overflow-hidden rounded-md"
      >
        {picture ? <Photo src={picture} alt="" eager className="size-full" /> : <div className="bg-well size-full" />}
        <span className="bg-veil text-on-veil text-small rounded-pill absolute bottom-2 left-2 inline-flex h-6 items-center px-2.5 font-semibold">
          {siteName}
        </span>
      </a>
      <div className="flex flex-1 flex-col gap-1 px-2 pt-2.5 pb-1.5">
        <h3 className="text-body text-ink line-clamp-2 font-semibold break-words">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring decoration-ink/30 rounded-xs underline-offset-2 hover:underline"
          >
            {title}
            <ExternalIcon size={14} weight="bold" aria-hidden className="text-ink-faint mb-0.5 ml-1 inline" />
            <span className="sr-only"> (opens {siteName})</span>
          </a>
        </h3>
        <p className="text-small text-ink-soft text-pretty">{why}</p>
      </div>
      <div className="flex items-center gap-1.5 px-0.5 pt-1 pb-0.5">
        {state === "suggested" ? (
          <>
            <Button
              variant="secondary"
              icon={PlusIcon}
              onClick={onKeep}
              className="bg-ink/5 hover:bg-ink/8 text-small flex-1 px-2 shadow-none"
            >
              Keep
            </Button>
            <Button variant="quiet" onClick={onDismiss} className="text-small px-2.5">
              Not for us
            </Button>
          </>
        ) : (
          <>
            <p className="text-small text-ink-soft flex min-w-0 flex-1 items-center gap-1.5 px-2.5 font-medium">
              {state === "kept" ? (
                <>
                  <CheckIcon size={16} weight="bold" aria-hidden className="text-basil-ink shrink-0" />
                  {keptLink ?? "Kept as an idea"}
                </>
              ) : (
                "Not for us"
              )}
            </p>
            <Button variant="quiet" size="sm" icon={UndoIcon} onClick={onUndo}>
              Undo
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
