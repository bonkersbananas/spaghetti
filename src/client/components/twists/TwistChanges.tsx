import type { TwistChange } from "@shared/twists";
import {
  CHANGE_KINDS,
  CHANGE_LABELS,
  type ChangeKind,
  TWIST_CHANGE_NOTE_MAX,
  TWIST_CHANGES_MAX,
  TWIST_VALUE_MAX,
} from "@shared/twists";
import { useRef } from "react";
import { IconButton } from "@/components/ui/Button";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** What each kind of change asks for, as a hint in its value field. */
const VALUE_HINTS: Record<ChangeKind, string> = {
  scale: "84 %",
  tolerance: "+0.2 mm",
  text: "Marie",
  material: "PETG",
  param: "2.4 mm",
  other: "In a few words",
};

const field =
  "text-body text-ink placeholder:text-ink-faint bg-ink/4 shadow-well focus:shadow-ring min-h-11 w-full rounded-md px-3 transition-shadow duration-fast outline-none disabled:opacity-60";

/** One change: its name, its value, a line of words and a way to take it out. */
function ChangeRow({
  change,
  readOnly,
  onChange,
  onRemove,
  inputRef,
}: {
  change: TwistChange;
  readOnly: boolean;
  onChange: (next: TwistChange) => void;
  onRemove: () => void;
  inputRef?: (element: HTMLInputElement | null) => void;
}) {
  const named = change.kind === "param" || change.kind === "other";
  const name = CHANGE_LABELS[change.kind];
  return (
    <li className="bg-cream shadow-soft grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg p-3 @lg:grid-cols-[8rem_9rem_1fr_auto]">
      {named ? (
        <input
          aria-label={`What ${name === "Other" ? "was changed" : "setting"}`}
          className={cn(field, "text-small w-28 font-semibold @lg:w-full")}
          placeholder={name === "Other" ? "What" : "Wall count"}
          maxLength={TWIST_VALUE_MAX}
          readOnly={readOnly}
          value={change.label}
          onChange={(event) => onChange({ ...change, label: event.target.value })}
        />
      ) : (
        <span className="text-small text-ink-soft w-28 pl-1 font-semibold @lg:w-full">{name}</span>
      )}
      <input
        ref={inputRef}
        aria-label={`${named && change.label ? change.label : name} value`}
        className={cn(field, "min-w-0 font-semibold")}
        placeholder={VALUE_HINTS[change.kind]}
        maxLength={TWIST_VALUE_MAX}
        readOnly={readOnly}
        autoComplete="off"
        enterKeyHint="next"
        value={change.value}
        onChange={(event) => onChange({ ...change, value: event.target.value })}
      />
      <IconButton
        icon={TrashIcon}
        label={`Remove ${name.toLowerCase()}`}
        disabled={readOnly}
        onClick={onRemove}
        className="@lg:col-start-4 @lg:row-start-1"
      />
      <input
        aria-label={`Why, for ${name.toLowerCase()}`}
        className={cn(
          field,
          "text-small text-ink-soft col-span-3 min-h-10 @lg:col-span-1 @lg:col-start-3 @lg:row-start-1",
        )}
        placeholder="Why, or what it fixed (optional)"
        maxLength={TWIST_CHANGE_NOTE_MAX}
        readOnly={readOnly}
        value={change.note}
        onChange={(event) => onChange({ ...change, note: event.target.value })}
      />
    </li>
  );
}

/**
 * What we changed, as a list of rows people fill in: each a kind, a value and a few words. Adding is one tap on a kind
 * (the new row's value is focused, so typing starts at once); the list autosaves from the page.
 */
export function TwistChanges({
  changes,
  readOnly,
  onChange,
}: {
  changes: TwistChange[];
  readOnly: boolean;
  onChange: (next: TwistChange[]) => void;
}) {
  const focusId = useRef<string | null>(null);
  const full = changes.length >= TWIST_CHANGES_MAX;
  function add(kind: ChangeKind) {
    const id = crypto.randomUUID();
    focusId.current = id;
    onChange([...changes, { id, kind, label: "", value: "", note: "" }]);
  }
  return (
    <div className="flex flex-col gap-3">
      {changes.length > 0 && (
        <ul className="@container flex flex-col gap-2.5" aria-label="Changes">
          {changes.map((change) => (
            <ChangeRow
              key={change.id}
              change={change}
              readOnly={readOnly}
              inputRef={(element) => {
                if (element && focusId.current === change.id) {
                  focusId.current = null;
                  element.focus();
                }
              }}
              onChange={(next) => onChange(changes.map((c) => (c.id === change.id ? next : c)))}
              onRemove={() => onChange(changes.filter((c) => c.id !== change.id))}
            />
          ))}
        </ul>
      )}
      {!readOnly && !full && (
        <div className="flex flex-col gap-2">
          <p className="text-small text-ink-faint">{changes.length ? "Add another change" : "What did you change?"}</p>
          <div className="flex flex-wrap gap-2">
            {CHANGE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => add(kind)}
                className="pressable focus-ring touch-target text-small text-ink-soft hover:text-ink bg-cream shadow-soft relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-semibold md:h-8"
              >
                <PlusIcon size={14} weight="bold" aria-hidden />
                {CHANGE_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
