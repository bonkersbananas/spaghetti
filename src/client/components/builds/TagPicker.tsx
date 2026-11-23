import { type TagKind, tagLabel } from "@shared/attempts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { collapseChips, MoreChip, ToggleChip } from "@/components/ui/Chip";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { PlusIcon } from "@/components/ui/icons";
import { addTag, useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { facetsQuery } from "@/lib/journal";

interface TagPickerProps {
  kind: TagKind;
  value: string[];
  onChange: (slugs: string[]) => void;
  label: string;
  /** Tags the printer or Claude suggested: marked while they are picked, and always the person's to take off. */
  suggested?: string | readonly string[];
  /** Who suggested them, for the line that says so. */
  suggestedBy?: "printer" | "claude";
  /** Among Claude's suggestions, the one the printer suggested: each gets its own line. */
  printerSuggested?: string;
  /** Tags that say nothing new here (the "Spaghetti" tag under the Spaghetti outcome): left out unless picked. */
  hide?: readonly string[];
  /** How many to show before "more". Picked ones always show. */
  visible?: number;
  /**
   * The few that matter in one row (after a print that went partly or all wrong, under the note): the suggested
   * ones, then the ones this workspace uses most, and "Add your own" with the rest behind "more".
   */
  compact?: boolean;
  className?: string;
}

/**
 * Failure tags or success notes as chips to tap: the suggested ones first (marked "· suggested", picked or not),
 * then the ones this workspace uses most, then the rest, one tap away. People add their own on the fly; it's
 * offered next time too.
 */
export function TagPicker({
  kind,
  value,
  onChange,
  label,
  suggested,
  suggestedBy = "printer",
  printerSuggested,
  hide = [],
  visible = 8,
  compact = false,
  className,
}: TagPickerProps) {
  const queryClient = useQueryClient();
  const allOptions = useTagOptions(kind);
  // The journal's own count of what is in use, most used first. Taken once: a tap saves, the counts change, and the
  // chips must not move under the thumb.
  const { data } = useQuery({ ...facetsQuery, staleTime: 5 * 60_000 });
  const [usage, setUsage] = useState<string[] | null>(null);
  if (data && !usage) setUsage(data.tags.filter((tag) => tag.kind === kind).map((tag) => tag.slug));
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const suggestions = typeof suggested === "string" ? [suggested] : (suggested ?? []);
  // Suggestions not hidden here (the Spaghetti tag under Spaghetti): offered, marked, picked or not. Each source says
  // so in a line of its own.
  const offered = suggestions.filter((slug) => value.includes(slug) || !hide.includes(slug));
  const isPrinters = (slug: string) => (suggestedBy === "printer" ? true : slug === printerSuggested);
  const claudeOffered = offered.filter((slug) => !isPrinters(slug));
  const printerOffered = offered.filter(isPrinters);
  const tone = kind === "failure" ? "tomato" : "basil";

  const rank = (slug: string) => {
    const suggestedAt = suggestions.indexOf(slug);
    if (suggestedAt >= 0) return suggestedAt - 1000;
    const used = usage?.indexOf(slug) ?? -1;
    return used >= 0 ? used : 1000;
  };
  const options = allOptions
    .filter((option) => value.includes(option.slug) || !hide.includes(option.slug))
    .map((option, index) => ({ option, index, rank: rank(option.slug) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ option }) => option);

  // Picked tags someone else added, before the list of tags has them.
  const unknown = value.filter((slug) => !options.some((option) => option.slug === slug));
  const { shown, hidden } = collapseChips(options, {
    visible: compact ? Math.max(4, suggestions.length) : visible,
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
      {claudeOffered.length > 0 && (
        <ClaudeLine className="-mt-1 px-0.5">
          {claudeOffered.some((slug) => value.includes(slug))
            ? "Claude's guess from the photo. Tap to take any off."
            : "Claude's guess from the photo, if any fit."}
        </ClaudeLine>
      )}
      {printerOffered.length > 0 && (
        <p className="text-small text-ink-faint -mt-1 px-0.5">
          {/* Next to Claude's marks, it names its tag rather than "the marked one". */}
          {claudeOffered.length
            ? `The printer suggested ${printerOffered.map((slug) => tagLabel(kind, slug, allOptions)).join(", ")}.`
            : printerOffered.some((slug) => value.includes(slug))
              ? "The printer suggested the marked one. Tap it to take it off."
              : "The printer suggested the marked one."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {[...shown.map((option) => option.slug), ...unknown].map((slug) => {
          const selected = value.includes(slug);
          return (
            <ToggleChip
              key={slug}
              selected={selected}
              tone={tone}
              suggested={suggestions.includes(slug)}
              onClick={() => toggle(slug)}
            >
              {tagLabel(kind, slug, options)}
              {suggestions.includes(slug) && <span className="font-normal"> · suggested</span>}
            </ToggleChip>
          );
        })}
        {hidden > 0 && <MoreChip hidden={hidden} onClick={() => setExpanded(true)} />}
        {compact && hidden > 0 ? null : adding ? (
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
