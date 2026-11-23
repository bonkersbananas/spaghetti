import type { QueryClient } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import type { LargePhotosProps } from "./LargePhotos";

/** What a card hands over to open its photos large: the photos, the one to start on, and what they are of. */
export type LargePhotosView = Omit<LargePhotosProps, "open" | "onClose" | "opener"> & {
  /**
   * For a photo that is the only one known of its attempt (a search result): the query client and the id of its build.
   * Once the build has come, the photos of that attempt replace the one, when there are more and the first leads them;
   * a failure leaves things as they were.
   */
  more?: [QueryClient, string];
};

/**
 * Photos opened large live in a React root of their own, made the first time one opens: the cards that open them
 * then carry no viewer, no state and no list of the viewer's chunks (a dynamic import names every chunk it needs:
 * about 1.4 kB gzip for this one), which keeps them out of the first load of the screens that show those cards. The
 * viewer itself is one more step away, fetched as soon as this file is (a photo pointed at, focused or touched).
 */
const loadViewer = () => import("./LargePhotos");
// In the app's entry already; imported statically, its place there would put the entry's whole list in this chunk's.
const loadRoot = () => import("@/lib/react-root");

// Loading this file is what a point or a touch asks for: the viewer is fetched as soon as it is there.
void loadViewer();

let root: Root | null = null;
let shown: Omit<LargePhotosProps, "open" | "onClose"> | null = null;

export async function showLargePhotos(
  view: Omit<LargePhotosProps, "open" | "onClose"> & Pick<LargePhotosView, "more">,
) {
  const [{ default: LargePhotos }, { createRoot, createElement }] = await Promise.all([loadViewer(), loadRoot()]);
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  const { more, ...props } = view;
  shown = props;
  // Back or a swipe back where there is no close watcher (Safari, Firefox) changes the page under it: it closes with
  // the page it was opened on, rather than showing that page's photos over another.
  const onPageChange = () => draw(false);
  let isOpen = true;
  const draw = (open: boolean) => {
    isOpen = open;
    if (open) window.addEventListener("popstate", onPageChange);
    else window.removeEventListener("popstate", onPageChange);
    // Closed, it stays mounted until it has faded out (Radix waits for the animation), and the next opening reuses it.
    // createElement, not JSX: no static import at all keeps the list a card carries to load this file to itself.
    if (shown) root?.render(createElement(LargePhotos, { ...shown, open, onClose: () => draw(false) }));
  };
  draw(true);
  if (more) {
    // Imported here, not at the top: the cards that open photos name this file's imports in their own.
    const { itemQuery } = await import("@/lib/items");
    const [first] = props.photos;
    void more[0].ensureQueryData(itemQuery(more[1])).then(
      (built) => {
        const photos = built?.photos.filter((photo) => photo.attemptId === first?.attemptId);
        // Still this one's, and still open (not closed, and nothing else opened, in the meantime).
        if (photos && photos.length > 1 && photos[0]?.id === first?.id && shown === props && isOpen) {
          shown = { ...props, photos };
          draw(true);
        }
      },
      () => {},
    );
  }
}
