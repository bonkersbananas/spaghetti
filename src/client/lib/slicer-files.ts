import { type AttemptFile, MAX_MODEL_FILE_BYTES, MAX_SLICER_FILE_BYTES, type Spool } from "@shared/api";
import type { AttemptFilament, AttemptSettings } from "@shared/attempts";
import { isStlName } from "@shared/slicing/files.ts";
import type { FileKind } from "@shared/slicing/types.ts";
import { filamentFromSpool, matchFilaments } from "@shared/spools";
import { printablePlates, settingsFromFile, slicerName } from "@shared/threemf/prefill.ts";
import type { Plate, ThreeMfResult } from "@shared/threemf/types.ts";
import type { QueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef } from "react";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { type AttemptView, patchCachedItem } from "./items";
import { outbox } from "./outbox";

/** Sliced .gcode.3mf from Bambu Studio and Orca Slicer, and models to slice: .stl and plain .3mf. */
export const SLICER_ACCEPT = ".3mf,.stl,model/3mf,model/stl,application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
export const isSlicerFile = (file: File) => /\.(3mf|stl)$/i.test(file.name);

/** A file read in the browser, before it is on an attempt: a slicer's file, or a model that Spaghetti slices. */
export interface SlicerFileDraft {
  id: string;
  file: File;
  /** What the file says; for a model, what its slice says, once it is sliced (empty until then). */
  result: ThreeMfResult;
  /** The plates worth asking about (the sliced ones, in a .gcode.3mf). */
  plates: Plate[];
  slicer?: string;
  /** "model": an .stl or plain .3mf, kept as it is and sliced in the browser (lib/slicing). */
  kind: FileKind;
  /** A model's plate picture, once its slicing has drawn it. */
  picture?: Blob;
}

const NOTHING_READ: ThreeMfResult = { kind: "unknown", plates: [], settings: {}, warnings: [] };

/**
 * Reads a dropped or picked file, with no network. A sliced .gcode.3mf is read as before; an .stl or a .3mf with
 * no G-code is a model to slice. Null (with a toast) when it is neither, or a model too large to keep.
 */
export async function readSlicerFile(file: File): Promise<SlicerFileDraft | null> {
  const model = (): SlicerFileDraft | null => {
    if (file.size > MAX_MODEL_FILE_BYTES) {
      toast.error(
        "That model is too large to keep",
        `Spaghetti keeps models up to ${formatBytes(MAX_MODEL_FILE_BYTES)}.`,
      );
      return null;
    }
    return { id: crypto.randomUUID(), file, result: NOTHING_READ, plates: [], kind: "model" };
  };
  if (isStlName(file.name)) return model();
  // A 3MF is a zip; anything else under that name isn't one.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) {
    toast.error("Couldn't read that file", "Spaghetti reads .stl and .3mf files, and sliced .gcode.3mf files.");
    return null;
  }
  // The reader (and its unzip) loads the first time someone drops a file, not with the app.
  const { readThreeMfFile } = await import("@shared/threemf/read.ts");
  const result = await readThreeMfFile(file);
  // No G-code in it: a model to slice (a Bambu Studio or Orca project, or a plain 3MF from anywhere).
  if (result.kind !== "sliced") return model();
  const plates = printablePlates(result);
  if (!plates.length && !Object.keys(result.settings).length) {
    toast.error("Couldn't read that file", "Spaghetti reads .stl and .3mf files, and sliced .gcode.3mf files.");
    return null;
  }
  return { id: crypto.randomUUID(), file, result, plates, slicer: slicerName(result), kind: "slicer" };
}

export const plateOf = (draft: SlicerFileDraft, index: number | null) =>
  draft.plates.find((plate) => plate.index === index) ?? (draft.plates.length === 1 ? draft.plates[0] : undefined);

/** A plate's picture as a Blob, to keep and to show. */
export function plateThumb(plate: Plate | undefined): Blob | undefined {
  if (!plate?.thumbnail) return undefined;
  return new Blob([plate.thumbnail.bytes as BlobPart], { type: plate.thumbnail.mediaType });
}

/**
 * Links a file's filaments to the pantry: each one that matches a spool (same
 * material, a color people would call the same) becomes that spool, keeping
 * the file's preset. Returns the settings and which filaments found no spool.
 */
export function linkSpools(
  settings: AttemptSettings,
  spools: readonly Spool[],
): {
  settings: AttemptSettings;
  unknown: number[];
} {
  const filaments = settings.filaments ?? [];
  if (!filaments.length) return { settings, unknown: [] };
  const matches = matchFilaments(filaments, spools);
  const unknown: number[] = [];
  const linked: AttemptFilament[] = filaments.map((filament, index) => {
    const spool = matches[index];
    if (!spool) {
      unknown.push(index);
      return filament;
    }
    return filamentFromSpool(spool, { profile: filament.profile });
  });
  return { settings: { ...settings, filaments: linked }, unknown };
}

/** What a file says about one plate, as attempt settings. */
export const fileSettings = (draft: SlicerFileDraft, plate: number | null) =>
  settingsFromFile(draft.result, plateOf(draft, plate)?.index);

/**
 * Keeps the file with an attempt: it goes into the outbox behind the
 * attempt, with what was read from it, and its plate's picture. Files over
 * the cap send only what they said.
 */
export function queueSlicerFile(
  itemId: string,
  attemptId: string,
  draft: SlicerFileDraft,
  plate: number | null,
  prefill: AttemptSettings,
) {
  const model = draft.kind === "model";
  const chosen = plateOf(draft, plate);
  // A model's picture is the one its slicing drew (lib/slicing/jobs.ts), when it has drawn it.
  const thumb = model ? draft.picture : plateThumb(chosen);
  void outbox.add({
    itemId,
    files: [
      {
        id: draft.id,
        attemptId,
        name: draft.file.name,
        size: draft.file.size,
        ...(model || draft.file.size <= MAX_SLICER_FILE_BYTES ? { file: draft.file } : {}),
        ...(thumb ? { thumb } : {}),
        plate: model ? 1 : (chosen?.index ?? 1),
        plateCount: model ? 1 : Math.max(draft.result.plates.length, 1),
        ...(draft.slicer && !model ? { slicer: draft.slicer } : {}),
        prefill: model ? {} : prefill,
        objects: model ? [] : (chosen?.objects ?? []).map((object) => object.name),
        ...(model ? { kind: "model" as const } : {}),
        queuedAt: Date.now(),
      },
    ],
    photos: [],
    queuedAt: Date.now(),
  });
  // What slicing makes (now or later) goes on the attempt once the outbox has brought the model there. The jobs'
  // code comes with the first model, not with the app.
  if (model) void import("./slicing/jobs").then(({ attachSlice }) => attachSlice(draft.id, { itemId, attemptId }));
}

/**
 * Takes the file off an attempt at once, with Undo: one still waiting leaves
 * the outbox, and a saved one (or the saved one a waiting file was going to
 * replace) is removed on the server too.
 */
export function removeSlicerFile(queryClient: QueryClient, itemId: string, attempt: AttemptView) {
  const file = attempt.file;
  if (!file) return;
  const waiting = outbox.removeFile(attempt.id);
  const saved: AttemptFile | null = file.pending ? (file.replaces ?? null) : file;
  patchCachedItem(queryClient, itemId, (item) => ({
    ...item,
    attempts: item.attempts.map((a) => (a.id === attempt.id ? { ...a, file: null } : a)),
  }));
  const deleted = saved
    ? api(`/attempts/${attempt.id}/file`, { method: "DELETE" }).catch(() => undefined)
    : Promise.resolve(undefined);
  toast.undo("Slicer file removed", {
    description: file.name,
    onUndo: async () => {
      if (waiting) outbox.restoreFile(waiting.itemId, waiting.file);
      if (!saved) return;
      await deleted;
      patchCachedItem(queryClient, itemId, (item) => ({
        ...item,
        attempts: item.attempts.map((a) => (a.id === attempt.id ? { ...a, file: saved } : a)),
      }));
      await api(`/attempts/${attempt.id}/file/restore`, { method: "POST" }).catch(() =>
        toast.error("Couldn't bring the file back"),
      );
    },
  });
}

/** "4.2 MB", "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* Dropping a file on a build or an attempt ---------------------------------- */

/** Where a dropped .3mf goes: the open attempt sheet first, else the build on screen. */
type DropHandler = (file: File, attemptId: string | null) => void;
const targets: Array<{ handler: RefObject<DropHandler> }> = [];
const listeners = new Set<() => void>();

/** While mounted (and enabled), a dropped .3mf goes to `handler`; the latest registered wins. */
export function useSlicerDropTarget(handler: DropHandler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const entry = { handler: ref };
    targets.push(entry);
    for (const listener of listeners) listener();
    return () => {
      targets.splice(targets.indexOf(entry), 1);
      for (const listener of listeners) listener();
    };
  }, [enabled]);
}

/** Whether a dropped .3mf has somewhere to go on this screen. */
export function hasSlicerDropTarget(): boolean {
  return targets.length > 0;
}

export function subscribeSlicerDropTargets(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hands a dropped .3mf to the screen; false when nothing on screen takes one. */
export function takeSlicerDrop(file: File, attemptId: string | null): boolean {
  const target = targets.at(-1);
  if (!target) return false;
  target.handler.current(file, attemptId);
  return true;
}
