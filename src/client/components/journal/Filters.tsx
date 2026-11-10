import type { Person } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { OUTCOME_FILTER_LABELS, OUTCOME_FILTERS, type OutcomeFilter } from "@shared/journal";
import { displayName } from "@shared/people";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { outcomeIcons } from "@/components/builds/Outcome";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { type ChipTone, ToggleChip } from "@/components/ui/Chip";
import { ChipDivider, ChipRow, FilterGroup } from "@/components/ui/FilterChips";
import { CloseIcon, type Icon, LessonsIcon } from "@/components/ui/icons";
import { useTagOptions } from "@/lib/builds";
import { type Filters as FilterValues, facetsQuery, hasFilters } from "@/lib/journal";
import { peopleQuery } from "@/lib/queries";

const outcomeLook: Record<OutcomeFilter, { icon: Icon; tone: ChipTone }> = {
  failures: { icon: LessonsIcon, tone: "tomato" },
  success: { icon: outcomeIcons.success, tone: "basil" },
  partial: { icon: outcomeIcons.partial, tone: "semolina" },
  failed: { icon: outcomeIcons.failed, tone: "tomato" },
};

/** "Only failures" first: the wall of lessons. */
const outcomeOrder: OutcomeFilter[] = ["failures", ...OUTCOME_FILTERS.filter((value) => value !== "failures")];

interface FiltersProps {
  value: FilterValues;
  onChange: (next: FilterValues) => void;
  /** "row" scrolls sideways (phones, narrow desktops); "column" stacks groups (the desktop filter column). */
  layout: "row" | "column";
  /** Offer failure tags and success notes too (search). */
  tags?: boolean;
}

/**
 * Filter chips for the journal and search: outcome, material, person (and
 * tags in search). Tapping a picked chip again clears it.
 */
export function Filters({ value, onChange, layout, tags = false }: FiltersProps) {
  const { data: facets } = useQuery(facetsQuery);
  const { data: people } = useQuery(peopleQuery);
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");

  const toggle = <K extends keyof FilterValues>(key: K, next: FilterValues[K]) =>
    onChange({ ...value, [key]: value[key] === next ? undefined : next });

  const materials = [...(facets?.materials.map((m) => m.value) ?? [])].slice(0, 6);
  if (value.material && !materials.includes(value.material)) materials.unshift(value.material);
  const tagList = (facets?.tags ?? []).slice(0, 8);
  if (value.tag && !tagList.some((tag) => tag.slug === value.tag)) {
    tagList.unshift({
      kind: failureOptions.some((t) => t.slug === value.tag) ? "failure" : "success",
      slug: value.tag,
      count: 0,
    });
  }

  const outcomeChips = outcomeOrder.map((outcome) => (
    <ToggleChip
      key={outcome}
      selected={value.outcome === outcome}
      tone={outcomeLook[outcome].tone}
      icon={outcomeLook[outcome].icon}
      onClick={() => toggle("outcome", outcome)}
    >
      {OUTCOME_FILTER_LABELS[outcome]}
    </ToggleChip>
  ));
  const materialChips = materials.map((material) => (
    <ToggleChip key={material} selected={value.material === material} onClick={() => toggle("material", material)}>
      {material}
    </ToggleChip>
  ));
  const tagChip = (tag: (typeof tagList)[number]) => (
    <ToggleChip
      key={`${tag.kind}-${tag.slug}`}
      selected={value.tag === tag.slug}
      tone={tag.kind === "failure" ? "tomato" : "basil"}
      onClick={() => toggle("tag", tag.slug)}
    >
      {tagLabel(tag.kind, tag.slug, tag.kind === "failure" ? failureOptions : successOptions)}
    </ToggleChip>
  );
  const tagChips = tagList.map(tagChip);
  const wrongChips = tagList.filter((tag) => tag.kind === "failure").map(tagChip);
  const rightChips = tagList.filter((tag) => tag.kind === "success").map(tagChip);
  const personChips = (people ?? []).map((person: Person) => (
    <ToggleChip
      key={person.id}
      selected={value.person === person.username}
      onClick={() => toggle("person", person.username)}
      className="pl-1.5"
    >
      <Avatar person={person} size="xs" decorative />
      <span className="sr-only">By </span>
      {displayName(person)}
    </ToggleChip>
  ));
  const clear = hasFilters(value) && (
    <Button variant="quiet" size="sm" icon={CloseIcon} onClick={() => onChange({})} className="self-start">
      Clear filters
    </Button>
  );

  if (layout === "row") {
    const groups: ReactNode[][] = [outcomeChips, materialChips, ...(tags ? [tagChips] : []), personChips].filter(
      (group) => group.length > 0,
    );
    return (
      <ChipRow label="Filters">
        {groups.map((group, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the groups are a fixed list.
          <span key={index} className="contents">
            {index > 0 && <ChipDivider />}
            {group}
          </span>
        ))}
      </ChipRow>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <FilterGroup label="Outcome">{outcomeChips}</FilterGroup>
      {materialChips.length > 0 && <FilterGroup label="Material">{materialChips}</FilterGroup>}
      {tags && wrongChips.length > 0 && <FilterGroup label="What went wrong">{wrongChips}</FilterGroup>}
      {tags && rightChips.length > 0 && <FilterGroup label="What went right">{rightChips}</FilterGroup>}
      {personChips.length > 0 && <FilterGroup label="Who">{personChips}</FilterGroup>}
      {clear}
    </div>
  );
}
