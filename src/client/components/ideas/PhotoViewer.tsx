import { type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "@/components/ui/Button";
import { CloseIcon, NextIcon, PreviousIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import { useHeroName } from "@/lib/hero";
import type { PhotoView } from "@/lib/items";
import { scrollBehavior } from "@/lib/motion";
import type { PhotoZoom } from "@/lib/photo-zoom";
import { photoSrc } from "@/lib/previews";
import { useWhenIdle } from "@/lib/when-idle";

interface PhotoViewerProps {
  photos: PhotoView[];
  index: number;
  onIndexChange: (index: number) => void;
  alt: string;
  /** Removes the photo being shown (a quiet button on it). Leave out where photos can't be removed. */
  onRemove?: (photo: PhotoView) => void;
  className?: string;
}

/** Keeps the frame between 4:5 and 4:3, shaped by the cover. */
function frameAspect(photo: PhotoView | undefined): number {
  if (!photo) return 4 / 3;
  return Math.min(4 / 3, Math.max(4 / 5, photo.width / photo.height));
}

/**
 * One photo's frame in the carousel; it takes the hero transition's name when it is the photo that was tapped on a
 * card. The photo inside zooms in place (lib/photo-zoom.ts, loaded once the screen is idle, separately from the
 * viewer), and goes back to fitted when another photo is the one shown.
 */
function ViewerFigure({
  photo,
  label,
  active,
  overlay,
  children,
}: {
  photo: PhotoView;
  label: string;
  active: boolean;
  /** Stays put while the photo zooms. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const zoom = useRef<PhotoZoom | null>(null);
  useWhenIdle(() => {
    const el = frame.current;
    const inner = layer.current;
    if (!el || !inner) return;
    void import("@/lib/photo-zoom").then((module) => {
      if (frame.current === el && !zoom.current) zoom.current = module.attachPhotoZoom(el, inner);
    });
  });
  useEffect(() => {
    if (!active) zoom.current?.reset();
  }, [active]);
  useEffect(
    () => () => {
      zoom.current?.destroy();
      zoom.current = null;
    },
    [],
  );
  return (
    <figure
      ref={frame}
      aria-label={label}
      style={useHeroName(photo.id)}
      className="relative h-full w-full shrink-0 snap-center overflow-hidden"
    >
      <div ref={layer} className="size-full will-change-transform">
        {children}
      </div>
      {overlay}
    </figure>
  );
}

/**
 * Big photos first. Swipe between them on a phone (native scroll snapping),
 * or use the arrow buttons and keys on desktop. The whole print shows:
 * nothing is cropped.
 */
export function PhotoViewer({ photos, index, onIndexChange, alt, onRemove, className }: PhotoViewerProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow the index when it changes from outside: arrow keys, the strip. Opening on a later photo (the one a card was
  // swiped to) is there at once, so it can travel from its card.
  const placed = useRef(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el?.clientWidth) return;
    const target = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2)
      el.scrollTo({ left: target, behavior: placed.current ? scrollBehavior() : "instant" });
    placed.current = true;
  }, [index]);

  function onScroll() {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = scroller.current;
      if (!el?.clientWidth) return;
      const next = Math.round(el.scrollLeft / el.clientWidth);
      if (next !== index) onIndexChange(next);
    }, 90);
  }

  const many = photos.length > 1;
  return (
    <section aria-roledescription="carousel" aria-label="Photos" className={cn("group/viewer relative", className)}>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          // Reachable with Tab when it scrolls (several photos), so arrow keys can move through them without a mouse.
          tabIndex={many ? 0 : undefined}
          className="focus-ring bg-paper-deep flex max-h-[72dvh] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:rounded-xl [&::-webkit-scrollbar]:hidden"
          style={{ aspectRatio: frameAspect(photos[0]), scrollbarWidth: "none" }}
        >
          {photos.map((photo, i) => (
            <ViewerFigure
              key={photo.id}
              photo={photo}
              label={`${i + 1} of ${photos.length}`}
              active={i === index}
              overlay={
                photo.upload && (
                  <UploadBadge
                    state={photo.upload.status === "queued" ? "queued" : photo.upload.status}
                    progress={photo.upload.progress}
                    className="absolute bottom-3 left-3"
                  />
                )
              }
            >
              <Photo
                src={photoSrc(photo.id, "large")}
                alt={many ? `${alt} (${i + 1} of ${photos.length})` : alt}
                color={photo.color || undefined}
                fit="contain"
                eager={Math.abs(i - index) <= 1}
                className="bg-paper-deep size-full"
              />
            </ViewerFigure>
          ))}
        </div>
        {onRemove && photos[index] && (
          // On the photo, in the corner a thumb reaches: always there on a phone, on hover or focus on desktop. A plain
          // cross, not the trash of "delete this idea"; removing has its undo toast, so it is one tap.
          <button
            type="button"
            onClick={() => photos[index] && onRemove(photos[index])}
            aria-label="Remove this photo"
            title="Remove this photo"
            className="pressable focus-ring touch-target bg-veil text-on-veil shadow-raised duration-fast absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full transition-opacity md:opacity-0 md:group-focus-within/viewer:opacity-100 md:group-hover/viewer:opacity-100"
          >
            <CloseIcon size={16} weight="bold" aria-hidden />
          </button>
        )}
      </div>

      {many && (
        <>
          <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden>
            {photos.map((photo, i) => (
              <span
                key={photo.id}
                className={cn(
                  "rounded-pill duration-base h-1.5 transition-all ease-out",
                  i === index ? "bg-ink-soft w-5" : "bg-ink/15 w-1.5",
                )}
              />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-3 top-1/2 hidden -translate-y-1/2 justify-between md:flex">
            <IconButton
              icon={PreviousIcon}
              label="Previous photo"
              variant="secondary"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
              className="duration-fast pointer-events-auto rounded-full opacity-0 transition-opacity group-hover/viewer:opacity-100 focus-visible:opacity-100 disabled:invisible"
            />
            <IconButton
              icon={NextIcon}
              label="Next photo"
              variant="secondary"
              disabled={index === photos.length - 1}
              onClick={() => onIndexChange(index + 1)}
              className="duration-fast pointer-events-auto rounded-full opacity-0 transition-opacity group-hover/viewer:opacity-100 focus-visible:opacity-100 disabled:invisible"
            />
          </div>
        </>
      )}
    </section>
  );
}
