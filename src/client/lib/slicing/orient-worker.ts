/// <reference lib="webworker" />
import { boundsOf, layMeshDown, type Mesh, parseStl, restingFaces } from "@shared/mesh";
import { finiteTriangles } from "@shared/slicing/fit.ts";
import { readModel3mf } from "@shared/slicing/model3mf.ts";
import { renderPlate } from "@shared/slicing/render.ts";
import type { Orientation } from "@shared/slicing/settings.ts";

/**
 * Finds the faces a model can rest on and draws it lying on each, for the settings' "Lay it down" tiles: the same
 * plate picture the app draws for a slice (shared/slicing/render.ts), small. Off the main thread, because the hull
 * of a big mesh takes a moment. `orientations.ts` is the way in.
 */

export interface OrientRequest {
  file: Blob;
  name: string;
  /** "#rrggbb" of the filament the pictures are drawn in. */
  colour: string;
  /** Pixels, square. */
  size: number;
}

export interface OrientOption {
  /** null: the model as its file lies. */
  down: Orientation | null;
  /** mm² of the face it rests on. */
  area: number;
  /** How tall it stands in this orientation, mm. */
  height: number;
  png: Blob | null;
}

export type OrientMessage = { type: "done"; options: OrientOption[] } | { type: "failed" };

/** Faces that are the file's own bottom (within this angle) are "As designed", not another choice. */
const SAME_AS_FILE_DEGREES = 3;
/** As designed and five others at most. */
const MOST = 5;

self.onmessage = (event: MessageEvent<OrientRequest>) => {
  void run(event.data).catch(() => self.postMessage({ type: "failed" } satisfies OrientMessage));
};

/** All of the model's triangles in one mesh; null when it can't be read. */
async function readMesh(file: Blob): Promise<Mesh | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const model = readModel3mf(bytes);
    if (typeof model === "string") return null;
    const parts = model.objects.map((object) => object.positions);
    const positions = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      positions.set(part, at);
      at += part.length;
    }
    return { positions };
  }
  const parsed = parseStl(bytes);
  if (!parsed.ok) return null;
  return { positions: finiteTriangles(parsed.mesh.positions) };
}

async function picture(mesh: Mesh, request: OrientRequest): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "function") return null;
  try {
    const pixels = renderPlate([mesh.positions], { size: request.size, colour: request.colour });
    const canvas = new OffscreenCanvas(request.size, request.size);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), request.size, request.size), 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } catch {
    return null;
  }
}

async function run(request: OrientRequest) {
  const mesh = await readMesh(request.file);
  if (!mesh || !mesh.positions.length) return self.postMessage({ type: "failed" } satisfies OrientMessage);
  const limit = Math.cos((SAME_AS_FILE_DEGREES * Math.PI) / 180);
  const faces = restingFaces(mesh, MOST + 1).filter((face) => -face.down[2] < limit);
  const options: OrientOption[] = [];
  const asFile = { positions: layMeshDown(mesh, [0, 0, -1]).positions };
  // Its own bottom's area is whichever face lies flat already, if any (not worth a second hull: left out).
  options.push({ down: null, area: 0, height: boundsOf(asFile).size[2], png: await picture(asFile, request) });
  for (const face of faces.slice(0, MOST)) {
    const turned = layMeshDown(mesh, face.down);
    options.push({
      down: face.down,
      area: face.area,
      height: boundsOf(turned).size[2],
      png: await picture(turned, request),
    });
  }
  self.postMessage({ type: "done", options } satisfies OrientMessage);
}
