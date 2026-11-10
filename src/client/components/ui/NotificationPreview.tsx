import type { NUDGE_ACTIONS } from "@shared/push";
import { Mark } from "@/components/illustrations";
import { cn } from "@/lib/cn";

/**
 * What a "how did it go?" notification looks like, drawn in the app's own style: a picture for the settings
 * and the styleguide, never the real thing (the system draws that). `actions` are the buttons this device
 * adds: three on Android, two on desktop Chrome, none on iPhone.
 */
export function NotificationPreview({
  title,
  body,
  actions = [],
  className,
}: {
  title: string;
  body: string;
  /** The buttons this device shows (`actionsFor`); none on iPhone. */
  actions?: typeof NUDGE_ACTIONS;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`Example notification: ${title}. ${body}`}
      className={cn("bg-paper pointer-events-none rounded-lg p-3.5 select-none", className)}
    >
      <div className="flex items-start gap-3" aria-hidden>
        <Mark className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-caption text-ink-faint font-semibold tracking-wider uppercase">Spaghetti · now</p>
          <p className="text-body text-ink mt-0.5 font-semibold">{title}</p>
          <p className="text-small text-ink-soft">{body}</p>
        </div>
      </div>
      {actions.length > 0 && (
        <div className="mt-3 flex gap-2 pl-12" aria-hidden>
          {actions.map(({ action, title: label }) => (
            <span key={action} className="text-small text-ink bg-ink/6 rounded-sm px-3 py-1.5 font-semibold">
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
