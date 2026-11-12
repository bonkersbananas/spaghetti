import { shortUrl } from "@shared/links";
import { type ModelMark, modelLetter, modelPlace } from "@shared/model-mark";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { linkPreviewQuery } from "@/lib/queries";
import { ExternalIcon } from "./icons";
import { Photo } from "./Photo";

/** "www.printables.com" → "printables.com"; the address itself when it can't be read. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return shortUrl(url);
  }
}

const fileName = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");

/**
 * A link in a note as a card: the site's first letter on a tile, the page's
 * title and its site name, a small arrow for "leaves the app". It shows at
 * once with the short address and the title fades in when it arrives (the
 * height is fixed, so nothing jumps and there is no skeleton). No remote
 * pictures: they break offline, tell the other site about the visit and move
 * the layout. Opens in a new tab.
 */
export function LinkCard({
  url,
  model,
  picture,
  className,
}: {
  url: string;
  /** The idea's model: the card says "Model on MakerWorld" in basil over the title, and a file has no page to read. */
  model?: ModelMark;
  /** The model's own picture (the draft's), in place of the site's letter tile. */
  picture?: { src: string; color?: string };
  className?: string;
}) {
  const { data, isPending } = useQuery({ ...linkPreviewQuery(url), enabled: model?.kind !== "file" });
  // Only a title that arrives while the card is on screen fades in; one that was already known is just there.
  const waited = useRef(isPending);
  const title = data?.title || (model?.kind === "file" ? fileName(url) : null);
  const site = data?.site || hostOf(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "bg-cream shadow-soft pressable focus-ring hover:shadow-raised flex min-h-16 items-center gap-3 rounded-lg p-3",
        className,
      )}
    >
      {picture ? (
        <Photo src={picture.src} alt="" color={picture.color} className="size-16 shrink-0 rounded-sm md:size-20" />
      ) : (
        <span
          aria-hidden
          className="bg-ink/5 text-ink-soft font-display text-title flex size-10 shrink-0 items-center justify-center rounded-sm"
        >
          {model ? modelLetter(model) : site.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        {model && (
          <span className="text-caption text-basil-ink font-semibold tracking-wide uppercase">
            {model.kind === "page" ? `Model on ${model.name}` : `${modelPlace(model)}, ready to print`}
          </span>
        )}
        <span
          key={title ? "titled" : "bare"}
          className={cn(
            "text-body text-ink line-clamp-2 font-semibold break-words",
            title && waited.current && "sg-fade-in",
          )}
        >
          {title ?? shortUrl(url)}
        </span>
        <span className="text-small text-ink-faint truncate">
          {site}
          <span className="sr-only"> (opens in a new tab)</span>
        </span>
      </span>
      <ExternalIcon size={16} className="text-ink-faint shrink-0 self-start" aria-hidden />
    </a>
  );
}
