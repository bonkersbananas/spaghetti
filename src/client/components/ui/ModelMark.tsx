import { shortUrl } from "@shared/links";
import type { ModelMark } from "@shared/model-mark";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { linkPreviewQuery } from "@/lib/queries";
import { CubeIcon, ExternalIcon } from "./icons";
import { Photo } from "./Photo";

/** "MakerWorld", or "3MF file": what to call where the model is. */
export const modelPlace = (mark: ModelMark) =>
  mark.kind === "page" ? mark.name : `${mark.name.slice(1).toUpperCase()} file`;

/**
 * "There is a model for this": a small basil pill with the cube and where it lives, laid on a card's photo (its
 * bottom edge, with the other chips). Basil is the app's "good to go" colour; nothing else on a card uses it before
 * a print has worked, so it reads at a glance without shouting.
 */
export function ModelMarkChip({ mark, className }: { mark: ModelMark; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-pill bg-basil-soft/95 text-basil-ink shadow-soft text-caption inline-flex h-6 max-w-full items-center gap-1 px-2 font-semibold",
        className,
      )}
    >
      <CubeIcon size={13} weight="fill" aria-hidden className="shrink-0" />
      <span className="sr-only">Has a model: </span>
      <span className="truncate">{modelPlace(mark)}</span>
    </span>
  );
}

interface ModelCardProps {
  mark: ModelMark;
  /** The model's own picture, when the draft stored one. */
  picture?: { src: string; color?: string };
  className?: string;
}

/**
 * The model on an idea's page: prominent, near the top. The picture (or a basil tile with the cube), "Model on
 * MakerWorld" over the page's title, and an Open button. The whole card is the link.
 */
export function ModelCard({ mark, picture, className }: ModelCardProps) {
  const { data } = useQuery({ ...linkPreviewQuery(mark.url), enabled: mark.kind === "page" });
  const fileName = decodeURIComponent(new URL(mark.url).pathname.split("/").pop() ?? "");
  const title = data?.title || (mark.kind === "file" ? fileName : shortUrl(mark.url));
  return (
    <a
      href={mark.url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "bg-basil-soft/60 shadow-soft pressable focus-ring hover:shadow-raised flex items-center gap-3.5 rounded-lg p-2 md:gap-4 md:p-2.5",
        className,
      )}
    >
      {picture ? (
        <Photo src={picture.src} alt="" color={picture.color} className="size-20 shrink-0 rounded-md md:size-24" />
      ) : (
        <span
          aria-hidden
          className="bg-basil-soft text-basil-ink flex size-20 shrink-0 items-center justify-center rounded-md md:size-24"
        >
          <CubeIcon size={32} weight="duotone" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-caption text-basil-ink font-semibold tracking-wide uppercase">
          {mark.kind === "page" ? `Model on ${mark.name}` : `${modelPlace(mark)}, ready to print`}
        </span>
        <span className="text-body text-ink line-clamp-2 font-semibold break-words">{title}</span>
        <span className="text-small text-ink-soft inline-flex items-center gap-1">
          Open <ExternalIcon size={14} weight="bold" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </span>
      </span>
    </a>
  );
}
