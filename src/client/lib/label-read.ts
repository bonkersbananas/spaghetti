import type { LabelReadResponse, Spool } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { featuresQuery } from "./drafts";
import { clearLabelRead, spoolsQuery } from "./pantry";

/** Whether anything about reading labels shows at all: without the Worker's key nothing does. */
export const useLabelReadsEnabled = () => useQuery(featuresQuery).data?.labelReads === true;

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
