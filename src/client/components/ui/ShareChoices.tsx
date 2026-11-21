import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { CopyIcon, type Icon, PrivateIcon, PublicIcon, ShareIcon } from "./icons";

export type PublicLinkState = "off" | "making" | "on";

interface ShareChoicesProps {
  /** Whether a public link is live, being made, or not. */
  state: PublicLinkState;
  /** The public link's address, while it is on. */
  publicUrl?: string;
  /** When it was made, in words ("Since 21 Nov"). */
  since?: string;
  /** Phones hand links to the system share sheet; computers copy them. */
  canShare: boolean;
  /** Offline, or otherwise unable to change it: the private link still works. */
  readOnly?: boolean;
  onPrivate: () => void;
  onMake: () => void;
  onPublic: () => void;
  onStop: () => void;
}

/** One way to share: a soft tile with its icon, what it is, a quiet line, and its action at the end. */
function Choice({
  icon: IconComponent,
  tone,
  title,
  meta,
  action,
  children,
}: {
  icon: Icon;
  tone?: "basil";
  title: string;
  meta: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            tone === "basil" ? "bg-basil-soft text-basil-ink" : "bg-ink/4 text-ink-soft",
          )}
        >
          <IconComponent size={20} weight={tone === "basil" ? "fill" : "regular"} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="text-body text-ink block font-semibold text-balance">{title}</span>
          <span className="text-small text-ink-faint block text-pretty">{meta}</span>
        </span>
        {action && <span className="shrink-0 pt-0.5">{action}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * How to share an idea, build or twist (decision 0075): the private link (the page itself, for the two people) and
 * the public one (a read-only page anyone with the link can look at), made, copied again and stopped here. What the
 * share button opens: a popover on desktop, a sheet on phones (components/share/SharePanel.tsx).
 */
export function ShareChoices({
  state,
  publicUrl,
  since,
  canShare,
  readOnly,
  onPrivate,
  onMake,
  onPublic,
  onStop,
}: ShareChoicesProps) {
  const send = canShare ? ShareIcon : CopyIcon;
  return (
    <div className="divide-hairline flex flex-col divide-y">
      <Choice
        icon={PrivateIcon}
        title="Only the two of you"
        meta="Opens it here in Spaghetti, signed in."
        action={
          <Button variant="secondary" size="sm" icon={send} onClick={onPrivate}>
            {canShare ? "Share" : "Copy link"}
          </Button>
        }
      />
      {state === "on" && publicUrl ? (
        <Choice
          icon={PublicIcon}
          tone="basil"
          title="Anyone with the link can look"
          meta={[since, "they can look, not change"].filter(Boolean).join(" · ")}
          action={
            readOnly ? undefined : (
              <Button variant="danger" size="sm" onClick={onStop}>
                Stop sharing
              </Button>
            )
          }
        >
          <div className="bg-ink/4 flex min-h-11 items-center gap-2 rounded-md py-1.5 pr-1.5 pl-3">
            <span className="text-small text-ink-soft min-w-0 flex-1 truncate" title={publicUrl}>
              {publicUrl.replace(/^https?:\/\//, "")}
            </span>
            {!canShare && (
              <Button variant="secondary" size="sm" icon={CopyIcon} onClick={onPublic}>
                Copy
              </Button>
            )}
          </div>
          {canShare && (
            <Button variant="primary" icon={ShareIcon} fullWidth onClick={onPublic}>
              Share the link
            </Button>
          )}
        </Choice>
      ) : (
        <Choice
          icon={PublicIcon}
          title="Anyone with the link"
          meta="A read-only page: the photos, the notes and how it printed."
          action={
            <Button variant="secondary" size="sm" loading={state === "making"} disabled={readOnly} onClick={onMake}>
              {state === "making" ? "Making…" : "Make a link"}
            </Button>
          }
        />
      )}
    </div>
  );
}
