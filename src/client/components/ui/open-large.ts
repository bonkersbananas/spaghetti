import type { MouseEvent } from "react";
import type { LargePhotosView } from "./large-photos-load";

// Everything but these few lines loads when a photo is first pointed at, focused or touched (large-photos-load.tsx).
// This file is what a card that opens photos imports: no component, so a card that never uses the button takes none.
const load = () => import("./large-photos-load");

/** Fetches the viewer, so it is there by the time the press ends. */
export const prefetchLarge = () => void load();

/**
 * Opens `view.photos` large over the page, at `view.start` (ui/LargePhotos.tsx). Put on a photo's click: the card
 * around it opens something else, and focus goes back to what was clicked when it closes. `inLink` is for a click on
 * a link's photo (a row, a card), where a button can't go: the link keeps the rest of its area, and a modified click
 * (a new tab) stays the link's.
 */
export function openLarge(event: MouseEvent<HTMLElement>, view: LargePhotosView, inLink = false) {
  if (inLink && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
  event.preventDefault();
  event.stopPropagation();
  const opener = event.currentTarget;
  void load().then((step) => step.showLargePhotos({ ...view, opener }));
}
