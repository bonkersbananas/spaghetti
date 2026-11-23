import { type ComponentPropsWithRef, forwardRef, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import type { LargePhotosView } from "./large-photos-load";

// Everything but these few lines loads when a photo is first pointed at, focused or touched (large-photos-load.tsx).
const load = () => import("./large-photos-load");

/** Fetches the viewer, so it is there by the time the press ends. */
export const prefetchLarge = () => void load().then((step) => step.prefetchLargePhotos());

/**
 * Opens `view.photos` large over the page, at `view.start` (ui/LargePhotos.tsx). Put on a photo button's click: the
 * card around it opens something else, and focus goes back to the button when the photo closes.
 */
export function openLarge(event: MouseEvent<HTMLElement>, view: LargePhotosView) {
  event.preventDefault();
  event.stopPropagation();
  const opener = event.currentTarget;
  void load().then((step) => step.showLargePhotos({ ...view, opener }));
}

/**
 * Opens photos large from a photo that sits inside a link (a row, a card), where a button can't go: the photo's click
 * handler calls this, and the link's own area keeps leading where it did. Modified clicks (a new tab) stay the link's;
 * focus goes back to the link. Returns the opener (or null when nothing opened), to show the view again with more.
 */
export function openLargeFromLink(event: MouseEvent<HTMLElement>, view: LargePhotosView): HTMLElement | null {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  event.preventDefault();
  event.stopPropagation();
  const opener = event.currentTarget.closest("a") ?? event.currentTarget;
  void load().then((step) => step.showLargePhotos({ ...view, opener }));
  return opener;
}

/** Shows an open viewer's photos again with more of them (the rest of an attempt's, once they have arrived). */
export const showLargeAgain = (view: LargePhotosView & { opener: HTMLElement | null }) =>
  void load().then((step) => step.showLargePhotos(view));

/**
 * A photo that opens large when pressed: a button around the picture, with a zoom cursor on desktop and the press
 * every tile has. Its `onClick` calls `openLarge`; its label says which photo.
 */
export const OpenLarge = forwardRef<HTMLButtonElement, ComponentPropsWithRef<"button"> & { label: string }>(
  function OpenLarge({ label, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        onPointerEnter={prefetchLarge}
        onFocus={prefetchLarge}
        onTouchStart={prefetchLarge}
        className={cn("pressable focus-ring block cursor-zoom-in overflow-hidden", className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);
