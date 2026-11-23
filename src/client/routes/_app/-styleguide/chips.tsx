import { useState } from "react";
import { Chip, MoreChip, ToggleChip } from "@/components/ui/Chip";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import * as Icons from "@/components/ui/icons";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { toast } from "@/components/ui/Toast";
import { ValueChip } from "@/components/ui/ValueChip";
import { Label, Panel, Section } from "./shared";

export function ChipSection() {
  const [selected, setSelected] = useState("PLA");
  const [tags, setTags] = useState(["warping"]);
  const [filter, setFilter] = useState<"model" | "design" | null>("model");
  const [status, setStatus] = useState<string[]>(["up"]);
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
          Value chips (`ValueChip`): a setting as an editable value, a pencil at its end and a ring while its field is
          open; semolina when it differs from where it started (the attempt sheet's "Trying something different?")
        </Label>
        <div className="flex flex-wrap gap-1.5">
          <ValueChip>Bambu PETG</ValueChip>
          <ValueChip>0.20 mm layers</ValueChip>
          <ValueChip changed>Nozzle 250 °C</ValueChip>
          <ValueChip open>Bed 65 °C</ValueChip>
        </div>
        <Label>
          Quiet toggle chips (`appearance="quiet"`), for a filter that must sit in running text: words and a count at
          rest, the picked chip's ink pill once picked
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
        <Label>
          Quiet status toggles (`appearance="quiet"` with a tone), on an idea: words at rest, the tone's soft fill when
          on. Ink is for a picked filter only
        </Label>
        <div className="-ml-2.5 flex flex-wrap items-center gap-1">
          <ToggleChip
            appearance="quiet"
            tone="semolina"
            icon={Icons.UpNextIcon}
            selected={status.includes("up")}
            onClick={() => setStatus(status.includes("up") ? status.filter((x) => x !== "up") : [...status, "up"])}
          >
            Up next
          </ToggleChip>
          <ToggleChip
            appearance="quiet"
            tone="tomato"
            icon={Icons.WishIcon}
            selected={status.includes("wish")}
            onClick={() =>
              setStatus(status.includes("wish") ? status.filter((x) => x !== "wish") : [...status, "wish"])
            }
          >
            My wishlist
          </ToggleChip>
        </div>
        <Label>Claude's marks: one quiet line, a sparkle first</Label>
        <div className="flex flex-col gap-2">
          <ClaudeLine working>Looking at the photo…</ClaudeLine>
          <ClaudeLine working>Naming…</ClaudeLine>
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
        <Label>
          Suggested (Claude's, or the printer's "· printer"): unpicked, the suggested outcome tile's dashed ring;
          picked, like any picked tag
        </Label>
        <div className="flex flex-wrap gap-2">
          <ToggleChip tone="tomato" selected={false} suggested>
            Bed adhesion<span className="font-normal"> · suggested</span>
          </ToggleChip>
          <ToggleChip tone="tomato" selected suggested>
            Stringing<span className="font-normal"> · suggested</span>
          </ToggleChip>
          <ToggleChip tone="tomato" selected suggested>
            Spaghetti<span className="font-normal"> · printer</span>
          </ToggleChip>
          <ToggleChip tone="basil" selected={false} suggested>
            Nice surface<span className="font-normal"> · suggested</span>
          </ToggleChip>
        </div>
        <Label>More: a control after a cut-short row, not one more chip</Label>
        <div className="flex flex-wrap gap-2">
          <ToggleChip tone="tomato" selected={false}>
            Warping
          </ToggleChip>
          <MoreChip hidden={15} onClick={() => toast.message("Opens the rest")} />
        </div>
      </Panel>
    </Section>
  );
}
