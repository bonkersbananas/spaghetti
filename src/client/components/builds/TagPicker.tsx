import { type TagKind, tagLabel } from "@shared/attempts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { collapseChips, MoreChip, ToggleChip } from "@/components/ui/Chip";
import { PlusIcon } from "@/components/ui/icons";
import { addTag, useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";

interface TagPickerProps {
  kind: TagKind;
  value: string[];
  onChange: (slugs: string[]) => void;
  label: string;
  /** Tags the printer or Claude suggested: marked while they are picked, and always the person's to take off. */
  suggested?: string | readonly string[];
  /** Who suggested them, for the line that says so. */
  suggestedBy?: "printer" | "claude";
  /** How many to show before "more". Picked ones always show. */
  visible?: number;
  className?: string;
}

/**
 * Failure tags or success notes as chips to tap, the common ones first and
 * the rest one tap away. People add their own on the fly; it's offered next
 * time too.
 */
export function TagPicker({
  kind,
  value,
  onChange,
  label,
  suggested,
  suggestedBy = "printer",
  visible = 8,
  className,
}: TagPickerProps) {
  const queryClient = useQueryClient();
  const options = useTagOptions(kind);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const suggestions = typeof suggested === "string" ? [suggested] : (suggested ?? []);
  const showing = suggestions.filter((slug) => value.includes(slug));
  const tone = kind === "failure" ? "tomato" : "basil";

  // Picked tags someone else added, before the list of tags has them.
  const unknown = value.filter((slug) => !options.some((option) => option.slug === slug));
  const { shown, hidden } = collapseChips(options, {
    visible,
    picked: (option) => value.includes(option.slug),
    expanded,
  });

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
      {showing.length > 0 && (
        <p className="text-small text-ink-faint -mt-1 px-0.5">
          {suggestedBy === "claude"
            ? `Claude suggested the marked ${showing.length === 1 ? "one" : "ones"} from the photo. Tap to take ${showing.length === 1 ? "it" : "any"} off.`
            : "The printer suggested the marked one. Tap it to take it off."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {[...shown.map((option) => option.slug), ...unknown].map((slug) => {
          const selected = value.includes(slug);
          return (
            <ToggleChip key={slug} selected={selected} tone={tone} onClick={() => toggle(slug)}>
              {tagLabel(kind, slug, options)}
              {suggestions.includes(slug) && selected && <span className="font-normal"> · suggested</span>}
            </ToggleChip>
          );
        })}
        {hidden > 0 && <MoreChip hidden={hidden} onClick={() => setExpanded(true)} />}
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
            className="rounded-pill bg-ink/4 shadow-well text-body md:text-small text-ink placeholder:text-ink-faint focus:shadow-ring h-9 w-44 px-3.5 font-semibold md:h-8"
            // 16 px on phones: iOS Safari zooms into any field set smaller.
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
