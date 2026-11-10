import { GROUP_LABELS, keycaps, SHORTCUT_COLUMNS, type ShortcutGroup, shortcutsIn } from "@shared/shortcuts";
import { cn } from "@/lib/cn";
import { isMac } from "@/lib/hotkeys";
import { Kbd } from "./Kbd";

/**
 * Every shortcut, grouped by where it works, read straight from the registry
 * in shared/shortcuts.ts, in three columns on desktop. Alternatives for the
 * same thing sit side by side ("J  ↓").
 */
export function ShortcutList({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-x-10 md:grid-cols-3", className)}>
      {SHORTCUT_COLUMNS.map((groups) => (
        <div key={groups.join()} className="flex min-w-0 flex-col gap-7 pb-7 md:pb-0">
          {groups.map((group) => (
            <Group key={group} group={group} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Group({ group }: { group: ShortcutGroup }) {
  return (
    <section aria-labelledby={`shortcuts-${group}`}>
      <h3
        id={`shortcuts-${group}`}
        className="text-caption text-ink-faint mb-2 font-sans font-semibold tracking-wider uppercase"
      >
        {GROUP_LABELS[group]}
      </h3>
      <dl className="flex flex-col">
        {shortcutsIn(group).map((shortcut) => (
          <div key={shortcut.id} className="flex items-center justify-between gap-4 py-1">
            <dt className="text-small text-ink-soft">{shortcut.label}</dt>
            <dd className="flex shrink-0 items-center gap-1.5">
              {shortcut.keys.map((key, index) => (
                <span key={key} className="flex items-center gap-1.5">
                  {index > 0 && <span className="text-caption text-ink-faint">or</span>}
                  <Kbd keys={keycaps(key, isMac)} always />
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
