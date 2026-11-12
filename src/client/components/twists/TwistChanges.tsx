import type { TwistChange } from "@shared/twists";
import {
  CHANGE_KINDS,
  CHANGE_LABELS,
  type ChangeKind,
  changeName,
  TWIST_CHANGE_NOTE_MAX,
  TWIST_CHANGES_MAX,
  TWIST_VALUE_MAX,
} from "@shared/twists";
import { useState } from "react";
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

/** "Scale **84 %** fits the 42 mm grid": the build page's change language, the value on the highlight. */
function ChangeLine({ change, onEdit, readOnly }: { change: TwistChange; onEdit: () => void; readOnly: boolean }) {
  const value = change.value.trim();
  return (
    <button
      type="button"
      onClick={onEdit}
      disabled={readOnly}
      aria-label={`Edit ${changeName(change).toLowerCase()}`}
      className="focus-ring text-body text-ink-soft hover:text-ink block min-h-11 w-full rounded-sm py-2 text-left leading-snug disabled:cursor-default"
    >
      <span className="text-ink font-semibold">{changeName(change)}</span>{" "}
      {value && (
        <span className="bg-semolina-soft/70 text-ink rounded-xs px-1 font-medium whitespace-nowrap">{value}</span>
      )}
      {change.note.trim() && <span className="text-ink-soft"> {change.note.trim()}</span>}
    </button>
  );
}

/** One change turned into fields: its name (for a setting or anything else), its value and its words. */
function ChangeFields({
  change,
  onChange,
  onRemove,
  onDone,
}: {
  change: TwistChange;
  onChange: (next: TwistChange) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const named = change.kind === "param" || change.kind === "other";
  const name = CHANGE_LABELS[change.kind];
  return (
    <fieldset
      className="m-0 grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-0 p-0 py-1.5 @lg:grid-cols-[8rem_9rem_1fr_auto]"
      onBlur={(event) => {
        // Leaving the row ends the edit (Tab to the next field stays in it); a change with nothing in it is dropped.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (!change.value.trim() && !change.note.trim() && !change.label.trim()) onRemove();
        else onDone();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          (event.target as HTMLElement).blur();
        }
      }}
    >
      <legend className="sr-only">{`${name} change`}</legend>
      {named ? (
        <input
          aria-label={`What ${name === "Other" ? "was changed" : "setting"}`}
          className={cn(field, "text-small w-28 font-semibold @lg:w-full")}
          placeholder={name === "Other" ? "What" : "Wall count"}
          maxLength={TWIST_VALUE_MAX}
          value={change.label}
          onChange={(event) => onChange({ ...change, label: event.target.value })}
        />
      ) : (
        <span className="text-small text-ink w-28 pl-1 font-semibold @lg:w-full">{name}</span>
      )}
      <input
        // biome-ignore lint/a11y/noAutofocus: the change was just opened for typing (a tap on its kind, or on its line).
        autoFocus
        aria-label={`${named && change.label ? change.label : name} value`}
        className={cn(field, "min-w-0 font-semibold")}
        placeholder={VALUE_HINTS[change.kind]}
        maxLength={TWIST_VALUE_MAX}
        autoComplete="off"
        enterKeyHint="next"
        value={change.value}
        onChange={(event) => onChange({ ...change, value: event.target.value })}
      />
      <IconButton
        icon={TrashIcon}
        label={`Remove ${name.toLowerCase()}`}
        onClick={onRemove}
        // Safari doesn't focus a button on a click, so the fields' blur would close the row before the click lands:
        // the press itself removes it (a key press still arrives as the click).
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          onRemove();
        }}
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
        value={change.note}
        onChange={(event) => onChange({ ...change, note: event.target.value })}
      />
    </fieldset>
  );
}

/**
 * What we changed, as lines of text, no card around them: "Scale 84 % fits the 42 mm grid". A tap turns a line into
 * its fields (leaving them turns it back), the way a note or a part is edited; the bin shows with the fields, and on
 * hover or focus on a desktop. Adding is one tap on a kind, which opens its value for typing.
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
  const [editing, setEditing] = useState<string | null>(null);
  const full = changes.length >= TWIST_CHANGES_MAX;
  function add(kind: ChangeKind) {
    const id = crypto.randomUUID();
    setEditing(id);
    onChange([...changes, { id, kind, label: "", value: "", note: "" }]);
  }
  const remove = (id: string) => {
    onChange(changes.filter((c) => c.id !== id));
    setEditing((current) => (current === id ? null : current));
  };
  return (
    <div className="flex flex-col gap-3">
      {changes.length > 0 && (
        <ul className="@container flex flex-col" aria-label="Changes">
          {changes.map((change) => (
            <li key={change.id} className="group relative">
              {editing === change.id && !readOnly ? (
                <ChangeFields
                  change={change}
                  onChange={(next) => onChange(changes.map((c) => (c.id === change.id ? next : c)))}
                  onRemove={() => remove(change.id)}
                  onDone={() => setEditing((current) => (current === change.id ? null : current))}
                />
              ) : (
                <>
                  <ChangeLine change={change} readOnly={readOnly} onEdit={() => setEditing(change.id)} />
                  {!readOnly && (
                    <IconButton
                      icon={TrashIcon}
                      label={`Remove ${changeName(change).toLowerCase()}`}
                      size="sm"
                      onClick={() => remove(change.id)}
                      className="absolute top-1/2 right-0 -translate-y-1/2 max-md:hidden md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && !full && (
        <div className="flex flex-col gap-2">
          <p className="text-small text-ink-faint">{changes.length ? "Add another change" : "What did we change?"}</p>
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
