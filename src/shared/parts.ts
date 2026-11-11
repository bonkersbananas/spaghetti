/**
 * Parts and quantities: a build may be several parts ("Hull half ×2", "Deck ×1") printed over several attempts.
 * Parts are optional; a build without them reads as it always did. An attempt says which parts it printed and
 * how many good pieces came out; the counts feed each part's progress. Pure rules shared by the Worker and the app.
 */
import type { Outcome } from "./attempts.ts";

/** One part of a build: a name, how many are needed, and optionally a photo of the build's. */
export interface Part {
  id: string;
  itemId: string;
  name: string;
  /** How many are needed (1 or more). */
  quantity: number;
  /** Order in the build's list (0 first). */
  position: number;
  /** One of the build's photos, shown small beside the part. */
  photoId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * What an attempt printed of one part: `count` pieces that came out good (or, while the print is still printing,
 * how many are on the plate). Worked and partly worked prints count; a spaghetti counts none unless a number is set.
 */
export interface AttemptPart {
  partId: string;
  count: number;
}

export const MAX_PARTS = 100;
export const MAX_PART_QUANTITY = 999;
export const MAX_PART_NAME = 80;

/** A part's name as people read it: tidied (see `tidyObjectName`) and kept short. */
export const cleanPartName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_PART_NAME);

const EXTENSION = /\.(stl|step|stp|obj|3mf|amf)$/i;
// "_1", "-2", ".3", " 4", " (5)", "[6]": which copy of an object this is, not part of its name.
const INSTANCE = /(?:[\s_.-]+|\s*[([])\d+[)\]]?$/;
const COPY = /[\s_-]*\bcopy\b[\s_-]*\d*$/i;

/**
 * An object's name from a slicer file as a part name: file extension, copy numbers ("hull_left_2") and separators
 * dropped, the first letter capitalized. "hull_left" is "Hull left".
 */
export function tidyObjectName(raw: string): string {
  let name = raw.replace(EXTENSION, "").replace(/[_]+/g, " ").trim();
  for (let i = 0; i < 2; i++) name = name.replace(COPY, "").replace(INSTANCE, "").trim();
  name = name.replace(/\s+/g, " ").replace(/^[\s.-]+|[\s.-]+$/g, "");
  if (!name) return "Part";
  return cleanPartName(name.charAt(0).toUpperCase() + name.slice(1));
}

/** Names compared without case or spacing, so "Hull Left" and "hull_left" are the same part. */
export const partKey = (name: string) => tidyObjectName(name).toLowerCase();

/** Objects of a plate, grouped: identical ones (after tidying) become one part with a quantity. In order of first appearance. */
export function partsFromObjects(objects: readonly string[]): Array<{ name: string; quantity: number }> {
  const groups = new Map<string, { name: string; quantity: number }>();
  for (const object of objects) {
    const name = tidyObjectName(object);
    const key = name.toLowerCase();
    const group = groups.get(key);
    if (group) group.quantity = Math.min(group.quantity + 1, MAX_PART_QUANTITY);
    else groups.set(key, { name, quantity: 1 });
  }
  return [...groups.values()];
}

/** A slicer file as an attempt records it: which file and plate, and the object names on that plate. */
export interface FileObjects {
  name: string;
  plate: number;
  objects: readonly string[];
}

/**
 * The parts a build's slicer files suggest: each file's plate once (a plate printed twice is not two of everything),
 * every plate's objects grouped together. Empty when no file has object names.
 */
export function partsFromFiles(files: readonly FileObjects[]): Array<{ name: string; quantity: number }> {
  const seen = new Set<string>();
  const objects: string[] = [];
  for (const file of files) {
    const key = `${file.name}#${file.plate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    objects.push(...file.objects);
  }
  return partsFromObjects(objects);
}

/** What a plate's objects are, as parts of a build: the ones that match a part by name, with how many of each. */
export function partsOnPlate(objects: readonly string[], parts: readonly Pick<Part, "id" | "name">[]): AttemptPart[] {
  const counts = new Map<string, number>();
  for (const object of objects) {
    const key = partKey(object);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const found: AttemptPart[] = [];
  for (const part of parts) {
    const count = counts.get(partKey(part.name));
    if (count) found.push({ partId: part.id, count });
  }
  return found;
}

interface CountingAttempt {
  outcome: Outcome | null;
  parts?: readonly AttemptPart[];
}

/** The good pieces of a part that an attempt gave: nothing while it still prints. */
export function goodPieces(attempt: CountingAttempt, partId: string): number {
  if (!attempt.outcome) return 0;
  return attempt.parts?.find((p) => p.partId === partId)?.count ?? 0;
}

/** On a spaghetti, nothing came out unless someone says so: its counts start at zero. */
export const zeroCounts = (parts: readonly AttemptPart[]): AttemptPart[] =>
  parts.map((p) => ({ partId: p.partId, count: 0 }));

/** The counts a plate starts with once an outcome is picked: a spaghetti counts none, worked and partly keep what was on the plate. */
export function countsForOutcome(
  parts: readonly AttemptPart[],
  outcome: Outcome | null,
  /** What was on the plate, for coming back from a spaghetti that zeroed them. */
  onPlate?: readonly AttemptPart[],
): AttemptPart[] {
  if (outcome === "failed") return zeroCounts(parts);
  // Coming back from a spaghetti (every count zeroed): what was on the plate, or one piece of each part picked.
  if (parts.length && parts.every((p) => p.count === 0)) {
    return onPlate?.length ? onPlate.map((p) => ({ ...p })) : parts.map((p) => ({ partId: p.partId, count: 1 }));
  }
  return parts.map((p) => ({ ...p }));
}

export interface PartProgress {
  part: Part;
  /** Good pieces so far, over every attempt (a finished one). */
  made: number;
  /** Pieces on a plate that is still printing. */
  printing: number;
  /** `made` has reached the quantity. */
  done: boolean;
}

export function partProgress(parts: readonly Part[], attempts: readonly CountingAttempt[]): PartProgress[] {
  return [...parts]
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .map((part) => {
      let made = 0;
      let printing = 0;
      for (const attempt of attempts) {
        made += goodPieces(attempt, part.id);
        if (!attempt.outcome) printing += attempt.parts?.find((p) => p.partId === part.id)?.count ?? 0;
      }
      return { part, made, printing, done: made >= part.quantity };
    });
}

/** Up to this many pieces a part shows one pip each; beyond a handful (12 drawer bins) only "5 of 12" says it. */
export const PIP_LIMIT = 6;

/** Whether a part shows pips: not once it is done (the check says so) and not for a big quantity. */
export const showsPips = (progress: Pick<PartProgress, "done"> & { part: Pick<Part, "quantity"> }) =>
  !progress.done && progress.part.quantity <= PIP_LIMIT;

/** "1 of 2", or "done" (more than asked for still reads "done"). */
export const progressLabel = (progress: Pick<PartProgress, "made" | "done"> & { part: Pick<Part, "quantity"> }) =>
  progress.done ? "done" : `${progress.made} of ${progress.part.quantity}`;

/** "Hull half: 1 of 2 · Deck: done" */
export const partsSummary = (progress: readonly PartProgress[]) =>
  progress.map((p) => `${p.part.name}: ${progressLabel(p)}`).join(" · ");

/** Every part is printed, and there is at least one. */
export const allPartsPrinted = (progress: readonly PartProgress[]) =>
  progress.length > 0 && progress.every((p) => p.done);

/**
 * What an attempt printed, for "attempt 3 · Hull half": part names, with ×N where more than one. Null when it names no
 * part that still exists.
 */
export function attemptPartsLabel(
  attempt: { parts?: readonly AttemptPart[] },
  parts: readonly Pick<Part, "id" | "name" | "position">[] | undefined,
): string | null {
  const names = (attempt.parts ?? [])
    .map((p) => ({ p, part: (parts ?? []).find((part) => part.id === p.partId) }))
    .filter((found): found is { p: AttemptPart; part: Pick<Part, "id" | "name" | "position"> } => !!found.part)
    .sort((a, b) => a.part.position - b.part.position)
    .map(({ p, part }) => (p.count > 1 ? `${part.name} ×${p.count}` : part.name));
  return names.length ? names.join(", ") : null;
}
