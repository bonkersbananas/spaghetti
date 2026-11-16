/**
 * The one rule for which photo a thing leads with, on its page and everywhere it shows a picture (cards, Today,
 * the Journal's Now, the sidebar, link previews): the browser (client `lib/previews.ts` coverOf) and the Worker
 * (`worker/previews.ts`, what a shared link unfurls with) both pick it here, so they never disagree.
 *
 * 1. the build's final photo (`coverPhotoId`, set when it is done);
 * 2. else its own first photo (an idea's, kept when it was started);
 * 3. else the newest photo of the latest attempt that worked;
 * 4. else the newest photo of any attempt.
 *
 * An idea has only its own photos, so this is simply its first one. Without any photo a thing shows its newest plate
 * picture, then its note card (`pickCover`).
 */

interface CoverPhoto {
  id: string;
  attemptId: string | null;
  createdAt: number;
}

const newest = <P extends CoverPhoto>(photos: readonly P[]) =>
  photos.reduce<P | undefined>((best, photo) => (!best || photo.createdAt > best.createdAt ? photo : best), undefined);

/**
 * The best photo, from photos in their order (`position`) and the attempts oldest first. Photos of deleted attempts
 * must already be left out.
 */
export function bestPhoto<P extends CoverPhoto>(
  photos: readonly P[],
  attempts: readonly { id: string; outcome: string | null }[],
  coverPhotoId: string | null | undefined,
): P | undefined {
  const cover = coverPhotoId ? photos.find((photo) => photo.id === coverPhotoId) : undefined;
  if (cover) return cover;
  const own = photos.find((photo) => !photo.attemptId);
  if (own) return own;
  return finalPhoto(photos, attempts);
}

/** The newest photo of the latest attempt that worked, else the newest of any attempt: a done build's final photo. */
export function finalPhoto<P extends CoverPhoto>(
  photos: readonly P[],
  attempts: readonly { id: string; outcome: string | null }[],
): P | undefined {
  const worked = attempts.findLast((attempt) => attempt.outcome === "success");
  const workedPhotos = worked ? photos.filter((photo) => photo.attemptId === worked.id) : [];
  return newest(workedPhotos) ?? newest(photos.filter((photo) => photo.attemptId)) ?? photos[0];
}

/**
 * What a thing shows where its picture goes:
 *
 * 1. `photo`: the best photo (`bestPhoto`);
 * 2. else `plate`: the newest plate picture of its files (its own, or an attempt's; `file` first when it has one), a
 *    render shown whole on the render ground and labeled "From the model" where there is room, so nobody takes it for
 *    the result;
 * 3. else `note`: the note card, the note on an index card; the title stands in for a missing note (`fromTitle`), so
 *    whoever shows it leaves the title out and doesn't say it twice.
 */
export type Cover<P, F> =
  | { kind: "photo"; photo: P }
  | { kind: "plate"; file: F }
  | { kind: "note"; text: string; fromTitle: boolean };

interface CoverFile {
  id: string;
  hasThumb: boolean;
  createdAt: number;
}

/** An idea or build: as the app's lists hold it, or as the journal sends it. */
export interface Coverable<P extends CoverPhoto, F extends CoverFile> {
  photos: readonly P[];
  /** Oldest first. */
  attempts: readonly { id: string; outcome: string | null; file: F | null }[];
  coverPhotoId?: string | null;
  files?: readonly F[];
  title: string | null;
  note: string;
}

export function pickCover<P extends CoverPhoto, F extends CoverFile>(
  item: Coverable<P, F>,
  options: { file?: F | null; hasPicture?: (file: F) => boolean } = {},
): Cover<P, F> {
  const hasPicture = options.hasPicture ?? ((file: F) => file.hasThumb);
  const photo = bestPhoto(item.photos, item.attempts, item.coverPhotoId);
  if (photo) return { kind: "photo", photo };
  const plate = options.file && hasPicture(options.file) ? options.file : newestPictured(item, hasPicture);
  if (plate) return { kind: "plate", file: plate };
  const note = item.note.trim();
  return note
    ? { kind: "note", text: note, fromTitle: false }
    : { kind: "note", text: item.title ?? "", fromTitle: true };
}

/** The newest of a thing's files (its own and its attempts') with a plate picture. */
export function newestPictured<F extends CoverFile>(
  item: { files?: readonly F[]; attempts: readonly { file: F | null }[] },
  hasPicture: (file: F) => boolean = (file) => file.hasThumb,
): F | undefined {
  let newest: F | undefined;
  const consider = (file: F | null | undefined) => {
    if (file && hasPicture(file) && (!newest || file.createdAt >= newest.createdAt)) newest = file;
  };
  for (const file of item.files ?? []) consider(file);
  for (const attempt of item.attempts) consider(attempt.file);
  return newest;
}
