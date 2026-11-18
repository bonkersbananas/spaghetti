import type { PrinterResponse } from "@shared/api";
import { nextEmptySlot } from "@shared/spool-lookup";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { printerQuery } from "./pantry-queries";

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
