import type { Root } from "react-dom/client";
import type { LargePhotosProps } from "./LargePhotos";

/** What a card hands over to open its photos large: the photos, the one to start on, and what they are of. */
export type LargePhotosView = Omit<LargePhotosProps, "open" | "onClose" | "opener">;

/**
 * Photos opened large live in a React root of their own, made the first time one opens: the cards that open them
 * then carry no viewer, no state and no list of the viewer's chunks (a dynamic import names every chunk it needs:
 * about 1.4 kB gzip for this one), which keeps them out of the first load of the screens that show those cards. The
 * viewer itself is one more step away, fetched as soon as a photo is pointed at (`prefetchLargePhotos`).
 */
const loadViewer = () => import("./LargePhotos");
// In the app's entry already; imported statically, its place there would put the entry's whole list in this chunk's.
const loadRoot = () => import("@/lib/react-root");

export const prefetchLargePhotos = () => void loadViewer();

let root: Root | null = null;
let shown: Omit<LargePhotosProps, "open" | "onClose"> | null = null;

export async function showLargePhotos(view: Omit<LargePhotosProps, "open" | "onClose">) {
  const [{ default: LargePhotos }, { createRoot }] = await Promise.all([loadViewer(), loadRoot()]);
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  shown = view;
  const draw = (open: boolean) => {
    // Closed, it stays mounted until it has faded out (Radix waits for the animation), and the next opening reuses it.
    if (shown) root?.render(<LargePhotos {...shown} open={open} onClose={() => draw(false)} />);
  };
  draw(true);
}
