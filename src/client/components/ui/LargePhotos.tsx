import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import type { PhotoView } from "@/lib/items";
import { scrollBehavior } from "@/lib/motion";
import type { PhotoZoom } from "@/lib/photo-zoom";
import { photoSrc } from "@/lib/previews";
import { Button, IconButton } from "./Button";
import { CloseIcon, NextIcon, PreviousIcon } from "./icons";
import { Kbd } from "./Kbd";
import { Photo } from "./Photo";
import { PhotoThumb } from "./PhotoTiles";
import { Dialog } from "./Sheet";

export interface LargePhotosProps {
  open: boolean;
  photos: PhotoView[];
  /** The photo it opens on. */
  start: number;
  /** What the photos are of, at the top ("Attempt 3", "Paddle steamer · attempt 2"); also the dialog's name. */
  title: string;
  /** Before the title: how it went (an outcome chip). */
  badge?: ReactNode;
  /** Under the title: who and when. */
  detail?: ReactNode;
  /**
   * The build the photos are from, before the title ("Star ornament · attempt 3"), where the viewer was opened away
   * from it (the Journal): its name links where `link` (the card's own link) goes, and a click on it follows that link
   * (the viewer closes first).
   */
  place?: { name: string; link: HTMLAnchorElement } | null;
  /** Where focus goes back to when it closes: the photo that opened it. */
  opener: HTMLElement | null;
  onClose: () => void;
}

/** Past this pull (px), or a flick faster than `FLICK` (px/ms), letting go of a photo dragged down closes it. */
const CLOSE_PULL = 110;
const FLICK = 0.6;

/**
 * Photos opened large, one at a time over the whole screen, on the deep paper of a viewer (not a black lightbox): the
 * whole print, never cropped, as large as the screen allows, with a soft shadow under it. Swipe (phone), arrow keys or
 * the side buttons (desktop) or the row of thumbnails go to the others; ×, Esc, a swipe down on a phone or Android's
 * Back close it, and focus goes back to the photo it was opened from. Pinch, double tap, double click and ctrl+wheel
 * zoom in place (lib/photo-zoom.ts). Opened with `openLarge` (ui/OpenLarge.tsx), which loads it on demand.
 */
export default function LargePhotos({
  open,
  photos,
  start,
  title,
  badge,
  detail,
  place,
  opener,
  onClose,
}: LargePhotosProps) {
  const [index, setIndex] = useState(start);
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const count = photos.length;
  const many = count > 1;

  // Opened again (on another photo): start there.
  const [opened, setOpened] = useState({ open, start });
  if (opened.open !== open || opened.start !== start) {
    setOpened({ open, start });
    if (open) setIndex(start);
  }

  // On the photo it was opened on before the first paint, without a scroll to watch. Radix mounts the content a
  // render after `open` turns true, so this is the strip's own ref, not an effect here.
  const startAt = useRef(start);
  startAt.current = start;
  const placeStrip = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    if (el) el.scrollLeft = startAt.current * el.clientWidth;
  }, []);

  useBackCloses(open, close);

  function go(next: number) {
    const el = scroller.current;
    if (!el || next < 0 || next >= count) return;
    setIndex(next);
    el.scrollTo({ left: next * el.clientWidth, behavior: scrollBehavior() });
  }

  // The count follows the photo most in view, so it is right while a finger is still moving.
  function onScroll() {
    const el = scroller.current;
    if (!el?.clientWidth) return;
    const next = Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
    if (next !== index) setIndex(next);
  }

  function onKeyDown(event: KeyboardEvent) {
    // Their own keys, not the registry's (shared/shortcuts.ts, in every first load): the buttons' titles say them.
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "ArrowLeft") go(index - 1);
    else if (event.key === "ArrowRight") go(index + 1);
    else return;
    event.preventDefault();
  }

  const pull = usePullDown({ stage, backdrop, chrome: [header, footer], onClose: () => close.current() });

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          aria-roledescription="photo viewer"
          // The dialog itself takes focus: arrow keys work at once, and no button shows a ring nobody asked for.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            if (!opener?.isConnected) return;
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }}
          onKeyDown={onKeyDown}
          tabIndex={-1}
          className="sg-large fixed inset-0 z-50 flex flex-col overscroll-none focus:outline-none"
        >
          <div ref={backdrop} aria-hidden className="bg-paper-deep paper-grain absolute inset-0" />

          {/* Desktop: the title row on top. Phones: under the photo, above the thumbnails, where a thumb reaches the
              close; the photo has the top of the screen, and a grabber there says it can be pulled down. */}
          <div
            ref={header}
            className="relative flex shrink-0 items-start gap-3 px-4 pt-3 max-md:order-2 md:px-6 md:pt-5 md:pb-3"
          >
            <div className="min-w-0 flex-1 md:flex-none">
              {/* Desktop: the outcome before the title. Phones: the title has the width (it may take two lines), and the
                  outcome goes under it, beside who and when. */}
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 max-md:hidden">{badge}</span>
                <Dialog.Title className="text-body md:text-title text-ink min-w-0 font-sans font-semibold max-md:line-clamp-2 md:truncate">
                  {place && (
                    <>
                      <a
                        href={place.link.href}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          event.preventDefault();
                          onClose();
                          place.link.click();
                        }}
                        className="focus-ring decoration-ink/30 rounded-xs underline-offset-4 hover:underline"
                      >
                        {place.name}
                      </a>
                      <span className="text-ink-faint font-medium"> · </span>
                    </>
                  )}
                  {title}
                </Dialog.Title>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <span className="shrink-0 md:hidden">{badge}</span>
                {detail && <p className="text-small text-ink-faint min-w-0 truncate">{detail}</p>}
              </div>
            </div>
            {many && (
              <p
                className="text-small text-ink-soft md:text-body shrink-0 pt-3 tabular-nums md:pt-1.5"
                aria-live="polite"
              >
                {index + 1} of {count}
              </p>
            )}
            <Dialog.Close asChild>
              <Button
                variant="quiet"
                icon={CloseIcon}
                shortcut={["Esc"]}
                aria-label="Close"
                title="Close (Esc)"
                className="-mr-2 shrink-0 max-md:size-11 max-md:rounded-full max-md:px-0 md:ml-auto"
              />
            </Dialog.Close>
          </div>

          <div ref={stage} {...pull} className="relative min-h-0 flex-1 max-md:order-1">
            <div
              ref={placeStrip}
              onScroll={onScroll}
              // pan-x: a finger moving sideways goes to the next photo; one moving down is the pull that closes.
              className="flex size-full [touch-action:pan-x] snap-x snap-mandatory overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {photos.map((photo, i) => (
                <LargeFigure
                  key={photo.id}
                  photo={photo}
                  label={many ? `${title}, photo ${i + 1} of ${count}` : title}
                  active={i === index}
                  near={Math.abs(i - index) <= 1}
                />
              ))}
            </div>
            <span
              aria-hidden
              className="rounded-pill bg-ink/25 pointer-events-none absolute top-[calc(var(--sg-safe-top)+0.625rem)] left-1/2 h-1 w-10 -translate-x-1/2 md:hidden"
            />
            {many && (
              <>
                <SideButton side="left" disabled={index === 0} onClick={() => go(index - 1)} />
                <SideButton side="right" disabled={index === count - 1} onClick={() => go(index + 1)} />
              </>
            )}
          </div>

          <div
            ref={footer}
            className="relative shrink-0 px-4 pt-3 pb-[max(1rem,var(--sg-safe-bottom))] max-md:order-3 md:pt-4 md:pb-6"
          >
            {many && (
              <div className="flex justify-center">
                <div className="-m-2 flex max-w-full gap-2.5 overflow-x-auto p-2 [&::-webkit-scrollbar]:hidden">
                  {photos.map((photo, i) => (
                    <PhotoThumb
                      key={photo.id}
                      size="xs"
                      src={photoSrc(photo.id, "thumb")}
                      alt={`Photo ${i + 1}`}
                      color={photo.color || undefined}
                      onSelect={() => go(i)}
                      selected={i === index}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A side button for the photo before or after, at the window's edge, its key under it (desktop only). */
function SideButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const left = side === "left";
  return (
    <div
      className={cn(
        "absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 max-md:hidden",
        left ? "left-5" : "right-5",
        disabled && "invisible",
      )}
    >
      <IconButton
        icon={left ? PreviousIcon : NextIcon}
        label={left ? "Previous photo (←)" : "Next photo (→)"}
        variant="secondary"
        disabled={disabled}
        onClick={onClick}
        className="rounded-full"
      />
      <Kbd keys={[left ? "←" : "→"]} />
    </div>
  );
}

/**
 * One photo, centred in its page of the strip at its own shape: a box of exactly the picture's proportions as large as
 * the page allows (container units), so its corners round and its shadow falls on the picture, not on bars beside it.
 * The page is the zoom's frame, so a zoomed photo can fill the whole stage.
 */
function LargeFigure({
  photo,
  label,
  active,
  near,
}: {
  photo: PhotoView;
  label: string;
  active: boolean;
  near: boolean;
}) {
  const frame = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const zoom = useRef<PhotoZoom | null>(null);
  useEffect(() => {
    const el = frame.current;
    const inner = layer.current;
    if (!el || !inner) return;
    let gone = false;
    // Its own chunk, as PhotoViewer loads it (already fetched where a hero photo was shown).
    void import("@/lib/photo-zoom").then((module) => {
      if (!gone) zoom.current = module.attachPhotoZoom(el, inner);
    });
    return () => {
      gone = true;
      zoom.current?.destroy();
      zoom.current = null;
    };
  }, []);
  // Another photo shown: this one goes back to fitted.
  useEffect(() => {
    if (!active) zoom.current?.reset(true);
  }, [active]);

  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3;
  return (
    <figure
      ref={frame}
      aria-label={label}
      aria-hidden={!active || undefined}
      className="relative size-full shrink-0 snap-center snap-always overflow-hidden"
    >
      <div
        ref={layer}
        className="[container-type:size] flex size-full items-center justify-center px-0 will-change-transform md:px-24"
      >
        <div
          // Phones: the whole page, the photo contained on a glow of its own colours (no bare paper above and below a
          // landscape photo). Desktop: a box of the photo's own shape, its corners rounded on the paper.
          className="md:shadow-raised relative overflow-hidden max-md:!aspect-auto max-md:!h-full max-md:!w-full md:rounded-lg"
          // The picture's own proportions are data: the box is exactly its shape at the largest size that fits.
          style={
            {
              "--ratio": ratio,
              aspectRatio: String(ratio),
              width: "min(100cqw, 100cqh * var(--ratio))",
            } as CSSProperties
          }
        >
          <Photo
            src={photoSrc(photo.id, "large")}
            preview={photoSrc(photo.id, "thumb")}
            alt={label}
            color={photo.color || undefined}
            fit="contain"
            glow
            frame="deep"
            eager={near}
            className="size-full"
          />
        </div>
      </div>
    </figure>
  );
}

/**
 * The phone's Back (Android's button or gesture) closes the photo instead of leaving the page: a close watcher, the
 * browser's own way for an overlay to take one Back, with no history entry for the router to hear about. Where the
 * browser has none (Safari, Firefox), Back leaves the page as before; ×, Esc and the swipe down still close it.
 */
function useBackCloses(open: boolean, onClose: { current: () => void }) {
  useEffect(() => {
    const Watcher = (window as { CloseWatcher?: new () => CloseWatcher }).CloseWatcher;
    if (!open || !Watcher) return;
    const watcher = new Watcher();
    watcher.onclose = () => onClose.current();
    return () => watcher.destroy();
  }, [open, onClose]);
}

/** The browser's close watcher (not in TypeScript's DOM types yet). */
interface CloseWatcher {
  onclose: (() => void) | null;
  destroy: () => void;
}

/**
 * A phone's swipe down closes the photo: one finger moving down more than sideways drags it down, the paper behind
 * fading, and letting go past `CLOSE_PULL` (or flicking) closes; short of it, it settles back. Never while the photo
 * is zoomed (the zoom pans then) or with two fingers (a pinch).
 */
function usePullDown({
  stage,
  backdrop,
  chrome,
  onClose,
}: {
  stage: RefObject<HTMLDivElement | null>;
  backdrop: RefObject<HTMLDivElement | null>;
  /** The title and the thumbnails: they fade sooner than the paper. */
  chrome: RefObject<HTMLDivElement | null>[];
  onClose: () => void;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    dy: number;
    /** Where the finger was last, and when: how fast it was moving as it let go. */
    lastY: number;
    lastT: number;
    speed: number;
    pulling: boolean | null;
  } | null>(null);

  function paint(dy: number, settle: boolean) {
    const el = stage.current;
    if (!el) return;
    const transition = settle ? "var(--sg-duration-fast) var(--sg-ease-out)" : "0s";
    el.style.transition = `transform ${transition}`;
    el.style.transform = dy ? `translate3d(0, ${dy}px, 0) scale(${1 - Math.min(dy, 400) / 2000})` : "";
    const fade = (target: HTMLElement | null | undefined, to: number) => {
      if (!target) return;
      target.style.transition = `opacity ${transition}`;
      target.style.opacity = dy ? String(to) : "";
    };
    fade(backdrop.current, 1 - Math.min(dy / 320, 0.7));
    for (const part of chrome) fade(part.current, 1 - Math.min(dy / 90, 1));
  }

  return {
    onTouchStart(event: TouchEvent) {
      const zoomed = (event.target as Element).closest("[data-zoom=in]");
      if (event.touches.length !== 1 || zoomed) {
        if (drag.current?.pulling) paint(0, true);
        drag.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      drag.current = {
        x: touch.clientX,
        y: touch.clientY,
        dy: 0,
        lastY: touch.clientY,
        lastT: event.timeStamp,
        speed: 0,
        pulling: null,
      };
    },
    onTouchMove(event: TouchEvent) {
      const state = drag.current;
      const touch = event.touches[0];
      if (!state || !touch || event.touches.length !== 1) return;
      const dx = touch.clientX - state.x;
      const dy = touch.clientY - state.y;
      if (state.pulling === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        state.pulling = dy > 0 && dy > Math.abs(dx);
        if (!state.pulling) return;
      }
      if (!state.pulling) return;
      // Upward it barely gives; downward it follows the finger.
      state.dy = dy > 0 ? dy : dy / 4;
      const elapsed = event.timeStamp - state.lastT;
      if (elapsed > 0) state.speed = (touch.clientY - state.lastY) / elapsed;
      state.lastY = touch.clientY;
      state.lastT = event.timeStamp;
      paint(state.dy, false);
    },
    onTouchEnd() {
      const state = drag.current;
      drag.current = null;
      if (!state?.pulling) return;
      if (state.dy > CLOSE_PULL || (state.dy > 30 && state.speed > FLICK)) {
        paint(state.dy + 80, true);
        onClose();
      } else paint(0, true);
    },
    onTouchCancel() {
      if (drag.current?.pulling) paint(0, true);
      drag.current = null;
    },
  };
}
