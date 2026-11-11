import type {
  PrinterResponse,
  Spool,
  SpoolAttemptsResponse,
  SpoolResponse,
  SpoolsResponse,
  SpoolUsageResponse,
  UpdatePrinterRequest,
  UpdateSpoolRequest,
} from "@shared/api";
import { gramsFromScale, levelOf } from "@shared/ledger";
import { DEFAULT_PRINTER, type PrinterSetup, type SpoolLike } from "@shared/spools";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { processPhoto } from "./images";
import {
  asSpoolLike,
  printerQuery,
  spoolAttemptsQuery,
  spoolsQuery,
  spoolUsageQuery,
  usePrinterSetup,
} from "./pantry-queries";
import { setPreview } from "./previews";

export { asSpoolLike, printerQuery, spoolAttemptsQuery, spoolsQuery, spoolUsageQuery, usePrinterSetup };

function patchSpools(queryClient: QueryClient, change: (spools: Spool[]) => Spool[]) {
  queryClient.setQueryData<Spool[]>(spoolsQuery.queryKey, (spools) => (spools ? change(spools) : spools));
}

function patchSpool(queryClient: QueryClient, id: string, change: (spool: Spool) => Spool) {
  patchSpools(queryClient, (spools) => spools.map((spool) => (spool.id === id ? change(spool) : spool)));
}

export interface SpoolDraft {
  material: string;
  brand?: string | null;
  colorName?: string | null;
  colorHex?: string | null;
  finish?: string | null;
  note?: string;
  /** Grams when new; leave out for a spool whose level stays hand-set. */
  netGrams?: number | null;
}

/**
 * Puts a spool in the pantry at once (with its photo, if one was taken) and
 * saves it in the background. Returns the spool, for whoever wants to link
 * it, and a promise that settles once the server has it.
 */
export function addSpool(
  queryClient: QueryClient,
  draft: SpoolDraft,
  createdBy: string,
  photo?: File,
): { spool: Spool; saved: Promise<boolean> } {
  const now = Date.now();
  const spool: Spool = {
    id: crypto.randomUUID(),
    material: draft.material.trim() || "PLA",
    brand: draft.brand?.trim() || null,
    colorName: draft.colorName?.trim() || null,
    colorHex: draft.colorHex ?? null,
    finish: draft.finish ?? null,
    remaining: "full",
    netGrams: draft.netGrams ?? null,
    tareGrams: null,
    gramsLeft: draft.netGrams ?? null,
    gramsApproximate: false,
    weighedAt: null,
    note: draft.note ?? "",
    driedAt: null,
    photo: null,
    slot: null,
    trayUuid: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  patchSpools(queryClient, (spools) => [spool, ...spools]);
  if (!queryClient.getQueryData(spoolsQuery.queryKey)) queryClient.setQueryData(spoolsQuery.queryKey, [spool]);
  const saved = (async () => {
    try {
      const { spool: stored } = await api<SpoolResponse>("/spools", {
        method: "POST",
        json: {
          id: spool.id,
          material: spool.material,
          brand: spool.brand,
          colorName: spool.colorName,
          colorHex: spool.colorHex,
          finish: spool.finish,
          netGrams: spool.netGrams,
          note: spool.note,
          createdAt: now,
        },
      });
      patchSpool(queryClient, spool.id, (current) => ({ ...stored, photo: current.photo, slot: current.slot }));
      if (photo) void setSpoolPhoto(queryClient, spool.id, photo);
      return true;
    } catch {
      patchSpools(queryClient, (spools) => spools.filter((s) => s.id !== spool.id));
      toast.error("Couldn't add that spool", "Check the connection and add it again.");
      return false;
    }
  })();
  return { spool, saved };
}

/** Saves edits to a spool (autosave): the cache first, then the server. */
export async function saveSpool(queryClient: QueryClient, id: string, changes: UpdateSpoolRequest) {
  patchSpool(queryClient, id, (spool) => ({ ...spool, ...changes, updatedAt: Date.now() }) as Spool);
  const { spool } = await api<SpoolResponse>(`/spools/${id}`, { method: "PATCH", json: changes, keepalive: true });
  patchSpool(queryClient, id, (current) => ({ ...current, updatedAt: spool.updatedAt }));
}

const replaceSpool = (queryClient: QueryClient, stored: Spool) =>
  patchSpool(queryClient, stored.id, (current) => ({ ...stored, photo: current.photo, slot: current.slot }));

/**
 * Sets what the spool held when new (and optionally the empty spool's weight). Grams left follow at
 * once: the spool had none, so they start at the net weight; otherwise the server's answer settles them.
 */
export async function setSpoolWeight(
  queryClient: QueryClient,
  spool: Spool,
  weight: { netGrams?: number | null; tareGrams?: number | null },
) {
  patchSpool(queryClient, spool.id, (current) => {
    const next = { ...current, ...weight };
    if (weight.netGrams === null) next.gramsLeft = null;
    else if (weight.netGrams !== undefined && current.gramsLeft === null) next.gramsLeft = weight.netGrams;
    return { ...next, remaining: levelOf(next) };
  });
  try {
    const { spool: stored } = await api<SpoolResponse>(`/spools/${spool.id}/weight`, {
      method: "PUT",
      json: weight,
      keepalive: true,
    });
    replaceSpool(queryClient, stored);
    void queryClient.invalidateQueries({ queryKey: ["spools", spool.id, "usage"] });
  } catch {
    patchSpool(queryClient, spool.id, () => spool);
    toast.error("Couldn't save the weight", "It's back the way it was.");
  }
}

/**
 * A weighing: "On the scale: 812 g" (minus the empty spool) or the filament left, as the new baseline.
 * It shows at once; the toast undoes it.
 */
export async function weighSpool(
  queryClient: QueryClient,
  spool: Spool,
  weighing: { onScale?: number; gramsLeft?: number; tareGrams?: number | null },
) {
  const id = crypto.randomUUID();
  const tare = weighing.tareGrams !== undefined ? weighing.tareGrams : spool.tareGrams;
  const left = weighing.gramsLeft ?? gramsFromScale(weighing.onScale ?? 0, tare);
  const change = (current: Spool, gramsLeft: number | null): Spool => {
    const next = { ...current, gramsLeft, weighedAt: gramsLeft === null ? null : Date.now() };
    return { ...next, remaining: levelOf(next) };
  };
  patchSpool(queryClient, spool.id, (current) => ({
    ...change(current, left),
    ...(weighing.tareGrams !== undefined ? { tareGrams: weighing.tareGrams } : {}),
    gramsApproximate: false,
  }));
  try {
    const { spool: stored } = await api<SpoolResponse>(`/spools/${spool.id}/weighings`, {
      method: "POST",
      json: { id, ...weighing },
      keepalive: true,
    });
    replaceSpool(queryClient, stored);
    void queryClient.invalidateQueries({ queryKey: ["spools", spool.id, "usage"] });
  } catch {
    patchSpool(queryClient, spool.id, () => spool);
    toast.error("Couldn't save the weighing", "It's back the way it was.");
    return;
  }
  toast.undo(`Weighed: about ${left} g`, {
    description: [spool.colorName, spool.material].filter(Boolean).join(" "),
    onUndo: async () => {
      patchSpool(queryClient, spool.id, () => spool);
      try {
        const { spool: stored } = await api<SpoolResponse>(`/spools/${spool.id}/weighings/${id}`, { method: "DELETE" });
        replaceSpool(queryClient, stored);
        void queryClient.invalidateQueries({ queryKey: ["spools", spool.id, "usage"] });
      } catch {
        toast.error("Couldn't undo the weighing", "Try again in a moment.");
      }
    },
  });
}

/** A new photo of the label: shown from the device at once, then uploaded. */
export async function setSpoolPhoto(queryClient: QueryClient, spoolId: string, file: File) {
  try {
    const processed = await processPhoto(file);
    const photoId = crypto.randomUUID();
    setPreview(photoId, processed.thumb, processed.large);
    patchSpool(queryClient, spoolId, (spool) => ({
      ...spool,
      photo: { id: photoId, width: processed.width, height: processed.height, color: processed.color },
    }));
    const form = new FormData();
    form.set("width", String(processed.width));
    form.set("height", String(processed.height));
    form.set("color", processed.color);
    form.set("large", processed.large, "large");
    form.set("thumb", processed.thumb, "thumb");
    await api<SpoolResponse>(`/spools/${spoolId}/photo/${photoId}`, { method: "PUT", body: form });
  } catch (error) {
    toast.error("Couldn't save the photo", error instanceof Error ? error.message : undefined);
  }
}

/** Takes a spool out of the pantry at once, with Undo. Its slot empties, and fills again with Undo. */
export function deleteSpool(queryClient: QueryClient, spool: Spool) {
  const before = queryClient.getQueryData<Spool[]>(spoolsQuery.queryKey);
  const printer = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey);
  patchSpools(queryClient, (spools) => spools.filter((s) => s.id !== spool.id));
  if (spool.slot) patchSlots(queryClient, (slots) => withoutSpool(slots, spool.id));
  const deleted = api(`/spools/${spool.id}`, { method: "DELETE" }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) return;
    if (before) queryClient.setQueryData(spoolsQuery.queryKey, before);
    if (printer) queryClient.setQueryData(printerQuery.queryKey, printer);
    toast.error("Couldn't take that spool out", "It's back in the pantry.");
  });
  toast.undo("Spool taken out", {
    description: [spool.colorName, spool.material].filter(Boolean).join(" "),
    onUndo: async () => {
      await deleted;
      patchSpools(queryClient, (spools) => [spool, ...spools.filter((s) => s.id !== spool.id)]);
      if (spool.slot) {
        const slot = spool.slot;
        patchSlots(queryClient, (slots) => ({ ...slots, [slot]: spool.id }));
      }
      try {
        await api<SpoolResponse>(`/spools/${spool.id}/restore`, { method: "POST" });
      } catch {
        toast.error("Couldn't bring the spool back", "Try again in a moment.");
      }
      void queryClient.invalidateQueries({ queryKey: printerQuery.queryKey });
    },
  });
}

function withoutSpool(slots: Record<string, string>, spoolId: string) {
  return Object.fromEntries(Object.entries(slots).filter(([, id]) => id !== spoolId));
}

function patchSlots(queryClient: QueryClient, change: (slots: Record<string, string>) => Record<string, string>) {
  queryClient.setQueryData<PrinterResponse>(printerQuery.queryKey, (printer) =>
    printer ? { ...printer, slots: change(printer.slots) } : printer,
  );
  const slots = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey)?.slots;
  if (!slots) return;
  const bySpool = new Map(Object.entries(slots).map(([slot, id]) => [id, slot]));
  patchSpools(queryClient, (spools) => spools.map((spool) => ({ ...spool, slot: bySpool.get(spool.id) ?? null })));
}

/**
 * Loads a spool into a slot (out of wherever it was), or empties the slot,
 * at once; the server follows, and a failure puts it back.
 */
export async function loadSlot(
  queryClient: QueryClient,
  slot: string,
  spoolId: string | null,
  /** Settles once a spool just added is on the server. */
  after?: Promise<boolean>,
) {
  const before = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey);
  patchSlots(queryClient, (slots) => {
    const next = spoolId ? withoutSpool(slots, spoolId) : { ...slots };
    if (spoolId) next[slot] = spoolId;
    else delete next[slot];
    return next;
  });
  try {
    if (after && !(await after)) throw new Error("The spool wasn't saved.");
    const saved = await api<PrinterResponse>(`/printer/slots/${slot}`, { method: "PUT", json: { spoolId } });
    queryClient.setQueryData(printerQuery.queryKey, saved);
    patchSlots(queryClient, (slots) => slots);
  } catch {
    if (before) {
      queryClient.setQueryData(printerQuery.queryKey, before);
      patchSlots(queryClient, (slots) => slots);
    }
    toast.error("Couldn't change the AMS", "It's back the way it was.");
  }
}

/**
 * Saves the part of the printer's setup that changed (autosave): a nozzle, the
 * plates or the AMS units. Only that part goes to the server, so the other
 * person's edit to another part stays; the answer is the setup as the server has it.
 */
export async function savePrinterSetup(queryClient: QueryClient, changes: UpdatePrinterRequest) {
  queryClient.setQueryData<PrinterResponse>(printerQuery.queryKey, (printer) =>
    printer
      ? {
          ...printer,
          setup: { ...printer.setup, ...changes, nozzles: { ...printer.setup.nozzles, ...changes.nozzles } },
        }
      : printer,
  );
  const saved = await api<PrinterResponse>("/printer", { method: "PUT", json: changes, keepalive: true });
  queryClient.setQueryData<PrinterResponse>(printerQuery.queryKey, saved);
}
