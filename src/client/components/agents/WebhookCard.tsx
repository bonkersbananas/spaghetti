import { relativeTime } from "@shared/time";
import type { DeliveryInfo, WebhookInfo } from "@shared/webhooks";
import { WEBHOOK_KIND_LABELS } from "@shared/webhooks";
import { Button } from "@/components/ui/Button";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ExpandIcon, PlusIcon, SameAgainIcon, SendIcon, TrashIcon, WebhookIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { hostOf, pathOf } from "@/lib/webhooks";

/** How a delivery reads: a word in a tone, never a colour alone. */
function deliveryLook(delivery: DeliveryInfo): { tone: ChipTone; word: string } {
  if (delivery.status === "delivered") return { tone: "basil", word: "Delivered" };
  if (delivery.status === "failed") return { tone: "tomato", word: "Gave up" };
  return { tone: "semolina", word: delivery.attempts ? "Retrying" : "Waiting" };
}

const ENTITY_WORDS: Record<string, string> = {
  item: "Idea or build",
  attempt: "Attempt",
  photo: "Photo",
  file: "Slicer file",
  comment: "Comment",
  spool: "Spool",
  recipe: "Recipe",
  slot: "AMS slot",
  printer: "Printer",
  tag: "Tag",
  agent: "Agent",
  person: "Person",
};

/** One delivery: what it was about, how it went, when, and a way to send it again. */
export function DeliveryRow({
  delivery,
  readOnly,
  onRetry,
  now = Date.now(),
}: {
  delivery: DeliveryInfo;
  readOnly?: boolean;
  onRetry: () => void;
  now?: number;
}) {
  const { tone, word } = deliveryLook(delivery);
  const what = delivery.test ? "Test event" : `${ENTITY_WORDS[delivery.entity] ?? delivery.entity} ${delivery.action}`;
  const when = relativeTime(delivery.lastAttemptAt ?? delivery.createdAt, now);
  const detail =
    delivery.status === "delivered"
      ? `${delivery.httpStatus} · ${when}`
      : delivery.status === "pending" && delivery.nextAt
        ? `${delivery.error ?? "Not sent yet"} Trying again ${nextWords(delivery.nextAt, now)}.`
        : (delivery.error ?? when);
  return (
    <li className="border-ink/6 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5 border-t py-3 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[5.5rem_1fr_auto]">
      <Chip tone={tone} className="justify-self-start">
        {word}
      </Chip>
      {delivery.status !== "delivered" && (
        <Button
          variant="quiet"
          size="sm"
          icon={SameAgainIcon}
          disabled={readOnly}
          onClick={onRetry}
          className="order-2 -my-1 justify-self-end md:order-3"
        >
          Retry
        </Button>
      )}
      <span className="order-3 col-span-2 flex min-w-0 flex-col gap-0.5 md:order-2 md:col-span-1">
        <span className="text-small text-ink font-semibold">{what}</span>
        <span className="text-small text-ink-faint">{detail}</span>
      </span>
    </li>
  );
}

function nextWords(nextAt: number, now: number) {
  const minutes = Math.max(1, Math.round((nextAt - now) / 60_000));
  return minutes < 90 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`;
}

interface WebhookCardProps {
  webhook: WebhookInfo;
  /** The agent it is for, by name. */
  agentName?: string;
  /** Undefined while the deliveries are loading. */
  deliveries: DeliveryInfo[] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
  onTest: () => void;
  onRemove: () => void;
  onRetry: (delivery: DeliveryInfo) => void;
  /** Sending a test event right now. */
  testing?: boolean;
  now?: number;
}

/**
 * A webhook on the Agents page: where it goes, what it wants, whether it is working (or why it isn't), and under
 * a quiet disclosure the latest deliveries. On a phone the actions sit in a row under the status; from tablet width
 * they sit on the right of the heading.
 */
export function WebhookCard({
  webhook,
  agentName,
  deliveries,
  open,
  onOpenChange,
  readOnly,
  onTest,
  onRemove,
  onRetry,
  testing,
  now = Date.now(),
}: WebhookCardProps) {
  const failing = webhook.state === "failing";
  const path = pathOf(webhook.url);
  const listId = `deliveries-${webhook.id}`;
  return (
    <li className="bg-cream shadow-soft flex flex-col gap-4 rounded-lg p-5">
      <div className="flex items-start gap-3.5">
        <span
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", "bg-ink/6 text-ink-soft")}
          aria-hidden
        >
          <WebhookIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lead text-ink font-semibold break-words">{hostOf(webhook.url)}</h3>
          {path && <p className="text-small text-ink-faint font-mono break-all">{path}</p>}
          <p className="text-small text-ink-faint">
            {agentName ? `For ${agentName}` : "No agent in particular"}
            {" · "}
            {webhook.kinds
              .map((kind) => WEBHOOK_KIND_LABELS[kind])
              .join(", ")
              .toLowerCase()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 max-md:hidden">
          <Button variant="secondary" size="sm" icon={SendIcon} loading={testing} disabled={readOnly} onClick={onTest}>
            Send a test event
          </Button>
          <Button
            variant="quiet"
            size="sm"
            icon={TrashIcon}
            disabled={readOnly}
            onClick={onRemove}
            aria-label={`Remove ${hostOf(webhook.url)}`}
          >
            Remove
          </Button>
        </div>
      </div>

      <p
        className={cn(
          "text-small flex flex-wrap items-center gap-x-2 gap-y-1",
          failing ? "text-tomato-ink" : "text-ink-soft",
        )}
      >
        <Chip tone={failing ? "tomato" : "basil"}>{failing ? "Failing" : "Working"}</Chip>
        {failing ? (
          <span>
            {webhook.lastError ?? "No answer."}
            {webhook.lastErrorAt ? ` Gave up ${relativeTime(webhook.lastErrorAt, now).toLowerCase()}.` : ""}
          </span>
        ) : (
          <span className="text-ink-faint">
            {webhook.lastDeliveredAt
              ? `Last delivery ${relativeTime(webhook.lastDeliveredAt, now).toLowerCase()}`
              : "Nothing sent yet"}
          </span>
        )}
      </p>
      {failing && (
        <p className="text-small text-ink-faint -mt-2">
          New changes still go out, and one that arrives makes it work again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <Button variant="secondary" size="sm" icon={SendIcon} loading={testing} disabled={readOnly} onClick={onTest}>
          Send a test event
        </Button>
        <Button
          variant="quiet"
          size="sm"
          icon={TrashIcon}
          disabled={readOnly}
          onClick={onRemove}
          aria-label={`Remove ${hostOf(webhook.url)}`}
        >
          Remove
        </Button>
      </div>

      <div className="border-ink/6 flex flex-col gap-3 border-t pt-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => onOpenChange(!open)}
          className="pressable focus-ring text-small text-ink-soft -mx-1 flex min-h-9 items-center gap-2 rounded-md px-1 text-left font-semibold"
        >
          Recent deliveries
          <ExpandIcon size={16} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open && (
          <div id={listId}>
            {deliveries === undefined ? (
              <div className="flex flex-col gap-2" aria-hidden>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : deliveries.length ? (
              <ul aria-label="Recent deliveries" className="flex flex-col">
                {deliveries.map((delivery) => (
                  <DeliveryRow
                    key={delivery.id}
                    delivery={delivery}
                    readOnly={readOnly}
                    onRetry={() => onRetry(delivery)}
                    now={now}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-faint">
                Nothing has been sent yet. Send a test event to see one arrive.
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** What the section says before there is a webhook: a quiet card with the one next step, not a whole page's empty state. */
export function WebhooksEmpty({ readOnly, onAdd }: { readOnly?: boolean; onAdd: () => void }) {
  return (
    <div className="bg-ink/3 flex flex-col items-start gap-3 rounded-lg p-5">
      <div>
        <p className="text-lead text-ink font-semibold">Nobody's listening yet</p>
        <p className="text-small text-ink-faint mt-1">
          Add an address and new ideas, prints and comments are sent to it as they happen, so a program doesn't have to
          keep asking.
        </p>
      </div>
      <Button variant="secondary" size="sm" icon={PlusIcon} disabled={readOnly} onClick={onAdd}>
        Add a webhook
      </Button>
    </div>
  );
}
