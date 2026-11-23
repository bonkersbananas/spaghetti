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
