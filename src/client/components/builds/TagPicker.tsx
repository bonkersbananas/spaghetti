import { type TagKind, tagLabel } from "@shared/attempts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { PlusIcon } from "@/components/ui/icons";
import { addTag, useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";

interface TagPickerProps {
  kind: TagKind;
  value: string[];
  onChange: (slugs: string[]) => void;
  label: string;
  /** How many to show before "more". Picked ones always show. */
  visible?: number;
  className?: string;
}

/**
 * Failure tags or success notes as chips to tap, the common ones first and
 * the rest one tap away. People add their own on the fly; it's offered next
 * time too.
 */
export function TagPicker({ kind, value, onChange, label, visible = 8, className }: TagPickerProps) {
  const queryClient = useQueryClient();
  const options = useTagOptions(kind);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const tone = kind === "failure" ? "tomato" : "basil";

  // Picked tags someone else added, before the list of tags has them.
  const unknown = value.filter((slug) => !options.some((option) => option.slug === slug));
  const shown = expanded ? options : options.filter((option, index) => index < visible || value.includes(option.slug));
  const hidden = options.length - shown.length;

  const toggle = (slug: string) => onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);

  function commit() {
    const slug = draft.trim() ? addTag(queryClient, kind, draft) : null;
    if (slug && !value.includes(slug)) onChange([...value, slug]);
    setDraft("");
    setAdding(false);
  }

  return (
    <fieldset className={cn("flex flex-col gap-2.5", className)}>
      <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {[...shown.map((option) => option.slug), ...unknown].map((slug) => {
          const selected = value.includes(slug);
          return (
            <ToggleChip key={slug} selected={selected} tone={tone} onClick={() => toggle(slug)}>
              {tagLabel(kind, slug, options)}
            </ToggleChip>
          );
        })}
        {hidden > 0 && (
          <ToggleChip selected={false} onClick={() => setExpanded(true)} className="text-ink-faint">
            {hidden} more
          </ToggleChip>
        )}
        {adding ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: it appears because someone tapped "Add your own".
            autoFocus
            aria-label={kind === "failure" ? "New failure tag" : "New success note"}
            placeholder={kind === "failure" ? "What went wrong?" : "What worked?"}
            value={draft}
            maxLength={40}
            enterKeyHint="done"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft("");
                setAdding(false);
              }
            }}
            className="rounded-pill bg-ink/4 shadow-well text-small text-ink placeholder:text-ink-ghost focus:shadow-ring h-9 w-44 px-3.5 font-semibold md:h-8"
          />
        ) : (
          <ToggleChip
            selected={false}
            icon={PlusIcon}
            onClick={() => setAdding(true)}
            className="text-ink-faint ring-ink/10 bg-transparent shadow-none ring-1 ring-inset"
          >
            Add your own
          </ToggleChip>
        )}
      </div>
    </fieldset>
  );
}
