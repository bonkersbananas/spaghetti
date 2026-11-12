import { HubTile } from "@/components/ui/HubTile";
import { PrinterIcon } from "@/components/ui/icons";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Panel, Section } from "./shared";

const SAMPLE_COLORS = ["#c9402a", "#e8b53a", "#3d7a5a", "#2f6f8f", "#f4f1ea"]; // design-lint-ignore: filament colors are data

export function HubTileSection() {
  return (
    <Section
      id="hub-tile"
      title="Hub tile"
      note="A big way into a place without a tab of its own (the Workshop's Pantry, Printer, Shopping list): the place's contents as a small picture, its name in Fraunces and one line of how things stand."
    >
      <Panel className="flex max-w-md flex-col gap-4">
        <HubTile
          to="/pantry"
          title="Pantry"
          summary="14 spools · 2 running low"
          visual={
            <span className="flex pl-4">
              {SAMPLE_COLORS.map((color) => (
                <SpoolDisc key={color} color={color} size="lg" className="-ml-4 first:ml-0" />
              ))}
            </span>
          }
        />
        <HubTile
          to="/printer"
          title="Printer"
          summary={null}
          visual={<PrinterIcon size={44} className="text-ink-faint" />}
        />
      </Panel>
    </Section>
  );
}
