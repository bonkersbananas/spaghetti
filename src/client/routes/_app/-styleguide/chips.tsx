import { useState } from "react";
import { Chip, ToggleChip } from "@/components/ui/Chip";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import * as Icons from "@/components/ui/icons";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Label, Panel, Section } from "./shared";

export function ChipSection() {
  const [selected, setSelected] = useState("PLA");
  const [tags, setTags] = useState(["warping"]);
  const [filter, setFilter] = useState<"model" | "design" | null>("model");
  return (
    <Section id="chips" title="Chips" note="Labels for status and materials; toggle chips for filters.">
      <Panel className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <Chip>Idea</Chip>
          <Chip tone="semolina" icon={Icons.ClockIcon}>
            Printing
          </Chip>
          <Chip tone="basil" icon={Icons.CheckIcon}>
            Worked
          </Chip>
          <Chip tone="tomato" icon={Icons.WarningIcon}>
            Spaghetti
          </Chip>
          <Chip icon={Icons.LayersIcon}>0.2 mm</Chip>
          <Chip icon={Icons.TemperatureIcon}>220 °C</Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          {["PLA", "PETG", "TPU", "ABS"].map((m) => (
            <ToggleChip key={m} selected={selected === m} onClick={() => setSelected(m)}>
              {m}
            </ToggleChip>
          ))}
        </div>
        <Label>
          Quiet toggle chips (`appearance="quiet"`), for a filter or two right after a section's heading: words and a
          count at rest, the picked chip's ink pill once picked
        </Label>
        <div className="flex flex-wrap items-baseline gap-x-5">
          <SectionHeading id="styleguide-quiet-chips">The rest</SectionHeading>
          {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset. */}
          <div role="group" aria-label="Filter ideas" className="-ml-2.5 flex flex-wrap items-baseline">
            <ToggleChip
              appearance="quiet"
              selected={filter === "model"}
              count={3}
              onClick={() => setFilter(filter === "model" ? null : "model")}
            >
              Has a model
            </ToggleChip>
            <ToggleChip
              appearance="quiet"
              selected={filter === "design"}
              count={12}
              onClick={() => setFilter(filter === "design" ? null : "design")}
            >
              Needs designing
            </ToggleChip>
          </div>
        </div>
        <Label>Claude's marks: one quiet line, a sparkle first</Label>
        <div className="flex flex-col gap-2">
          <ClaudeLine working>Looking at the photo…</ClaudeLine>
          <ClaudeLine>Drafted by Claude from MakerWorld</ClaudeLine>
        </div>
        <Label>Toned toggle chips, for tags</Label>
        <div className="flex flex-wrap gap-2">
          {["warping", "stringing"].map((tag) => (
            <ToggleChip
              key={tag}
              tone="tomato"
              selected={tags.includes(tag)}
              onClick={() => setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])}
            >
              {tag === "warping" ? "Warping" : "Stringing"}
            </ToggleChip>
          ))}
          <ToggleChip tone="basil" selected>
            Great first layer
          </ToggleChip>
          <ToggleChip tone="semolina" selected icon={Icons.DriedIcon}>
            Dried
          </ToggleChip>
        </div>
      </Panel>
    </Section>
  );
}
