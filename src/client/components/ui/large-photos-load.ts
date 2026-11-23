/**
 * The way to the large photos' viewer, in a chunk of its own: a dynamic import carries the list of every chunk the
 * imported one needs (Vite preloads them together), and the viewer's list is long (about 1.4 kB gzip). Imported from
 * here, that list stays out of the first load of every screen that shows a photo which opens large.
 */
export const loadLargePhotos = () => import("./LargePhotos");
