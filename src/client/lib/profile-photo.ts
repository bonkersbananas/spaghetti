import type { Person, SessionResponse } from "@shared/api";
import { type CropView, cropRect } from "@shared/crop";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { encode, pickType, UnreadablePhotoError } from "./images";
import { peopleQuery, rememberUser, sessionQuery } from "./queries";

/** The picture is stored square at this size: sharp at 48 px on a 3x screen with room to spare. */
export const PROFILE_PHOTO_EDGE = 256;

/** Decodes a camera or library file upright, or says it can't be opened. */
export async function decodePicture(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UnreadablePhotoError(file);
  }
}

/** Cuts the cropped square out of the picture and encodes it (WebP, or JPEG where the browser can't). */
export async function renderProfilePicture(bitmap: ImageBitmap, view: CropView): Promise<Blob> {
  const { sx, sy, side } = cropRect(bitmap.width, bitmap.height, view);
  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_PHOTO_EDGE;
  canvas.height = PROFILE_PHOTO_EDGE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, PROFILE_PHOTO_EDGE, PROFILE_PHOTO_EDGE);
  return encode(canvas, await pickType(canvas), 0.86);
}

/** Shows `photoUrl` as the signed-in person's picture in the session and in the people list. */
function showMine(queryClient: QueryClient, photoUrl: string | null) {
  const me = queryClient.getQueryData(sessionQuery.queryKey);
  if (!me) return;
  const mine = { ...me, photoUrl };
  queryClient.setQueryData(sessionQuery.queryKey, mine);
  rememberUser(mine);
  queryClient.setQueryData(peopleQuery.queryKey, (people?: Person[]) =>
    people?.map((person) => (person.id === me.id ? { ...person, photoUrl } : person)),
  );
}

async function upload(blob: Blob) {
  const form = new FormData();
  form.set("photo", blob, "me");
  return (await api<SessionResponse>("/people/me/photo", { method: "PUT", body: form })).user.photoUrl;
}

/**
 * Sets (or with null removes) your picture at once and sends it in the background, with Undo that puts the
 * one before back (its bytes are read first: the server deletes them once the new one is saved).
 */
export function changeMyPhoto(queryClient: QueryClient, next: Blob | null) {
  const me = queryClient.getQueryData(sessionQuery.queryKey);
  if (!me) return;
  const before = me.photoUrl;
  const previous = before
    ? fetch(before)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null)
    : Promise.resolve(null);
  const preview = next ? URL.createObjectURL(next) : null;
  showMine(queryClient, preview);

  const send = async (blob: Blob | null) => {
    const url = blob
      ? await upload(blob)
      : (await api<SessionResponse>("/people/me/photo", { method: "DELETE" })).user.photoUrl;
    showMine(queryClient, url);
  };
  const saved = (async () => {
    await previous;
    await send(next);
  })().catch(() => {
    showMine(queryClient, before);
    toast.error(next ? "Couldn't save your picture" : "Couldn't remove your picture", "It's back as it was.");
    return false;
  });

  toast.undo(next ? (before ? "Picture changed" : "Picture added") : "Picture removed", {
    onUndo: async () => {
      if (!(await saved)) return;
      const old = await previous;
      if (before && !old) {
        toast.error("Couldn't put the old picture back", "Choose it again from your photos.");
        return;
      }
      showMine(queryClient, before);
      try {
        await send(old);
      } catch {
        void queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
        toast.error("Couldn't put the old picture back", "Try again in a moment.");
      }
    },
  });
  // The preview's object URL stays until the server's address replaces it, a moment later.
  void saved.then(() => preview && setTimeout(() => URL.revokeObjectURL(preview), 5000));
}
