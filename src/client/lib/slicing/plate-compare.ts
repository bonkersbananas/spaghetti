import type { SlicingSettings } from "@shared/slicing/settings.ts";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { fetchOriginal, inTurn, pantryAndDefaults, type SliceFigures } from "./jobs";

/**
 * "Slice every plate": each plate of a project sliced with the settings the model has now, only to compare how long
 * and how much filament each takes (a plate's figures are on its tile). Nothing is saved: the model keeps the one
 * slice it has, of the plate chosen, and the rest are for looking at, kept until the tab closes or the settings change.
 * One slice at a time among the others on this device.
 */

export interface PlateFigure extends SliceFigures {
  /** It couldn't be sliced (too big, floating…): the tile says so rather than a time. */
  failed?: boolean;
}

export interface PlateComparison {
  /** What the figures are for: the settings but for the plate and the way it lies. */
  key: string;
  status: "running" | "done";
  /** Plates sliced so far, and how many there are. */
  done: number;
  of: number;
  figures: Readonly<Record<number, PlateFigure>>;
}

const comparisons = new Map<string, PlateComparison>();
/** The run of each file that is going, to stop it. */
const running = new Map<string, { key: string; controller: AbortController }>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, PlateComparison> = new Map();

function emit() {
  snapshot = new Map(comparisons);
  for (const listener of listeners) listener();
}

/** What the figures hold for: the settings other than the plate and the way it lies (those differ by plate). */
export function comparisonKey(settings: SlicingSettings): string {
  const { modelPlate: _plate, orientation: _orientation, ...rest } = settings;
  return JSON.stringify(rest);
}

/** Stops a file's comparison when it is for other settings than `settings` (they changed under it), and forgets it. */
export function dropStaleComparison(fileId: string, settings: SlicingSettings) {
  const run = running.get(fileId);
  if (run && run.key !== comparisonKey(settings)) {
    run.controller.abort();
    running.delete(fileId);
    comparisons.delete(fileId);
    emit();
  }
}

/** The comparison of a file's plates, if one was made with these settings. */
export function usePlateComparison(fileId: string, settings: SlicingSettings): PlateComparison | undefined {
  const key = comparisonKey(settings);
  const found = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => snapshot.get(fileId),
    () => undefined,
  );
  return found?.key === key ? found : undefined;
}

/** Slices each of `plates` (their project numbers) the way `settings` say, one after another, and keeps the figures. */
export function comparePlates(
  queryClient: QueryClient,
  job: {
    fileId: string;
    name: string;
    settings: SlicingSettings;
    plates: readonly number[];
    /** Figures already known (the plate sliced and saved): not sliced again. */
    known?: Readonly<Record<number, SliceFigures>>;
  },
): Promise<void> {
  const key = comparisonKey(job.settings);
  // One run of a file at a time: a new one takes the place of the one going.
  running.get(job.fileId)?.controller.abort();
  const controller = new AbortController();
  running.set(job.fileId, { key, controller });
  const current = () => !controller.signal.aborted && running.get(job.fileId)?.controller === controller;
  const figures: Record<number, PlateFigure> = { ...job.known };
  const todo = job.plates.filter((plate) => !figures[plate]);
  const state = (status: PlateComparison["status"], done: number): PlateComparison => ({
    key,
    status,
    done,
    of: job.plates.length,
    figures: { ...figures },
  });
  comparisons.set(job.fileId, state("running", job.plates.length - todo.length));
  emit();
  return inTurn(async () => {
    const { sliceModel } = await import("./slice-model");
    const pantry = await pantryAndDefaults(queryClient);
    let source: Blob | null = null;
    try {
      source = await fetchOriginal(job.fileId);
    } catch {
      source = null;
    }
    for (const [at, plate] of todo.entries()) {
      if (!current()) return;
      if (!source) {
        figures[plate] = { failed: true };
      } else {
        const outcome = await sliceModel(
          source,
          job.name,
          {
            chosen: { ...job.settings, modelPlate: plate, orientation: null },
            defaults: pantry.defaults,
            spools: pantry.spools,
          },
          {},
          controller.signal,
        );
        if (!current()) return;
        figures[plate] = outcome.ok
          ? {
              ...(outcome.prefill.estimatedMinutes !== undefined ? { minutes: outcome.prefill.estimatedMinutes } : {}),
              ...(outcome.prefill.weightGrams !== undefined ? { grams: outcome.prefill.weightGrams } : {}),
            }
          : { failed: true };
      }
      comparisons.set(job.fileId, state("running", job.plates.length - todo.length + at + 1));
      emit();
    }
    if (!current()) return;
    running.delete(job.fileId);
    comparisons.set(job.fileId, state("done", job.plates.length));
    emit();
  }).catch(() => {
    // Stopped (or replaced) runs leave what the newer one wrote; a failed one goes.
    if (!current()) return;
    running.delete(job.fileId);
    comparisons.delete(job.fileId);
    emit();
  });
}
