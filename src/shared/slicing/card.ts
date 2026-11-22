/**
 * What a sliced model's card says, in words: the app's card (components/builds/ModelFile.tsx) and the shared page's
 * (worker/guest, decision 0077) both say it with these, so a guest reads the same figures the two people do.
 */
import type { AttemptSettings } from "../attempts.ts";
import { formatDuration } from "../time.ts";
import { readSize, sizeWords } from "./size.ts";
import type { FileSlice } from "./types.ts";

/** "10.6 g", "1,204 g". */
export const gramsWords = (value: number) => `${value.toLocaleString("en", { maximumFractionDigits: 1 })} g`;

/** "About 36 min · 10.6 g": what a sliced model's card leads with. */
export function sliceLead(
  prefill: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams"> | undefined,
  copies?: number,
): string[] {
  return [
    copies && copies > 1 ? `× ${copies}` : "",
    prefill?.estimatedMinutes !== undefined ? `About ${formatDuration(prefill.estimatedMinutes)}` : "",
    prefill?.weightGrams !== undefined ? gramsWords(prefill.weightGrams) : "",
  ].filter(Boolean);
}

/** "About 21 min · 28 g each": what one of the copies takes, a plate's figures over how many there are. */
export function perPiece(
  prefill: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams"> | undefined,
  copies?: number,
): string {
  if (!copies || copies < 2) return "";
  return [
    prefill?.estimatedMinutes !== undefined ? `About ${formatDuration(prefill.estimatedMinutes / copies)}` : "",
    prefill?.weightGrams !== undefined ? gramsWords(Math.round((prefill.weightGrams / copies) * 10) / 10) : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .concat(prefill?.estimatedMinutes !== undefined || prefill?.weightGrams !== undefined ? " each" : "");
}

/** "29.96 × 11.5 × 11.35 mm" (each, with copies): what one copy measures, width × depth × height. */
export function sizePiece(slice: Pick<FileSlice, "size" | "copies">): string {
  const size = readSize(slice.size);
  return size ? `${sizeWords(size)}${slice.copies && slice.copies > 1 ? " each" : ""}` : "";
}
