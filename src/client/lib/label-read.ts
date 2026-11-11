import type { LabelReadResponse, Spool } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { patchSpool, spoolsQuery } from "./pantry";

/** Reads the label in the spool's photo (already uploaded). The spool shows "Reading the label…" at once. */
export async function requestLabelRead(
  queryClient: QueryClient,
  spoolId: string,
  placeholders: Array<"material" | "netGrams"> = [],
) {
  patchSpool(queryClient, spoolId, (spool) => ({
    ...spool,
    labelRead: { status: "reading", photoId: spool.photo?.id ?? "", spools: [] },
  }));
  try {
    const { spool } = await api<LabelReadResponse>(`/spools/${spoolId}/label-read`, {
      method: "POST",
      json: { placeholders },
    });
    patchSpool(queryClient, spoolId, (current) => ({
      ...spool,
      photo: current.photo ?? spool.photo,
      slot: current.slot,
    }));
  } catch {
    clearLabelRead(queryClient, spoolId);
    toast.error("Couldn't start reading the label", "The spool is saved as it is. Try again from its page.");
  }
}

export const clearLabelRead = (queryClient: QueryClient, spoolId: string) =>
  patchSpool(queryClient, spoolId, (spool) => ({ ...spool, labelRead: null }));

/** Puts away a list nobody wants, or the line that says the label couldn't be read. */
export async function dismissLabelRead(queryClient: QueryClient, spoolId: string) {
  clearLabelRead(queryClient, spoolId);
  try {
    await api<LabelReadResponse>(`/spools/${spoolId}/label-read`, { method: "DELETE" });
  } catch {
    void queryClient.invalidateQueries({ queryKey: spoolsQuery.queryKey });
  }
}

/** The one tap: the first label fills this spool, each other becomes a spool of its own. */
export async function acceptLabelRead(queryClient: QueryClient, spool: Spool) {
  const count = spool.labelRead?.spools.length ?? 0;
  clearLabelRead(queryClient, spool.id);
  try {
    await api<LabelReadResponse>(`/spools/${spool.id}/label-read/accept`, { method: "POST" });
    void queryClient.invalidateQueries({ queryKey: spoolsQuery.queryKey });
    toast.message(`${count} spools from the label`);
  } catch {
    void queryClient.invalidateQueries({ queryKey: spoolsQuery.queryKey });
    toast.error("Couldn't add those spools", "Try again in a moment.");
  }
}

/** A label photo being uploaded for a new spool: once it is there, Claude reads it; if it never gets there, the reading line goes. */
export async function readUploaded(
  queryClient: QueryClient,
  spoolId: string,
  uploaded: Promise<boolean>,
  placeholders: Array<"material" | "netGrams">,
) {
  if (await uploaded) await requestLabelRead(queryClient, spoolId, placeholders);
  else clearLabelRead(queryClient, spoolId);
}
