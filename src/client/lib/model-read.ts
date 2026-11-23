import type { AttemptFile, Item, ReadClaimResponse } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { isOnline } from "./connection";
import { itemKeys } from "./items";
import { twistsQuery } from "./twists-query";

/**
 * A model an agent put into Spaghetti (the MCP tool add_file) has not been read by a browser: no slice, no plate
 * picture, so no cover and no 3D view yet. The first signed-in browser that sees one slices it here, quietly and in
 * idle time, one at a time, with the same jobs as a model someone adds (lib/slicing/jobs.ts), which save what they
 * make to the server: from then on it is a model like any other. Photos from an agent work the same way
 * (lib/photo-resize.ts); decision 0078.
 *
 * Only a model an agent added is taken up: one a person added and never sliced offers "Slice it" and waits for them.
 * The server hands out one claim at a time (as for a photo's resize, ten minutes), so two devices don't slice it
 * twice; tabs share a Web Lock too. A phone leaves it for a laptop (it has the memory for one slice at a time, and the
 * battery), as does a connection that saves data and a tab nobody is looking at: a slice running when the tab hides is
 * stopped, and its claim lapses. What a slice makes is saved, and so is the engine failing on the model, so a model
 * that can't be sliced isn't tried again by every device that opens the app.
 */
const RETRY_AFTER_MS = 5 * 60 * 1000;
const triedAt = new Map<string, number>();
let running = false;

interface Unread {
  file: AttemptFile;
  target: { itemId: string; attemptId: string | null } | { twistId: string };
}

/** Whether an agent's model is waiting for a browser: stored, a model, not sliced (or failed) yet. */
const waiting = (file: AttemptFile | null | undefined): file is AttemptFile =>
  !!file && !!file.createdVia && file.kind === "model" && file.stored && !file.slice && !file.hasThumb;

function unreadModels(queryClient: QueryClient): Unread[] {
  const found = new Map<string, Unread>();
  for (const [, data] of queryClient.getQueriesData<Item[] | Item | null>({ queryKey: itemKeys.all })) {
    const items = Array.isArray(data) ? data : data ? [data] : [];
    for (const item of items) {
      for (const file of item.files ?? []) {
        if (waiting(file)) found.set(file.id, { file, target: { itemId: item.id, attemptId: null } });
      }
      for (const attempt of item.attempts ?? []) {
        if (waiting(attempt.file)) {
          found.set(attempt.file.id, { file: attempt.file, target: { itemId: item.id, attemptId: attempt.id } });
        }
      }
    }
  }
  for (const twist of queryClient.getQueryData(twistsQuery.queryKey) ?? []) {
    if (waiting(twist.model)) found.set(twist.model.id, { file: twist.model, target: { twistId: twist.id } });
  }
  const now = Date.now();
  return [...found.values()].filter(({ file }) => now - (triedAt.get(file.id) ?? 0) > RETRY_AFTER_MS);
}

/** Whether this device leaves the job to another: a phone, or a connection that saves data. */
const leavesIt = () => {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !!saveData || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
};

/** Slices one model. Returns quietly whenever it isn't this browser's job. */
async function readOne(queryClient: QueryClient, { file, target }: Unread) {
  const work = async () => {
    const jobs = await import("./slicing/jobs");
    // Someone is slicing it on this device already (the card's own job).
    if (jobs.sliceResult(file.id)) return;
    const { claimed } = await api<ReadClaimResponse>(`/files/${file.id}/read-claim`, { method: "POST" });
    if (!claimed) return;
    // Nobody is looking any more: stop (the claim lapses, and another device or a later visit slices it).
    const stop = () => {
      if (document.visibilityState === "hidden") jobs.cancelSlice(file.id);
    };
    document.addEventListener("visibilitychange", stop);
    try {
      await jobs.startSlice(queryClient, {
        fileId: file.id,
        name: file.name,
        source: () => jobs.fetchOriginal(file.id),
        target,
        quiet: true,
      });
    } finally {
      document.removeEventListener("visibilitychange", stop);
    }
  };
  try {
    if (navigator.locks) {
      await navigator.locks.request(`spaghetti-read-${file.id}`, { ifAvailable: true }, (lock) =>
        lock ? work() : undefined,
      );
    } else await work();
  } catch {
    // Offline, too big to hold here, refused: left for later.
  }
  // Whatever happened, not again for a while: a slice that was saved no longer shows as waiting.
  triedAt.set(file.id, Date.now());
}

function whenIdle(run: () => void) {
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 15_000 });
  else setTimeout(run, 2000);
}

/** Starts watching what the item and twist queries hold; returns the cleanup. */
export function followUnreadModels(queryClient: QueryClient) {
  let scheduled = false;
  let stopped = false;

  async function pump() {
    if (running || stopped) return;
    running = true;
    try {
      for (let next = unreadModels(queryClient)[0]; next; next = unreadModels(queryClient)[0]) {
        if (stopped || !isOnline() || document.visibilityState === "hidden" || leavesIt()) return;
        await readOne(queryClient, next);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (scheduled || stopped) return;
    if (leavesIt() || !unreadModels(queryClient).length) return;
    scheduled = true;
    whenIdle(() => {
      scheduled = false;
      void pump();
    });
  }

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const key = event.query.queryKey[0];
    if (key === itemKeys.all[0] || key === twistsQuery.queryKey[0]) schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("online", schedule);
  schedule();
  return () => {
    stopped = true;
    unsubscribe();
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("online", schedule);
  };
}
