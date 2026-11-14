/// <reference lib="webworker" />
import { readModel3mf, readModelPlatePicture } from "@shared/slicing/model3mf.ts";
import { renderPlate } from "@shared/slicing/render.ts";

/**
 * Draws each plate of a 3MF project for the plate picker: the app's own plate picture of that plate's objects (the
 * warm studio look the "Lay it down" tiles use), after the project's own picture of it (Bambu's grey and green
 * render), sent first as a quick placeholder and kept where ours can't be drawn. `plates.ts` is the way in.
 */

export interface PlatesRequest {
  file: Blob;
  /** "#rrggbb" of the filament the pictures are drawn in. */
  colour: string;
  /** Pixels, square. */
  size: number;
}

export interface DrawnPlate {
  index: number;
  name: string;
  objects: string[];
  /** mm. */
  height: number;
  /** The project's own picture of it. */
  placeholder: Blob | null;
  /** Ours. */
  png: Blob | null;
}

/** "plates" twice: first with the project's pictures, then with ours (`final`); "none" for a file with fewer than two plates. */
export type PlatesMessage = { type: "plates"; plates: DrawnPlate[]; final: boolean } | { type: "none" };

self.onmessage = (event: MessageEvent<PlatesRequest>) => {
  void run(event.data).catch(() => self.postMessage({ type: "none" } satisfies PlatesMessage));
};

async function toPng(pixels: Uint8ClampedArray, size: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "function") return null;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
  return await canvas.convertToBlob({ type: "image/png" });
}

async function run(request: PlatesRequest) {
  const bytes = new Uint8Array(await request.file.arrayBuffer());
  const first = readModel3mf(bytes);
  if (typeof first === "string" || first.plates.length < 2)
    return self.postMessage({ type: "none" } satisfies PlatesMessage);
  const plates: DrawnPlate[] = first.plates.map((plate) => {
    const picture = plate.picture ? readModelPlatePicture(bytes, plate.picture) : undefined;
    return {
      index: plate.index,
      name: plate.name,
      objects: plate.objects,
      height: plate.height,
      placeholder: picture ? new Blob([picture.slice()], { type: "image/png" }) : null,
      png: null,
    };
  });
  self.postMessage({ type: "plates", plates, final: false } satisfies PlatesMessage);
  // Every plate is framed by all of them: one scale and one ground line, so heights read as they are.
  const read = first.plates.map((plate) => {
    const model = readModel3mf(bytes, { plate: plate.index });
    return typeof model === "string" ? [] : model.objects.map((object) => object.positions);
  });
  const fit = read.flat();
  for (const [at, plate] of plates.entries()) {
    try {
      const objects = read[at] ?? [];
      if (!objects.length) continue;
      const pixels = renderPlate(objects, { size: request.size, colour: request.colour, fit });
      plate.png = await toPng(pixels, request.size);
    } catch {
      // Its placeholder stays.
    }
  }
  self.postMessage({ type: "plates", plates, final: true } satisfies PlatesMessage);
}
