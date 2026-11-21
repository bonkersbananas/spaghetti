import { toast } from "@/components/ui/Toast";

/**
 * What an input picked, read into memory before the input is cleared. A camera's photo on iOS is backed by a temporary
 * file that goes with the input's value, and a photo read after `value = ""` may come out empty or unreadable. Also
 * never a silent loss: a file that can't be read says so.
 */
export async function takePicked(input: HTMLInputElement): Promise<File[]> {
  const files: File[] = [];
  let failed = 0;
  // One at a time: a pick of many full-size photos must not sit in memory twice over, all at once.
  for (const file of Array.from(input.files ?? [])) {
    try {
      // The input only offers photos: one that comes with no type and no extension (it happens) is a JPEG.
      const named = !file.type && !/\.\w+$/.test(file.name);
      files.push(
        new File([await file.arrayBuffer()], named ? `${file.name || "photo"}.jpg` : file.name, {
          type: file.type || (named ? "image/jpeg" : ""),
          lastModified: file.lastModified,
        }),
      );
    } catch {
      failed++;
    }
  }
  input.value = "";
  if (failed)
    toast.error(
      failed === 1 ? "Couldn't read a photo" : `Couldn't read ${failed} photos`,
      "Take it again, or add it from the library.",
    );
  return files;
}
