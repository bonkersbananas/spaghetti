import { AGENT_SCOPES, type AgentInfo, type AgentScope, SCOPE_INFO } from "@shared/agents";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { CheckIcon, CopyIcon, KeyIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { addToken, createAgent } from "@/lib/agents";
import { useIsDesktop } from "@/lib/use-media-query";

interface AgentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adding a token to this agent; without it a new agent is made. */
  agent?: AgentInfo;
}

/** The token as it was just made: shown here once, and never again. */
interface Shown {
  token: string;
  agentName: string;
}

/** Writes to the clipboard, with the old way as a fallback for pages without clipboard access. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
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

/**
 * Making a token: a name (for a new agent) and what it may do, then the token itself,
 * once, with a Copy button. A bottom sheet on phones, a dialog on desktop.
 */
export function AgentSheet({ open, onOpenChange, agent }: AgentSheetProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AgentScope[]>(["read"]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // A fresh start each time it opens; what was shown is never kept around.
  useEffect(() => {
    if (!open) return;
    setName("");
    setScopes(["read"]);
    setShown(null);
    setCopied(false);
    setFailed(false);
  }, [open]);

  const ready = scopes.length > 0 && (!!agent || name.trim().length > 0);
  const toggle = (scope: AgentScope) =>
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));

  async function create() {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const made = agent
        ? await addToken(queryClient, agent.id, scopes)
        : await createAgent(queryClient, { name: name.trim(), scopes });
      setShown({ token: made.token, agentName: made.agent.name });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shown) return;
    await copyText(shown.token);
    setCopied(true);
  }

  const size = isDesktop ? "md" : "lg";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={shown ? "Copy your token" : agent ? `New token for ${agent.name}` : "New agent"}
      description={
        shown
          ? "This is the only time it is shown. Paste it where the agent will use it."
          : "Name the helper and say what it may do. You can add or revoke tokens any time."
      }
      footer={
        shown ? (
          <Button variant="secondary" size={size} onClick={() => onOpenChange(false)} className="max-md:flex-1">
            Done
          </Button>
        ) : (
          <Button
            variant="primary"
            size={size}
            icon={KeyIcon}
            disabled={!ready}
            loading={busy}
            onClick={create}
            className="max-md:flex-1"
          >
            Make token
          </Button>
        )
      }
    >
      {shown ? (
        <div className="flex flex-col gap-4">
          <p
            data-testid="new-token"
            className="text-small text-ink bg-ink/4 shadow-well rounded-md p-4 font-mono leading-relaxed break-all select-all"
          >
            {shown.token}
          </p>
          <Button
            variant="primary"
            size={size}
            icon={copied ? CheckIcon : CopyIcon}
            onClick={copy}
            fullWidth
            aria-live="polite"
          >
            {copied ? "Copied" : "Copy token"}
          </Button>
          <p className="text-small text-ink-faint">
            Use it as <span className="font-mono">Authorization: Bearer …</span>. Afterwards only its first letters are
            kept, so you can tell tokens apart. Lost it? Make another and revoke this one.
          </p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          {!agent && (
            <TextField
              label="Name"
              placeholder="Claude for Alex"
              value={name}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              hint={`Shown beside what it does: “via ${name.trim() || "Claude for Alex"}”.`}
            />
          )}
          <fieldset className="flex flex-col gap-3">
            <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">What it may do</legend>
            <div className="flex flex-wrap gap-2">
              {AGENT_SCOPES.map((scope) => (
                <ToggleChip key={scope} selected={scopes.includes(scope)} onClick={() => toggle(scope)}>
                  {SCOPE_INFO[scope].label}
                </ToggleChip>
              ))}
            </div>
            <ul className="text-small text-ink-faint flex flex-col gap-1">
              {AGENT_SCOPES.map((scope) => (
                <li key={scope} className={scopes.includes(scope) ? "text-ink-soft" : undefined}>
                  <span className="font-semibold">{SCOPE_INFO[scope].label}.</span> {SCOPE_INFO[scope].hint}
                </li>
              ))}
            </ul>
          </fieldset>
          {failed && <p className="text-small text-tomato-ink">That didn't go through. Try again in a moment.</p>}
        </form>
      )}
    </Sheet>
  );
}
