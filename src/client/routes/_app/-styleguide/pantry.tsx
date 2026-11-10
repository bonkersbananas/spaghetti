import type { Spool } from "@shared/api";
import { useState } from "react";
import { EstimateLine } from "@/components/builds/Estimate";
import { FileCard, PlateThumb } from "@/components/builds/SlicerFile";
import { AmsLoadout } from "@/components/pantry/Ams";
import { BridgeLine } from "@/components/pantry/BridgeLine";
import { SpoolCard } from "@/components/pantry/SpoolCard";
import { SpoolRow } from "@/components/pantry/SpoolRow";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { NumberField } from "@/components/ui/Field";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Label, Panel, SAMPLE_COLOR, Section } from "./shared";

const WHITE = "#f4f1ea"; // design-lint-ignore: a filament color is data
const BLACK = "#1d1d1f"; // design-lint-ignore: a filament color is data
const GREEN = "#00ae42"; // design-lint-ignore: a filament color is data
const SILK = "#c9a46b"; // design-lint-ignore: a filament color is data

const TEAL = "#2c8a87"; // design-lint-ignore: a filament color is data

const sampleSpool: Spool = {
  id: "sample-spool",
  material: "PLA",
  brand: "Eryone",
  colorName: "Silk gold",
  colorHex: SILK,
  finish: "silk",
  remaining: "half",
  netGrams: 1000,
  tareGrams: 250,
  gramsLeft: 420,
  gramsApproximate: true,
  weighedAt: null,
  note: "",
  driedAt: null,
  photo: null,
  slot: "A2",
  trayUuid: null,
  createdBy: "a",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export function PantrySection() {
  const [nozzle, setNozzle] = useState<number | undefined>(310);
  return (
    <Section
      id="pantry"
      title="Pantry & printer"
      note="Spools are drawn as spools, in their own color (data, set inline), with a rough meter of what's left. Printer checks are a gentle semolina line, never a dialog; values from a slicer file carry a small file mark until someone changes them."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <Label>Spool discs: sm, md, lg, xl, and an empty slot</Label>
          <div className="flex flex-wrap items-end gap-4">
            <SpoolDisc color={SILK} size="sm" />
            <SpoolDisc color={TEAL} size="md" />
            <SpoolDisc color={SAMPLE_COLOR} size="lg" />
            <SpoolDisc color={SILK} size="xl" />
            <SpoolDisc empty size="lg" />
          </div>
          <Label>Rim: white and black show up on any surface (switch the theme to see both)</Label>
          <div className="flex flex-wrap items-center gap-4">
            {[WHITE, BLACK, GREEN].map((color) => (
              <div key={color}>
                <span className="bg-paper flex items-center gap-2 rounded-lg p-3">
                  <SpoolDisc color={color} size="md" />
                  <SpoolDisc color={color} size="xl" />
                </span>
              </div>
            ))}
          </div>
          <Label>Fill: three fifths of a square parent</Label>
          <div className="flex flex-wrap gap-3">
            {[SILK, WHITE, BLACK].map((color) => (
              <span key={color} className="bg-ink/3 grid size-28 place-items-center rounded-lg">
                <SpoolDisc color={color} size="fill" />
              </span>
            ))}
          </div>
          <Label>What's left</Label>
          <div className="flex flex-wrap gap-4">
            <RemainingMeter remaining="full" showLabel />
            <RemainingMeter remaining="half" showLabel />
            <RemainingMeter remaining="low" showLabel />
            <RemainingMeter remaining="empty" showLabel />
          </div>
          <Label>With grams (the level follows them)</Label>
          <div className="flex flex-wrap gap-4">
            <RemainingMeter remaining="full" gramsLeft={870} showLabel />
            <RemainingMeter remaining="half" gramsLeft={420} showLabel />
            <RemainingMeter remaining="low" gramsLeft={40} showLabel />
          </div>
          <Label>A printer check, and a value from a slicer file</Label>
          <NumberField
            size="sm"
            label="Nozzle"
            mark={<FromFileMark />}
            suffix="°C"
            value={nozzle}
            onChange={setNozzle}
            caution={nozzle !== undefined && nozzle > 300 ? "The X2D's nozzles top out at 300 °C." : undefined}
            className="max-w-48"
          />
          <Caution>TPU doesn't feed well through the AMS: the external spool is safer.</Caution>
        </Panel>
        <div className="flex flex-col gap-4">
          <Label>A spool in the pantry</Label>
          <ul className="grid grid-cols-2 gap-3">
            <SpoolCard spool={sampleSpool} draggable={false} />
            <SpoolCard
              spool={{
                ...sampleSpool,
                id: "sample-2",
                colorName: "Teal",
                colorHex: TEAL,
                material: "PETG",
                brand: "Polymaker",
                finish: null,
                remaining: "low",
                slot: null,
              }}
              draggable={false}
            />
          </ul>
          <Label>The pantry as a list (desktop): low first, empty last, no header row</Label>
          <ul className="bg-cream shadow-soft overflow-hidden rounded-lg">
            <SpoolRow
              draggable={false}
              spool={{ ...sampleSpool, id: "row-1", remaining: "low", driedAt: Date.now() - 12 * 24 * 3_600_000 }}
            />
            <SpoolRow
              draggable={false}
              spool={{ ...sampleSpool, id: "row-2", colorName: "Teal", colorHex: TEAL, finish: null, slot: null }}
            />
            <SpoolRow
              draggable={false}
              spool={{
                ...sampleSpool,
                id: "row-3",
                colorName: "Jade white",
                colorHex: WHITE,
                slot: null,
                remaining: "empty",
              }}
            />
          </ul>
          <Label>A slicer file on an attempt, and how long it took</Label>
          <FileCard name="desk-clips.gcode.3mf" meta={["plate 1 of 2", "est. 1 h 12 min", "14 KB"]} download="#" />
          <EstimateLine estimated={72} actual={78} />
          <div className="flex gap-2">
            <PlateThumb alt="" className="size-16" />
          </div>
        </div>
      </div>
      <Label>The AMS as it is loaded here (live): bays are columns below lg, rows from lg</Label>
      <AmsLoadout readOnly className="md:max-w-3xl" />
      <Label>The printer bridge, in one quiet line: connected, no printer, last heard, not set up</Label>
      <div className="flex flex-col gap-2">
        {[
          { lastSeenAt: Date.now(), printerState: "idle" as const },
          { lastSeenAt: Date.now(), printerState: "offline" as const },
          { lastSeenAt: Date.now() - 3 * 60 * 60 * 1000, printerState: "idle" as const },
        ].map((status) => (
          <BridgeLine
            key={`${status.printerState}-${status.lastSeenAt > Date.now() - 60_000}`}
            status={{ ...status, progress: null, unknownTrays: [] }}
          />
        ))}
        <BridgeLine status={null} />
      </div>
      <p className="text-small text-ink-faint md:max-w-3xl">
        A tray the bridge can't match to a spool shows on its slot as "Which spool?" with what the printer sees; tapping
        it opens the slot's spool picker, as for any slot.
      </p>
    </Section>
  );
}
