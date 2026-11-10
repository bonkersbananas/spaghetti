import { NUDGE_ACTIONS } from "@shared/push";
import { Mark } from "@/components/illustrations";
import { cn } from "@/lib/cn";

/**
 * What a "how did it go?" notification looks like, drawn in the app's own style: a picture for the settings
 * and the styleguide, never the real thing (the system draws that). `actions` are the buttons Android and
 * desktop Chrome add; iPhone has none.
 */
export function NotificationPreview({
  title,
  body,
  actions = true,
  className,
}: {
  title: string;
  body: string;
  actions?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`Example notification: ${title}. ${body}`}
      className={cn("bg-paper rounded-lg p-3.5", className)}
    >
      <div className="flex items-start gap-3" aria-hidden>
        <Mark className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-caption text-ink-faint font-semibold tracking-wider uppercase">Spaghetti · now</p>
          <p className="text-body text-ink mt-0.5 font-semibold">{title}</p>
          <p className="text-small text-ink-soft">{body}</p>
        </div>
      </div>
      {actions && (
        <div className="mt-3 flex gap-2 pl-12" aria-hidden>
          {NUDGE_ACTIONS.map(({ action, title: label }) => (
            <span
              key={action}
              className="text-small text-ink bg-lifted shadow-soft rounded-sm px-3 py-1.5 font-semibold"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
