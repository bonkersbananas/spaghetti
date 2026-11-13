import type { Orientation } from "@shared/slicing/settings.ts";
import { useEffect, useState } from "react";
import { tooBigForPhone } from "@/lib/big-upload";
import { fetchOriginal } from "./jobs";
import type { OrientMessage, OrientRequest } from "./orient-worker";

/**
 * The ways a model can lie, for the settings' "Lay it down" tiles (shared/mesh.ts `restingFaces`): "As designed"
 * first, then the faces it can rest on, largest first, each with a small plate picture of it lying so. Found in a
 * worker (orient-worker.ts) the first time the settings open, kept for the tab. A phone doesn't search a model over
 * the phone-memory line (decision 0046's guard, big-upload.ts): it has the file as designed only.
 */
export interface Lying {
  /** null: as the file lies. */
  down: Orientation | null;
  /** mm² of the face it rests on. */
  area: number;
  /** mm: how tall it stands. */
  height: number;
  /** An object URL of the picture, if the browser could draw one. */
  src: string | null;
}

export type LyingState = { status: "loading" } | { status: "ready"; options: Lying[] } | { status: "none" };

const found = new Map<string, Promise<Lying[] | null>>();

function lyingOf(fileId: string, name: string, size: number, colour: string): Promise<Lying[] | null> {
  const key = `${fileId}:${size}:${colour}`;
  const kept = found.get(key);
  if (kept) return kept;
  const job = (async () => {
    const file = await fetchOriginal(fileId);
    return await new Promise<Lying[] | null>((resolve) => {
      const worker = new Worker(new URL("./orient-worker.ts", import.meta.url), { type: "module", name: "orienting" });
      const end = (value: Lying[] | null) => {
        worker.terminate();
        resolve(value);
      };
      worker.onmessage = (event: MessageEvent<OrientMessage>) => {
        if (event.data.type !== "done") return end(null);
        end(
          event.data.options.map((option) => ({
            down: option.down,
            area: option.area,
            height: option.height,
            src: option.png ? URL.createObjectURL(option.png) : null,
          })),
        );
      };
      worker.onerror = () => end(null);
      worker.postMessage({ file, name, colour, size: 192 } satisfies OrientRequest);
    });
  })().catch(() => null);
  found.set(key, job);
  // A search that failed is tried again the next time the settings open.
  void job.then((value) => {
    if (!value) found.delete(key);
  });
  return job;
}

/** How a model can lie, once found. `enabled` waits for the settings to open. */
export function useLying(file: { id: string; name: string; size: number }, colour: string, enabled = true): LyingState {
  const skip = !enabled || tooBigForPhone(file.size);
  const [state, setState] = useState<LyingState>({ status: skip ? "none" : "loading" });
  useEffect(() => {
    if (skip) return setState({ status: "none" });
    let current = true;
    setState((was) => (was.status === "ready" ? was : { status: "loading" }));
    void lyingOf(file.id, file.name, file.size, colour).then((options) => {
      if (current) setState(options && options.length > 1 ? { status: "ready", options } : { status: "none" });
    });
    return () => {
      current = false;
    };
  }, [skip, file.id, file.name, file.size, colour]);
  return state;
}
