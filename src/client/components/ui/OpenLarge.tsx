import {
  type ComponentPropsWithRef,
  forwardRef,
  lazy,
  type MouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import type { PhotoView } from "@/lib/items";

// Two steps (large-photos-load.ts says why): the first one is a few bytes, and both are under way at the first point.
const load = () => import("./large-photos-load").then((step) => step.loadLargePhotos());
// The viewer is its own chunk: nothing of it is in a screen's first load. Pointing at, focusing or touching a photo
// that opens it fetches it, so it is there by the time the press ends.
const LargePhotos = lazy(load);
let fetched = false;
const prefetch = () => {
  if (fetched) return;
  fetched = true;
  void load();
};

export interface LargePhotosCaption {
  /** What the photos are of ("Attempt 3"); also the viewer's name. */
  title: string;
  /** Before the title: how it went. */
  badge?: ReactNode;
  /** Under the title: who and when. */
  detail?: ReactNode;
}

/**
 * Opens photos large (ui/LargePhotos.tsx, loaded on demand): `opens(i)` gives a photo's button what opens the viewer
 * on photo `i`, and `viewer` is the viewer to render (anywhere: it portals). Focus goes back to the button pressed.
 */
export function useLargePhotos(photos: PhotoView[], caption: LargePhotosCaption) {
  const [shown, setShown] = useState<{ start: number; open: boolean; opener: HTMLElement | null } | null>(null);
  const onClose = useCallback(() => setShown((current) => current && { ...current, open: false }), []);
  return {
    opens: (index: number) => ({
      onClick: (event: MouseEvent<HTMLElement>) => {
        // The card around it opens something else.
        event.stopPropagation();
        event.preventDefault();
        setShown({ start: index, open: true, opener: event.currentTarget });
      },
      onPointerEnter: prefetch,
      onFocus: prefetch,
      onTouchStart: prefetch,
    }),
    viewer: shown && photos.length > 0 && (
      <Suspense fallback={null}>
        <LargePhotos
          open={shown.open}
          photos={photos}
          start={Math.min(shown.start, photos.length - 1)}
          opener={shown.opener}
          onClose={onClose}
          {...caption}
        />
      </Suspense>
    ),
  };
}

/**
 * A photo that opens large when pressed: a button around the picture, with a quiet magnifier cursor on desktop and
 * the press every tile has. Give it `useLargePhotos().opens(i)` and a label that says which photo.
 */
export const OpenLarge = forwardRef<HTMLButtonElement, ComponentPropsWithRef<"button"> & { label: string }>(
  function OpenLarge({ label, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn("pressable focus-ring block cursor-zoom-in overflow-hidden", className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);
