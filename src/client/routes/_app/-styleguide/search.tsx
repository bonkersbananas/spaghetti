import { searchTerms } from "@shared/search";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ToggleChip } from "@/components/ui/Chip";
import { ChipDivider, ChipRow, FilterGroup } from "@/components/ui/FilterChips";
import { Highlight } from "@/components/ui/Highlight";
import * as Icons from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { Label, Panel, people, Section } from "./shared";

export function SearchSection() {
  const [outcome, setOutcome] = useState<string | null>("failures");
  const terms = searchTerms("petg warp");
  return (
    <Section
      id="search"
      title="Journal & search"
      note="Chip rows for filters and suggestions, a filter column on desktop, and matched words highlighted."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>ChipRow: scrolls sideways on phones, wraps on desktop</Label>
          <ChipRow label="Filters">
            {[
              ["failures", "Only failures", Icons.LessonsIcon, "tomato"],
              ["success", "Worked", Icons.WorkedIcon, "basil"],
            ].map(([value, label, icon, tone]) => (
              <ToggleChip
                key={value as string}
                selected={outcome === value}
                icon={icon as Icons.Icon}
                tone={tone as "tomato" | "basil"}
                onClick={() => setOutcome(outcome === value ? null : (value as string))}
              >
                {label as string}
              </ToggleChip>
            ))}
            <ChipDivider />
            <ToggleChip selected={false}>PETG</ToggleChip>
            <ToggleChip selected={false}>PLA</ToggleChip>
          </ChipRow>
          <Label>FilterGroup, in the desktop filter column</Label>
          <FilterGroup label="Who">
            {people.map((person) => (
              <ToggleChip key={person.id} selected={person.id === "b"} className="pl-1.5">
                <Avatar person={person} size="xs" />
                {person.name.split(" ")[0]}
              </ToggleChip>
            ))}
          </FilterGroup>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Highlight: the words a search matched (“petg warp”)</Label>
          <p className="text-body text-ink-soft">
            <Highlight text="Corners warped off the cool plate. PETG wants the textured sheet." terms={terms} />
          </p>
          <Label>MetaList: a dot never begins or ends a line (narrow it to see)</Label>
          <div className="bg-ink/4 w-56 rounded-sm p-2">
            <MetaList className="text-small text-ink-faint">
              <span>Black PETG</span>
              <span>0.20 mm</span>
              <span>15% infill</span>
              <span>Cool Plate</span>
              <span className="whitespace-nowrap">nozzle 245 °C</span>
            </MetaList>
          </div>
          <Label>A month heading in the journal</Label>
          <div className="flex flex-col gap-1">
            <Overline as="h3">October</Overline>
            <span className="font-display text-title text-ink-soft">5 prints, 1 spaghetti, phone stand finished</span>
          </div>
        </Panel>
      </div>
    </Section>
  );
}
