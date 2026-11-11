import type {
  DeliveriesResponse,
  DeliveryInfo,
  DeliveryResponse,
  NewWebhookResponse,
  WebhookInfo,
  WebhookKind,
  WebhooksResponse,
} from "@shared/webhooks";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { canEdit } from "./read-only";

/** The signed-in person's webhooks (never their secrets). */
export const webhooksQuery = queryOptions({
  queryKey: ["webhooks"] as const,
  queryFn: async () => (await api<WebhooksResponse>("/webhooks")).webhooks,
  staleTime: 60 * 1000,
});

/** A webhook's latest deliveries; the Agents page refreshes them while they are open. */
export const deliveriesQuery = (webhookId: string) =>
  queryOptions({
    queryKey: ["webhooks", webhookId, "deliveries"] as const,
    queryFn: async () => (await api<DeliveriesResponse>(`/webhooks/${webhookId}/deliveries`)).deliveries,
    staleTime: 10 * 1000,
  });

export async function createWebhook(
  queryClient: QueryClient,
  input: { url: string; kinds: WebhookKind[]; agentId: string | null },
) {
  const made = await api<NewWebhookResponse>("/webhooks", {
    method: "POST",
    json: { id: crypto.randomUUID(), ...input },
  });
  queryClient.setQueryData<WebhookInfo[]>(webhooksQuery.queryKey, (webhooks) => [...(webhooks ?? []), made.webhook]);
  return made;
}

const putDelivery = (queryClient: QueryClient, delivery: DeliveryInfo) =>
  queryClient.setQueryData<DeliveryInfo[]>(deliveriesQuery(delivery.webhookId).queryKey, (list) => [
    delivery,
    ...(list ?? []).filter((existing) => existing.id !== delivery.id),
  ]);

/** "Send a test event": it goes now, and the answer (or what went wrong) is the newest delivery. */
export async function sendTestEvent(queryClient: QueryClient, webhook: WebhookInfo) {
  if (!canEdit()) return;
  try {
    const { delivery } = await api<DeliveryResponse>(`/webhooks/${webhook.id}/test`, { method: "POST" });
    putDelivery(queryClient, delivery);
    if (delivery.status === "delivered")
      toast.success("Test event arrived", `${hostOf(webhook.url)} answered ${delivery.httpStatus}.`);
    else toast.error("Test event didn't arrive", delivery.error ?? "No answer.");
  } catch {
    toast.error("Couldn't send the test event", "Try again in a moment.");
  } finally {
    void queryClient.invalidateQueries({ queryKey: webhooksQuery.queryKey });
  }
}

export async function retryDelivery(queryClient: QueryClient, webhook: WebhookInfo, delivery: DeliveryInfo) {
  if (!canEdit()) return;
  try {
    const answer = await api<DeliveryResponse>(`/webhooks/${webhook.id}/deliveries/${delivery.id}/retry`, {
      method: "POST",
    });
    putDelivery(queryClient, answer.delivery);
    if (answer.delivery.status !== "delivered")
      toast.error("Still not arriving", answer.delivery.error ?? "No answer.");
  } catch {
    toast.error("Couldn't retry that", "Try again in a moment.");
  } finally {
    void queryClient.invalidateQueries({ queryKey: webhooksQuery.queryKey });
  }
}

/** Removes a webhook at once, with an Undo that brings it back. */
export async function removeWebhook(queryClient: QueryClient, webhook: WebhookInfo) {
  if (!canEdit()) return;
  queryClient.setQueryData<WebhookInfo[]>(webhooksQuery.queryKey, (list) => list?.filter((w) => w.id !== webhook.id));
  try {
    await api(`/webhooks/${webhook.id}`, { method: "DELETE" });
  } catch {
    toast.error("Couldn't remove that webhook", "It's still there.");
    void queryClient.invalidateQueries({ queryKey: webhooksQuery.queryKey });
    return;
  }
  toast.undo("Webhook removed", {
    description: hostOf(webhook.url),
    onUndo: async () => {
      try {
        await api(`/webhooks/${webhook.id}/restore`, { method: "POST" });
      } finally {
        void queryClient.invalidateQueries({ queryKey: webhooksQuery.queryKey });
      }
    },
  });
}

/** "hooks.example.org" from a webhook's address. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What follows the host: "/spaghetti". Empty for a bare address. */
export function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return pathname === "/" && !search ? "" : pathname + search;
  } catch {
    return "";
  }
}
