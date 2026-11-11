import type { PrinterResponse } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { printerQuery } from "./pantry-queries";

/**
 * Ends the bridge's token and forgets its status. Plain state rather than useMutation: the Printer page loads this
 * with every first load, and useMutation would add its own chunk to it.
 */
export function useDisconnectBridge() {
  const queryClient = useQueryClient();
  const [isPending, setPending] = useState(false);
  const mutate = () => {
    setPending(true);
    api<PrinterResponse>("/printer/bridge", { method: "DELETE" })
      .then((printer) => {
        queryClient.setQueryData(printerQuery.queryKey, printer);
        toast.message("Bridge disconnected", "Its token is ended. Connect it again whenever you like.");
      })
      .catch(() => toast.error("Couldn't disconnect", "Try again in a moment."))
      .finally(() => setPending(false));
  };
  return { mutate, isPending };
}
