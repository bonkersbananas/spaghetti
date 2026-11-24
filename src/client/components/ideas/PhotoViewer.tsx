import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "@/components/ui/Button";
import { NextIcon, PreviousIcon } from "@/components/ui/icons";
import { OpenLarge, openLarge } from "@/components/ui/OpenLarge";
import { Photo } from "@/components/ui/Photo";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import { useHeroName } from "@/lib/hero";
import type { PhotoView } from "@/lib/items";
import { scrollBehavior } from "@/lib/motion";
import type { PhotoZoom } from "@/lib/photo-zoom";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";
import { useWhenIdle } from "@/lib/when-idle";

interface PhotoViewerProps {
  photos: PhotoView[];
  index: number;
  onIndexChange: (index: number) => void;
  alt: string;
  className?: string;
  /**
   * On a phone, no taller than 40 % of the screen and cropped to fill it (no bands either side of a portrait photo,
   * and the page keeps its text in the first screen; a pinch still zooms): for a build with attempts, whose answers
   * are under the photo.
   */
  capOnPhone?: boolean;
  /**
   * What the photos are of ("Gear wall"): the photo opens large (ui/LargePhotos.tsx) with all of them. A click on the
   * photo does it on a computer; a phone keeps the photo for pinch, double tap and swipe (decision 0039), and a small
   * button in its corner opens it instead.
   */
  largeTitle?: string;
  /** A thumbnail strip sits under the viewer and says which photo is shown: no dots then. */
  withStrip?: boolean;
}

/** Past this many photos the dots become "2 / 16". */
const MAX_DOTS = 6;

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
      className="relative w-full shrink-0 snap-center self-stretch overflow-hidden"
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
 * nothing is cropped. Nothing on it removes or closes: removing a photo is in the strip's menu (`PhotoStrip`,
 * decision 0054), away from where a hand reaches for "back".
 */
export function PhotoViewer({
  photos,
  index,
  onIndexChange,
  alt,
  className,
  capOnPhone,
  largeTitle,
  withStrip,
}: PhotoViewerProps) {
  const isDesktop = useIsDesktop();
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow the index when it changes from outside: arrow keys, the strip. Opening on a later photo (the one a card was
  // swiped to) is there at once, so it can travel from its card.
  const placed = useRef(false);
  // Where this viewer is scrolling itself to (the index changed from outside), until it gets there or a person takes
  // over: on a busy device a smooth scroll can pause longer than the settle below waits, and the photo half in view
  // then must not count as one picked (it picked the wrong photo after Make cover moved the shown one first).
  const steering = useRef<number | null>(null);
  const current = useRef(index);
  current.current = index;
  useEffect(() => {
    // Opening on the first photo: the strip is at its start already, so there is nothing to measure.
    if (!placed.current && index === 0) {
      placed.current = true;
      return;
    }
    const el = scroller.current;
    if (!el?.clientWidth) return;
    const target = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2) {
      steering.current = target;
      el.scrollTo({ left: target, behavior: placed.current ? scrollBehavior() : "instant" });
    } else steering.current = null;
    placed.current = true;
  }, [index]);

  function onScroll() {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = scroller.current;
      if (!el?.clientWidth) return;
      if (steering.current !== null) {
        if (Math.abs(el.scrollLeft - steering.current) > 2) return;
        steering.current = null;
      }
      const next = Math.round(el.scrollLeft / el.clientWidth);
      if (next !== current.current) onIndexChange(next);
    }, 90);
  }
  // A finger, a wheel or a key on the carousel is a person scrolling: what they land on is theirs.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const takeOver = () => {
      steering.current = null;
    };
    const events = ["pointerdown", "wheel", "keydown"] as const;
    for (const type of events) el.addEventListener(type, takeOver, { passive: true });
    return () => {
      for (const type of events) el.removeEventListener(type, takeOver);
    };
  }, []);

  const many = photos.length > 1;
  const showLarge = (event: MouseEvent<HTMLElement>, start: number) =>
    openLarge(event, { photos, start, title: largeTitle ?? alt });
  return (
    <section aria-roledescription="carousel" aria-label="Photos" className={cn("group/viewer relative", className)}>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          // Reachable with Tab when it scrolls (several photos), so arrow keys can move through them without a mouse.
          tabIndex={many ? 0 : undefined}
          className={cn(
            "focus-ring bg-paper-deep flex max-h-[72dvh] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:rounded-xl [&::-webkit-scrollbar]:hidden",
            capOnPhone && "max-md:max-h-[40dvh]",
          )}
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
              {largeTitle && isDesktop ? (
                // A click opens it large (a double click zooms there, as it did here).
                <OpenLarge
                  label={`Enlarge picture ${i + 1} of ${photos.length}`}
                  onClick={(event) => showLarge(event, i)}
                  className="size-full rounded-none"
                >
                  <Photo
                    src={photoSrc(photo.id, "large")}
                    alt={many ? `${alt} (${i + 1} of ${photos.length})` : alt}
                    color={photo.color || undefined}
                    fit={capOnPhone && !isDesktop ? "cover" : "contain"}
                    eager={Math.abs(i - index) <= 1}
                    className="bg-paper-deep size-full"
                  />
                </OpenLarge>
              ) : (
                <Photo
                  src={photoSrc(photo.id, "large")}
                  alt={many ? `${alt} (${i + 1} of ${photos.length})` : alt}
                  color={photo.color || undefined}
                  fit={capOnPhone && !isDesktop ? "cover" : "contain"}
                  eager={Math.abs(i - index) <= 1}
                  className="bg-paper-deep size-full"
                />
              )}
            </ViewerFigure>
          ))}
        </div>
        {largeTitle && !isDesktop && (
          <OpenLarge
            label="Enlarge picture"
            onClick={(event) => showLarge(event, index)}
            className="bg-veil text-on-veil hover:bg-veil-strong touch-target absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full backdrop-blur-md"
          >
            <svg
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5" />
            </svg>
          </OpenLarge>
        )}
      </div>

      {many && (
        <>
          {!withStrip &&
            (photos.length <= MAX_DOTS ? (
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
            ) : (
              <p className="text-ink-soft mt-3 text-center text-sm tabular-nums" aria-hidden>
                {index + 1} / {photos.length}
              </p>
            ))}
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
