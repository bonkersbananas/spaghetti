import type { AgentInfo } from "@shared/agents";
import { type NewWebhookResponse, WEBHOOK_KIND_LABELS, WEBHOOK_KINDS, type WebhookKind } from "@shared/webhooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { CheckIcon, CopyIcon, PlusIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { ApiError } from "@/lib/api";
import { useIsDesktop } from "@/lib/use-media-query";
import { createWebhook } from "@/lib/webhooks";

interface WebhookSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Your agents, to say which one a webhook is for. */
  agents: AgentInfo[];
  /** Replaces the request, for the styleguide. */
  create?: (input: { url: string; kinds: WebhookKind[]; agentId: string | null }) => Promise<NewWebhookResponse>;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** The words for a refusal, under the address field when it is about the address. */
function problemWith(error: unknown): { field: boolean; text: string } {
  if (error instanceof ApiError) {
    if (error.code === "unsafe_url") return { field: true, text: error.message };
    if (error.code === "too_many" || error.code === "webhooks_unavailable")
      return { field: false, text: error.message };
  }
  return { field: false, text: "That didn't go through. Try again in a moment." };
}

/**
 * Adding a webhook: where to send changes, which kinds, and (if you like) which agent it is for. Then the signing
 * secret, once, with a Copy button: afterwards only its first letters are kept. A bottom sheet on phones, a dialog
 * on desktop.
 */
export function WebhookSheet({ open, onOpenChange, agents, create }: WebhookSheetProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [url, setUrl] = useState("");
  const [kinds, setKinds] = useState<WebhookKind[]>(["all"]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [made, setMade] = useState<NewWebhookResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: boolean; text: string } | null>(null);

  // A fresh start each time it opens; the secret is never kept around.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setKinds(["all"]);
    setAgentId(null);
    setMade(null);
    setCopied(false);
    setProblem(null);
  }, [open]);

  const pickKind = (kind: WebhookKind) =>
    setKinds((current) => {
      if (kind === "all") return ["all"];
      const without = current.filter((k) => k !== "all");
      const next = without.includes(kind) ? without.filter((k) => k !== kind) : [...without, kind];
      return next.length ? next : ["all"];
    });

  const ready = url.trim().length > 0;
  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const input = { url: url.trim(), kinds, agentId };
      setMade(await (create ? create(input) : createWebhook(queryClient, input)));
    } catch (error) {
      setProblem(problemWith(error));
    } finally {
      setBusy(false);
    }
  }

  const size = isDesktop ? "md" : "lg";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={made ? "Copy the secret" : "New webhook"}
      description={
        made
          ? "This is the only time it is shown. Your receiver uses it to check that a request came from Spaghetti."
          : "Each change is sent to this address as JSON, signed so you can tell it's from here."
      }
      footer={
        made ? (
          <Button variant="secondary" size={size} onClick={() => onOpenChange(false)} className="max-md:flex-1">
            Done
          </Button>
        ) : (
          <Button
            variant="primary"
            size={size}
            icon={PlusIcon}
            disabled={!ready}
            loading={busy}
            onClick={submit}
            className="max-md:flex-1"
          >
            Add webhook
          </Button>
        )
      }
    >
      {made ? (
        <div className="flex flex-col gap-4">
          <p
            data-testid="new-secret"
            className="text-small text-ink bg-ink/4 shadow-well rounded-md p-4 font-mono leading-relaxed break-all select-all"
          >
            {made.secret}
          </p>
          <Button
            variant="primary"
            size={size}
            icon={copied ? CheckIcon : CopyIcon}
            fullWidth
            aria-live="polite"
            onClick={async () => {
              await copyText(made.secret);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy secret"}
          </Button>
          <p className="text-small text-ink-faint">
            Check <span className="font-mono">Spaghetti-Signature</span>: an HMAC-SHA256 of the timestamp, a dot and the
            body, with this secret. Afterwards only its first letters are kept. Lost it? Add a new webhook and remove
            this one.
          </p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextField
            label="Address"
            type="url"
            inputMode="url"
            placeholder="https://example.com/hooks/spaghetti"
            value={url}
            maxLength={2000}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            error={problem?.field ? problem.text : undefined}
            hint="https only, and a public address: nothing on your home network."
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">What it wants</legend>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_KINDS.map((kind) => (
                <ToggleChip key={kind} selected={kinds.includes(kind)} onClick={() => pickKind(kind)}>
                  {WEBHOOK_KIND_LABELS[kind]}
                </ToggleChip>
              ))}
            </div>
          </fieldset>
          {agents.length > 0 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">Which agent it is for</legend>
              <div className="flex flex-wrap gap-2">
                <ToggleChip selected={agentId === null} onClick={() => setAgentId(null)}>
                  None in particular
                </ToggleChip>
                {agents.map((agent) => (
                  <ToggleChip key={agent.id} selected={agentId === agent.id} onClick={() => setAgentId(agent.id)}>
                    {agent.name}
                  </ToggleChip>
                ))}
              </div>
              <p className="text-small text-ink-faint">
                Just a label, so you remember. It doesn't change what is sent.
              </p>
            </fieldset>
          )}
          {problem && !problem.field && <p className="text-small text-tomato-ink">{problem.text}</p>}
        </form>
      )}
    </Sheet>
  );
}
