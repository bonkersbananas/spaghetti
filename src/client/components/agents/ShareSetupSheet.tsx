import { recipesAsText, type ShortcutRecipe, shortcutRecipes } from "@shared/shortcut";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { addToken, agentsQuery, createAgent } from "@/lib/agents";
import { sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";

/** The agent that holds the iPhone's token: reused, so setting up twice doesn't pile up agents. */
export const SHARE_AGENT = "Share from iPhone";

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

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-ink/4 shadow-well mt-2 flex flex-col gap-1.5 rounded-md p-3">
      <p className="text-caption text-ink-faint font-semibold">{label}</p>
      <p className="text-caption text-ink-soft font-mono leading-relaxed break-all select-all">{value}</p>
      <Button
        variant="quiet"
        size="sm"
        icon={copied ? CheckIcon : CopyIcon}
        className="self-start"
        aria-live="polite"
        onClick={async () => {
          await copyText(value);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : `Copy ${label.toLowerCase()}`}
      </Button>
    </div>
  );
}

function Recipe({ recipe }: { recipe: ShortcutRecipe }) {
  return (
    <section aria-label={recipe.name} className="flex flex-col gap-2.5">
      <h3 className="text-small text-ink-soft font-sans font-semibold">
        {recipe.name} <span className="text-ink-faint font-normal">for {recipe.accepts}</span>
      </h3>
      <ol className="text-small text-ink-soft flex list-decimal flex-col gap-2.5 pl-5">
        {recipe.steps.map((step) => (
          <li key={step.text}>
            {step.text}
            {step.value && <CopyValue label={step.value.label} value={step.value.value} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "Set up sharing from iPhone": makes a token that can only capture, and walks through building the Shortcut that
 * uses it, with the token already in the steps. Like any token, it is shown here once.
 */
export function ShareSetupSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setToken(null);
      setFailed(false);
      setCopied(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const agents = queryClient.getQueryData(agentsQuery.queryKey) ?? (await queryClient.fetchQuery(agentsQuery));
        const existing = agents.find(
          (agent) =>
            agent.name === SHARE_AGENT && agent.ownerId === queryClient.getQueryData(sessionQuery.queryKey)?.id,
        );
        const made = existing
          ? await addToken(queryClient, existing.id, ["capture"])
          : await createAgent(queryClient, { name: SHARE_AGENT, scopes: ["capture"] });
        if (!cancelled) setToken(made.token);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, queryClient]);

  const recipes = token ? shortcutRecipes(window.location.origin, token) : [];
  const size = isDesktop ? "md" : "lg";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Share from iPhone"
      description="Build two small Shortcuts once; then Share to Spaghetti is in every share sheet. This key can only add ideas, and is shown once."
      footer={
        <>
          {token && (
            <Button
              variant="quiet"
              size={size}
              icon={copied ? CheckIcon : CopyIcon}
              onClick={async () => {
                await copyText(recipesAsText(recipes));
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy all steps"}
            </Button>
          )}
          <Button variant="secondary" size={size} onClick={() => onOpenChange(false)} className="max-md:flex-1">
            Done
          </Button>
        </>
      }
    >
      {failed ? (
        <p className="text-small text-tomato-ink">That didn't go through. Close this and try again in a moment.</p>
      ) : token ? (
        <div className="flex flex-col gap-6" data-testid="share-setup">
          {recipes.map((recipe) => (
            <Recipe key={recipe.name} recipe={recipe} />
          ))}
        </div>
      ) : (
        <p className="text-small text-ink-faint">Making a key that can only add ideas…</p>
      )}
    </Sheet>
  );
}
