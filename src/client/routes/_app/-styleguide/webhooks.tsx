import type { AgentInfo } from "@shared/agents";
import type { DeliveryInfo, WebhookInfo } from "@shared/webhooks";
import { useState } from "react";
import { DeliveryRow, WebhookCard } from "@/components/agents/WebhookCard";
import { WebhookSheet } from "@/components/agents/WebhookSheet";
import { Button } from "@/components/ui/Button";
import { PlusIcon } from "@/components/ui/icons";
import { Label, Panel, Section } from "./shared";

const now = Date.UTC(2026, 9, 21, 12, 0);
const minutes = (n: number) => now - n * 60_000;

const working: WebhookInfo = {
  id: "w1",
  url: "https://hooks.example.org/spaghetti",
  kinds: ["item", "attempt", "comment"],
  agentId: "claude",
  secretPrefix: "whsec_Ab3x9",
  state: "active",
  lastError: null,
  lastErrorAt: null,
  lastDeliveredAt: minutes(12),
  createdAt: minutes(60 * 24 * 3),
};

const failing: WebhookInfo = {
  ...working,
  id: "w2",
  url: "https://printer-notes.example.net/api/spaghetti/events",
  kinds: ["all"],
  agentId: null,
  state: "failing",
  lastError: "It answered 502.",
  lastErrorAt: minutes(95),
  lastDeliveredAt: minutes(60 * 30),
};

const delivery = (id: string, extra: Partial<DeliveryInfo>): DeliveryInfo => ({
  id,
  webhookId: "w1",
  seq: 41,
  test: false,
  entity: "attempt",
  action: "updated",
  status: "delivered",
  attempts: 1,
  httpStatus: 200,
  error: null,
  nextAt: null,
  createdAt: minutes(12),
  lastAttemptAt: minutes(12),
  ...extra,
});

const deliveries: DeliveryInfo[] = [
  delivery("d1", { seq: 42, entity: "comment", action: "created", createdAt: minutes(12), lastAttemptAt: minutes(12) }),
  delivery("d2", {
    seq: 41,
    status: "pending",
    attempts: 2,
    httpStatus: 503,
    error: "It answered 503.",
    nextAt: now + 30 * 60_000,
    lastAttemptAt: minutes(4),
  }),
  delivery("d3", { seq: null, test: true, createdAt: minutes(60 * 22), lastAttemptAt: minutes(60 * 22) }),
  delivery("d4", {
    seq: 33,
    entity: "item",
    action: "created",
    status: "failed",
    attempts: 7,
    httpStatus: null,
    error: "Couldn't connect to it.",
    createdAt: minutes(60 * 30),
    lastAttemptAt: minutes(60 * 6),
  }),
];

const agents: AgentInfo[] = [
  { id: "claude", name: "Claude for Alex", ownerId: "a", createdAt: now, tokens: [] },
  { id: "bridge", name: "Printer bridge", ownerId: "a", createdAt: now, tokens: [] },
];

const noop = () => undefined;

export function WebhooksSection() {
  const [open, setOpen] = useState(true);
  const [sheet, setSheet] = useState(false);
  return (
    <Section
      id="webhooks"
      title="Webhooks"
      note="A small section of the Agents page, not a dashboard: one card per webhook with where it goes, whether it works (or why not, in words and a chip, never colour alone) and its recent deliveries behind a quiet disclosure. Phones put the actions in a row under the status; from tablet width they sit beside the heading."
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Working, deliveries open</Label>
          <ul className="flex flex-col">
            <WebhookCard
              webhook={working}
              agentName="Claude for Alex"
              deliveries={deliveries}
              open={open}
              onOpenChange={setOpen}
              onTest={noop}
              onRemove={noop}
              onRetry={noop}
              now={now}
            />
          </ul>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Failing, with the last error</Label>
          <ul className="flex flex-col">
            <WebhookCard
              webhook={failing}
              deliveries={undefined}
              open={false}
              onOpenChange={noop}
              onTest={noop}
              onRemove={noop}
              onRetry={noop}
              now={now}
            />
          </ul>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Delivery rows</Label>
          <ul className="flex flex-col">
            {deliveries.map((one) => (
              <DeliveryRow key={one.id} delivery={one} onRetry={noop} now={now} />
            ))}
          </ul>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Add a webhook</Label>
          <p className="text-small text-ink-faint">
            A sheet: the address, what it wants, an agent if you like. Then the secret, once, with a Copy button.
          </p>
          <Button icon={PlusIcon} className="self-start" onClick={() => setSheet(true)}>
            Open the sheet
          </Button>
          <WebhookSheet
            open={sheet}
            onOpenChange={setSheet}
            agents={agents}
            create={async (input) => ({
              webhook: { ...working, id: "new", url: input.url, kinds: input.kinds, agentId: input.agentId },
              secret: "whsec_k3P9mQ2xT7vLw0aBn5RyUe8CdHs4JzFgI1oXtVq6MA",
            })}
          />
        </Panel>
      </div>
    </Section>
  );
}
