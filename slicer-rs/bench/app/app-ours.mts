// Stands in for src/client/lib/slicing/ours.ts in the slice worker run by app-slice.mts: it records what the worker
// hands Spaghetti's slicer (the setup and every object, part and paint, in order), then slices it with the real
// ours.ts and the WebAssembly module, as the app does, and keeps the answer.
import { performance } from "node:perf_hooks";
import { type OurObject, type OursAnswer, sliceOurs as realSliceOurs } from "../../../src/client/lib/slicing/ours.ts";

export type { OurObject, OurPart, OursAnswer } from "../../../src/client/lib/slicing/ours.ts";

export interface Recorded {
  setup: string;
  objects: readonly OurObject[];
  answer?: OursAnswer;
  wallMs?: number;
}

/** What the worker handed our slicer, once it has. */
export const recorded: { value: Recorded | null } = { value: null };

export async function sliceOurs(
  url: URL,
  setup: string,
  objects: readonly OurObject[],
  beforeSlice: () => void,
): Promise<OursAnswer> {
  recorded.value = { setup, objects };
  if (process.env.APP_SLICE_SKIP_WASM === "1") return { ok: false, fallback: { why: "unloaded" } };
  const started = performance.now();
  const answer = await realSliceOurs(url, setup, objects, beforeSlice);
  recorded.value.answer = answer;
  recorded.value.wallMs = performance.now() - started;
  return answer;
}
