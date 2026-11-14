import { useEffect, useState } from "react";
import { tooBigForPhone } from "@/lib/big-upload";
import { fetchOriginal } from "./jobs";
import type { PlatesMessage, PlatesRequest } from "./plates-worker";

/**
 * The plates of a 3MF project, each with a picture: found and drawn in a worker (plates-worker.ts) the first time
 * a model's card needs them, kept for the tab. Pictures come in two steps: the project's own as a placeholder, then
 * ours. A file with one plate (or none, or too big for a phone to read) has none: it looks as it always did.
 */
export interface PlateView {
  /** The project's number for it (1 is the first). */
  index: number;
  name: string;
  /** The names of the objects on it. */
  objects: string[];
  /** mm: how tall its tallest object stands. */
  height: number;
  /** An object URL of the app's own picture of it, once drawn. */
  src: string | null;
  /** An object URL of the project's own picture, until ours is drawn (or where it can't be). */
  placeholder: string | null;
}

export type PlatesState = { status: "loading" } | { status: "ready"; plates: PlateView[] } | { status: "none" };

const found = new Map<string, Promise<PlatesMessage | null>>();
const listeners = new Map<string, Set<(plates: PlateView[]) => void>>();
const latest = new Map<string, PlateView[]>();

function url(blob: Blob | null): string | null {
  return blob ? URL.createObjectURL(blob) : null;
}

function platesOf(fileId: string, colour: string, size: number): Promise<PlatesMessage | null> {
  const key = `${fileId}:${size}:${colour}`;
  const kept = found.get(key);
  if (kept) return kept;
  const job = (async () => {
    const file = await fetchOriginal(fileId);
    return await new Promise<PlatesMessage | null>((resolve) => {
      const worker = new Worker(new URL("./plates-worker.ts", import.meta.url), { type: "module", name: "plates" });
      const end = (value: PlatesMessage | null) => {
        worker.terminate();
        resolve(value);
      };
      worker.onmessage = (event: MessageEvent<PlatesMessage>) => {
        const message = event.data;
        if (message.type !== "plates") return end(message);
        const views = message.plates.map<PlateView>((plate) => ({
          index: plate.index,
          name: plate.name,
          objects: plate.objects,
          height: plate.height,
          src: url(plate.png),
          placeholder: url(plate.placeholder),
        }));
        latest.set(key, views);
        for (const listener of listeners.get(key) ?? []) listener(views);
        if (message.final) end(message);
      };
      worker.onerror = () => end(null);
      worker.postMessage({ file, colour, size } satisfies PlatesRequest);
    });
  })().catch(() => null);
  found.set(key, job);
  void job.then((value) => {
    if (!value) found.delete(key);
  });
  return job;
}

/** The plates of a model's 3MF, with their pictures as they arrive. `enabled` is false for a file that isn't a 3MF. */
export function usePlates(file: { id: string; size: number }, colour: string, enabled = true, size = 256): PlatesState {
  const skip = !enabled || tooBigForPhone(file.size);
  const key = `${file.id}:${size}:${colour}`;
  const [state, setState] = useState<PlatesState>(() => {
    const kept = latest.get(key);
    return skip ? { status: "none" } : kept ? { status: "ready", plates: kept } : { status: "loading" };
  });
  useEffect(() => {
    if (skip) return setState({ status: "none" });
    let current = true;
    const listener = (plates: PlateView[]) => current && setState({ status: "ready", plates });
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    void platesOf(file.id, colour, size).then((message) => {
      if (current && (!message || message.type === "none")) setState({ status: "none" });
    });
    const kept = latest.get(key);
    if (kept) listener(kept);
    return () => {
      current = false;
      set.delete(listener);
    };
  }, [skip, key, file.id, colour, size]);
  return state;
}
