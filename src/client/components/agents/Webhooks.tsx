import type { AgentInfo } from "@shared/agents";
import type { WebhookInfo } from "@shared/webhooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PlusIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { featuresQuery } from "@/lib/drafts";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { deliveriesQuery, removeWebhook, retryDelivery, sendTestEvent, webhooksQuery } from "@/lib/webhooks";
import { WebhookCard, WebhooksEmpty } from "./WebhookCard";
import { WebhookSheet } from "./WebhookSheet";

/** A card that follows its own deliveries while it is open. */
function Card({ webhook, agents, readOnly }: { webhook: WebhookInfo; agents: AgentInfo[]; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const { data: deliveries } = useQuery({
    ...deliveriesQuery(webhook.id),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });
  return (
    <WebhookCard
      webhook={webhook}
      agentName={agents.find((agent) => agent.id === webhook.agentId)?.name}
      deliveries={deliveries}
      open={open}
      onOpenChange={setOpen}
      readOnly={readOnly}
      testing={testing}
      onTest={async () => {
        setTesting(true);
        setOpen(true);
        await sendTestEvent(queryClient, webhook);
        setTesting(false);
      }}
      onRemove={() => removeWebhook(queryClient, webhook)}
      onRetry={(delivery) => retryDelivery(queryClient, webhook, delivery)}
    />
  );
}

/**
 * The webhooks section of the Agents page: the change feed sent to addresses you chose. A small section, not a
 * dashboard: a line about what it is, then one card per webhook. Loaded on its own, after the page.
 */
export default function Webhooks({ agents }: { agents: AgentInfo[] }) {
  const readOnly = useReadOnly();
  const { data: features } = useQuery(featuresQuery);
  const { data: webhooks, isPending } = useQuery({ ...webhooksQuery, enabled: features?.webhooks === true });
  const [adding, setAdding] = useState(false);
  if (features && !features.webhooks) {
    return (
      <Section id="webhooks" title="Webhooks" className="max-w-2xl">
        <p className="text-small text-ink-faint">Webhooks need a key on the server; see docs/deploy.md.</p>
      </Section>
    );
  }
  return (
    <Section
      id="webhooks"
      className="max-w-2xl"
      title="Webhooks"
      description="Tell another program when something changes, instead of it asking. Each change is sent as signed JSON."
      aside={
        <Button
          variant="quiet"
          size="sm"
          icon={PlusIcon}
          disabled={readOnly}
          onClick={() => canEdit() && setAdding(true)}
        >
          New webhook
        </Button>
      }
    >
      {isPending || !features ? (
        <div className="flex max-w-2xl flex-col gap-3" aria-hidden>
          <RowSkeleton />
        </div>
      ) : webhooks?.length ? (
        <ul className="flex max-w-2xl flex-col gap-4" aria-label="Your webhooks">
          {webhooks.map((webhook) => (
            <Card key={webhook.id} webhook={webhook} agents={agents} readOnly={readOnly} />
          ))}
        </ul>
      ) : (
        <WebhooksEmpty readOnly={readOnly} onAdd={() => canEdit() && setAdding(true)} />
      )}
      <WebhookSheet open={adding} onOpenChange={setAdding} agents={agents} />
    </Section>
  );
}
