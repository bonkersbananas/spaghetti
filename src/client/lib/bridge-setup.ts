import type { PrinterResponse } from "@shared/api";
import type { PairingResponse } from "@shared/bridge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { printerQuery } from "./pantry-queries";

/** Where the installer is served, and the address it should tell the bridge to use when this isn't spaghetti.day. */
export const PRODUCTION_ORIGIN = "https://spaghetti.day";

/** The one line to paste into Terminal. The pairing code is in it; no long-lived token ever is. */
export function installCommand(code: string, origin: string): string {
  const app = origin === PRODUCTION_ORIGIN ? "" : ` --app ${origin}`;
  return `curl -fsSL ${origin}/bridge/install.sh | sh -s -- ${code}${app}`;
}

/** A pairing code, valid ten minutes, once. */
export function useMakeCode() {
  return useMutation({ mutationFn: () => api<PairingResponse>("/bridge/pairing", { method: "POST" }) });
}

/** Ends the bridge's token and forgets its status. */
export function useDisconnectBridge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<PrinterResponse>("/printer/bridge", { method: "DELETE" }),
    onSuccess: (printer) => {
      queryClient.setQueryData(printerQuery.queryKey, printer);
      toast.message("Bridge disconnected", "Its token is ended. Connect it again whenever you like.");
    },
    onError: () => toast.error("Couldn't disconnect", "Try again in a moment."),
  });
}
