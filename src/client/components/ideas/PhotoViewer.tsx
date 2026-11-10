import { type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "@/components/ui/Button";
import { NextIcon, PreviousIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import { useHeroName } from "@/lib/hero";
import type { PhotoView } from "@/lib/items";
import { scrollBehavior } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";

interface PhotoViewerProps {
  photos: PhotoView[];
  index: number;
  onIndexChange: (index: number) => void;
  alt: string;
  className?: string;
}

/** Keeps the frame between 4:5 and 4:3, shaped by the cover. */
function frameAspect(photo: PhotoView | undefined): number {
  if (!photo) return 4 / 3;
  return Math.min(4 / 3, Math.max(4 / 5, photo.width / photo.height));
}

/** One photo's frame in the carousel; it takes the hero transition's name when it is the photo that was tapped on a card. */
function ViewerFigure({ photo, label, children }: { photo: PhotoView; label: string; children: ReactNode }) {
  return (
    <figure aria-label={label} style={useHeroName(photo.id)} className="relative h-full w-full shrink-0 snap-center">
      {children}
    </figure>
  );
}

/**
 * Big photos first. Swipe between them on a phone (native scroll snapping),
 * or use the arrow buttons and keys on desktop. The whole print shows:
 * nothing is cropped.
 */
export function PhotoViewer({ photos, index, onIndexChange, alt, className }: PhotoViewerProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow the index when it changes from outside: arrow keys, the strip.
  useEffect(() => {
    const el = scroller.current;
    if (!el?.clientWidth) return;
    const target = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2) el.scrollTo({ left: target, behavior: scrollBehavior() });
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
      <div
        ref={scroller}
        onScroll={onScroll}
        className="bg-paper-deep flex max-h-[72dvh] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:rounded-xl [&::-webkit-scrollbar]:hidden"
        style={{ aspectRatio: frameAspect(photos[0]), scrollbarWidth: "none" }}
      >
        {photos.map((photo, i) => (
          <ViewerFigure key={photo.id} photo={photo} label={`${i + 1} of ${photos.length}`}>
            <Photo
              src={photoSrc(photo.id, "large")}
              alt={many ? `${alt} (${i + 1} of ${photos.length})` : alt}
              color={photo.color || undefined}
              fit="contain"
              eager={Math.abs(i - index) <= 1}
              className="bg-paper-deep size-full"
            />
            {photo.upload && (
              <UploadBadge
                state={photo.upload.status === "queued" ? "queued" : photo.upload.status}
                progress={photo.upload.progress}
                className="absolute bottom-3 left-3"
              />
            )}
          </ViewerFigure>
        ))}
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
