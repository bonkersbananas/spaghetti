import type { PrinterResponse, Spool, SpoolResponse, UpdatePrinterRequest, UpdateSpoolRequest } from "@shared/api";
import { gramsFromScale, levelOf } from "@shared/ledger";
import { nextEmptySlot } from "@shared/spools";
import type { QueryClient } from "@tanstack/react-query";
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

export function patchSpools(queryClient: QueryClient, change: (spools: Spool[]) => Spool[]) {
  queryClient.setQueryData<Spool[]>(spoolsQuery.queryKey, (spools) => (spools ? change(spools) : spools));
}

export function patchSpool(queryClient: QueryClient, id: string, change: (spool: Spool) => Spool) {
  patchSpools(queryClient, (spools) => spools.map((spool) => (spool.id === id ? change(spool) : spool)));
}

export interface SpoolDraft {
  material: string;
  brand?: string | null;
  colorName?: string | null;
  colorHex?: string | null;
  /** Two or three colours of a co-extruded spool; `colorHex` is then null. */
  colors?: readonly string[] | null;
  line?: string | null;
  finish?: string | null;
  /** The maker's ranges in °C, from a known product. */
  nozzleTempMin?: number | null;
  nozzleTempMax?: number | null;
  bedTempMin?: number | null;
  bedTempMax?: number | null;
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
  /** Given the photo's upload, for what follows it (Claude reading its label); the spool shows "Reading the label…" meanwhile. */
  afterPhoto?: (uploaded: Promise<boolean>, spoolId: string) => void,
): { spool: Spool; saved: Promise<boolean> } {
  const now = Date.now();
  const spool = {
    id: crypto.randomUUID(),
    material: draft.material.trim() || "PLA",
    brand: draft.brand?.trim() || null,
    colorName: draft.colorName?.trim() || null,
    colorHex: draft.colors ? null : (draft.colorHex ?? null),
    colors: draft.colors ? [...draft.colors] : null,
    line: draft.line?.trim() || null,
    finish: draft.finish ?? null,
    nozzleTempMin: draft.nozzleTempMin ?? null,
    nozzleTempMax: draft.nozzleTempMax ?? null,
    bedTempMin: draft.bedTempMin ?? null,
    bedTempMax: draft.bedTempMax ?? null,
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
    fromLabel: [],
    labelRead: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
    // Every other field is checked against the type; these start out missing (as null would) and the server's copy
    // fills them in a moment later (kept out of the pantry's first load: lib/label-read.ts has the full defaults).
  } satisfies Omit<Spool, "diameterMm" | "dryTempC" | "dryHours" | "productCode"> as Partial<Spool> as Spool;
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
          colors: spool.colors,
          line: spool.line,
          finish: spool.finish,
          nozzleTempMin: spool.nozzleTempMin,
          nozzleTempMax: spool.nozzleTempMax,
          bedTempMin: spool.bedTempMin,
          bedTempMax: spool.bedTempMax,
          netGrams: spool.netGrams,
          note: spool.note,
          createdAt: now,
        },
      });
      patchSpool(queryClient, spool.id, (current) => ({ ...stored, photo: current.photo, slot: current.slot }));
      if (photo) {
        const uploaded = setSpoolPhoto(queryClient, spool.id, photo);
        afterPhoto?.(uploaded, spool.id);
      }
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

/** What a weighing sets (and the server works out from it): the only part of a spool a weighing's answer or rollback touches. */
const weightFields = (spool: Spool) => ({
  netGrams: spool.netGrams,
  tareGrams: spool.tareGrams,
  gramsLeft: spool.gramsLeft,
  gramsApproximate: spool.gramsApproximate,
  weighedAt: spool.weighedAt,
  remaining: spool.remaining,
});

/** The server's answer to a weighing: its grams. Edits made meanwhile to the spool's other fields stay. */
const replaceSpool = (queryClient: QueryClient, stored: Spool) =>
  patchSpool(queryClient, stored.id, (current) => ({
    ...current,
    ...weightFields(stored),
    updatedAt: stored.updatedAt,
  }));

/** A weighing that didn't go through (or was undone) puts back the grams it had, not the whole spool. */
const restoreWeight = (queryClient: QueryClient, spool: Spool) =>
  patchSpool(queryClient, spool.id, (current) => ({ ...current, ...weightFields(spool) }));

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
    restoreWeight(queryClient, spool);
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
    restoreWeight(queryClient, spool);
    toast.error("Couldn't save the weighing", "It's back the way it was.");
    return;
  }
  toast.undo(`Weighed: about ${left} g`, {
    description: [spool.colorName, spool.material].filter(Boolean).join(" "),
    onUndo: async () => {
      restoreWeight(queryClient, spool);
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
export async function setSpoolPhoto(queryClient: QueryClient, spoolId: string, file: File): Promise<boolean> {
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
    return true;
  } catch (error) {
    toast.error("Couldn't save the photo", error instanceof Error ? error.message : undefined);
    return false;
  }
}

/** Takes a spool out of the pantry at once, with Undo. Its slot empties, and fills again with Undo. */
export function deleteSpool(queryClient: QueryClient, spool: Spool) {
  patchSpools(queryClient, (spools) => spools.filter((s) => s.id !== spool.id));
  if (spool.slot) patchSlots(queryClient, (slots) => withoutSpool(slots, spool.id));
  const deleted = api(`/spools/${spool.id}`, { method: "DELETE" }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) return;
    // Back where it was, without undoing what was changed to other spools meanwhile.
    patchSpools(queryClient, (spools) => (spools.some((s) => s.id === spool.id) ? spools : [spool, ...spools]));
    if (spool.slot) {
      const slot = spool.slot;
      patchSlots(queryClient, (slots) => ({ ...slots, [slot]: spool.id }));
    }
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
  const was = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey)?.slots ?? {};
  const wasIn = spoolId ? Object.entries(was).find(([, id]) => id === spoolId)?.[0] : undefined;
  patchSlots(queryClient, (slots) => {
    const next = spoolId ? withoutSpool(slots, spoolId) : { ...slots };
    if (spoolId) next[slot] = spoolId;
    else delete next[slot];
    return next;
  });
  const shown = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey)?.slots;
  try {
    if (after && !(await after)) throw new Error("The spool wasn't saved.");
    const saved = await api<PrinterResponse>(`/printer/slots/${slot}`, { method: "PUT", json: { spoolId } });
    // The answer is the whole AMS as of the server: it replaces ours only if no other slot was changed here since.
    const now = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey);
    const untouched = !!shown && JSON.stringify(now?.slots) === JSON.stringify(shown);
    queryClient.setQueryData<PrinterResponse>(printerQuery.queryKey, (printer) =>
      printer ? { ...saved, setup: printer.setup, slots: untouched ? saved.slots : printer.slots } : saved,
    );
    patchSlots(queryClient, (slots) => slots);
  } catch {
    // Only this change is undone: the two slots it touched go back, whatever was done to the others meanwhile.
    patchSlots(queryClient, (slots) => {
      const next = { ...slots };
      if (was[slot]) next[slot] = was[slot];
      else delete next[slot];
      if (spoolId && wasIn) next[wasIn] = spoolId;
      return next;
    });
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
          setup: {
            ...printer.setup,
            ...changes,
            nozzles: { ...printer.setup.nozzles, ...changes.nozzles },
            // Null takes the workspace's slicing defaults away (Spaghetti's own again).
            slicing: changes.slicing === undefined ? printer.setup.slicing : (changes.slicing ?? undefined),
          },
        }
      : printer,
  );
  const saved = await api<PrinterResponse>("/printer", { method: "PUT", json: changes, keepalive: true });
  // The server's copy settles what this save sent, unless that part was changed again here since (a newer save is on
  // its way, and its answer settles it): the rest of the cache stays.
  queryClient.setQueryData<PrinterResponse>(printerQuery.queryKey, (printer) => {
    if (!printer) return saved;
    const sameAs = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const setup = { ...printer.setup };
    for (const key of Object.keys(changes) as Array<keyof UpdatePrinterRequest>) {
      if (key === "nozzles") {
        const nozzles = { ...setup.nozzles };
        for (const nozzle of Object.keys(changes.nozzles ?? {}) as Array<"main" | "auxiliary">) {
          if (sameAs(nozzles[nozzle], changes.nozzles?.[nozzle])) nozzles[nozzle] = saved.setup.nozzles[nozzle];
        }
        setup.nozzles = nozzles;
      } else if (sameAs(setup[key as keyof typeof setup], changes[key])) {
        (setup as Record<string, unknown>)[key] = saved.setup[key as keyof typeof setup];
      }
    }
    return { ...printer, setup };
  });
}

/**
 * A spool just went into a slot: one tap to add the one for the next empty slot ("Next slot, A2"). Says nothing
 * after the last empty slot.
 */
export function offerNextSlot(queryClient: QueryClient, slot: string, openSlot: (slot: string) => void) {
  const printer = queryClient.getQueryData<PrinterResponse>(printerQuery.queryKey);
  if (!printer) return;
  const next = nextEmptySlot(slot, { ...printer.slots, [slot]: "added" }, printer.setup.amsUnits);
  if (next) toast.action(`In ${slot}`, { label: `Next slot, ${next}`, onClick: () => openSlot(next) });
}
