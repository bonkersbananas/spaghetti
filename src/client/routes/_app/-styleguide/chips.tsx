import { useState } from "react";
import { Chip, ToggleChip } from "@/components/ui/Chip";
import * as Icons from "@/components/ui/icons";
import { Label, Panel, Section } from "./shared";

export function ChipSection() {
  const [selected, setSelected] = useState("PLA");
  const [tags, setTags] = useState(["warping"]);
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
