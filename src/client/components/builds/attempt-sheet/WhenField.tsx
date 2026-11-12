import { useState } from "react";
import { TextField } from "@/components/ui/Field";
import { CalendarIcon } from "@/components/ui/icons";

export const toLocalInput = (time: number) => {
  const date = new Date(time - new Date(time).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};

/** When it printed: "Now" until someone picks another time. */
export function WhenField({ value, onChange }: { value: number | null; onChange: (time: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing && value === null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        // -ml-2.5 takes back its own padding: the icon sits on the edge the label and chips share.
        className="pressable focus-ring touch-target text-small text-ink-soft hover:text-ink rounded-pill relative mb-2 -ml-2.5 inline-flex h-9 items-center gap-1.5 self-start pr-3 pl-2.5 font-semibold md:h-8"
      >
        <CalendarIcon size={16} aria-hidden />
        Printed just now
        <span className="text-ink-faint font-medium">· change</span>
      </button>
    );
  }
  return (
    <TextField
      size="sm"
      type="datetime-local"
      label="When it printed"
      icon={CalendarIcon}
      max={toLocalInput(Date.now())}
      value={toLocalInput(value ?? Date.now())}
      onChange={(event) => {
        const time = new Date(event.target.value).getTime();
        if (Number.isFinite(time)) onChange(Math.min(time, Date.now()));
      }}
      className="max-w-72"
    />
  );
}
