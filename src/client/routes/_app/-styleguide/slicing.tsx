import { DEFAULT_SLICING } from "@shared/slicing/defaults.ts";
import { filamentOfSpool } from "@shared/slicing/pantry.ts";
import {
  QUALITIES,
  type QualityId,
  type SlicingSettings,
  STRENGTHS,
  SUPPORT_PLACEMENTS,
} from "@shared/slicing/settings.ts";
import type { FileSlice } from "@shared/slicing/types.ts";
import type { SpoolLike } from "@shared/spools";
import { useState } from "react";
import { ModelCard, type ModelState, SliceResult } from "@/components/builds/ModelFile";
import { SliceSettingsPanel } from "@/components/builds/SliceSettings";
import { BeforeAfter } from "@/components/ui/BeforeAfter";
import { ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { LayersGlyph, StrengthGlyph, SupportsGlyph } from "@/components/ui/SlicingGlyphs";
import { ThreeDButton } from "@/components/viewer/ThreeDButton";
import type { AttemptFileView } from "@/lib/items";
import { Label, Panel, Section } from "./shared";

const ORANGE = "#f2754e"; // design-lint-ignore: a filament color is data
const BLACK = "#1d1d1f"; // design-lint-ignore: a filament color is data
const WHITE = "#f4f1ea"; // design-lint-ignore: a filament color is data
const TEAL = "#2c8a87"; // design-lint-ignore: a filament color is data

const spool = (id: string, change: Partial<SpoolLike>): SpoolLike => ({
  id,
  material: "PLA",
  brand: "Bambu Lab",
  finish: "basic",
  remaining: "full",
  slot: null,
  ...change,
});

/** A pantry to pick from: two loaded, two on the shelf. */
const SPOOLS: SpoolLike[] = [
  spool("orange", { colorName: "Orange", colorHex: ORANGE, slot: "A1" }),
  spool("black", { material: "PETG", colorName: "Black", colorHex: BLACK, finish: null, slot: "A2" }),
  spool("white", { colorName: "Jade white", colorHex: WHITE, finish: "matte" }),
  spool("teal", { colorName: "Teal", colorHex: TEAL, finish: "silk" }),
];

const SETTINGS: SlicingSettings = {
  ...DEFAULT_SLICING,
  layerHeight: 0.12,
  supports: "where-needed",
  filaments: [filamentOfSpool(SPOOLS[0] as SpoolLike)],
};

/** A model sliced Fine in orange PLA with supports where needed. */
const SAMPLE_SLICE: FileSlice = {
  status: "sliced",
  settings: {
    machine: "Bambu Lab X2D 0.4 nozzle",
    process: "0.12mm High Quality @BBL X2D",
    filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
    layerHeight: 0.12,
    materials: ["PLA"],
    bedType: "Textured PEI Plate",
    supports: true,
    scale: 100,
    engine: "1",
    orca: "2.5.0-dev",
    slicing: SETTINGS,
  },
  bytes: 2_150_000,
  at: 0,
};
const FLOATING: FileSlice = {
  ...SAMPLE_SLICE,
  cautions: ["floating"],
  settings: { ...SAMPLE_SLICE.settings, supports: false, slicing: { ...SETTINGS, supports: "off" } },
};
const TOO_BIG: FileSlice = {
  ...SAMPLE_SLICE,
  status: "failed",
  problem: "too-big",
  dimensions: [320, 100, 4],
  volume: [256, 256, 261],
  fitScale: 78,
};
const CHANGE = { before: { minutes: 72, grams: 14 }, after: { minutes: 48, grams: 11.2 } };
const noop = () => undefined;
const PREFILL = { estimatedMinutes: 48, weightGrams: 11.2 };

/** The sliced model the specimens' 3D control would open (there is no such file: the view says it can't read it). */
const SAMPLE_MODEL: AttemptFileView = {
  id: "styleguide-model",
  name: "fusilli-knob.stl",
  size: 1_200_000,
  stored: true,
  hasThumb: false,
  plate: 1,
  plateCount: 1,
  slicer: null,
  prefill: PREFILL,
  objects: [],
  kind: "model",
  slice: SAMPLE_SLICE,
  createdAt: 0,
};

const sliced = (more: Partial<Extract<ModelState, { kind: "sliced" }>> = {}): ModelState => ({
  kind: "sliced",
  slice: SAMPLE_SLICE,
  saved: true,
  ...more,
});

export function SlicingSection() {
  const [quality, setQuality] = useState<QualityId>("fine");
  const [settings, setSettings] = useState(SETTINGS);
  return (
    <Section
      id="slicing"
      title="Slicing"
      note="Models Spaghetti slices in the browser, and how people set them up: a few big choices that say what they do, the rest under More (decision 0047)."
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Label>Choice tiles: a picture, a name, a figure, and what the picked one does</Label>
          <Panel>
            <ChoiceTiles<QualityId>
              label="Quality"
              columns={2}
              wideColumns={4}
              options={QUALITIES.map((choice) => ({
                value: choice.id,
                label: choice.label,
                detail: `${choice.layerHeight.toFixed(2)} mm`,
                effect: choice.effect,
                glyph: <LayersGlyph quality={choice.id} />,
              }))}
              value={quality}
              onChange={setQuality}
            />
          </Panel>
          <Label>Glyphs: the layers of each quality, how solid each strength is, where supports go</Label>
          <div className="text-ink-soft flex flex-wrap items-center gap-4">
            {QUALITIES.map((choice) => (
              <LayersGlyph key={choice.id} quality={choice.id} />
            ))}
            <span className="bg-ink/10 h-6 w-px" aria-hidden />
            {STRENGTHS.map((choice) => (
              <StrengthGlyph key={choice.id} strength={choice.id} />
            ))}
            <span className="bg-ink/10 h-6 w-px" aria-hidden />
            {SUPPORT_PLACEMENTS.map((choice) => (
              <SupportsGlyph key={choice.id} placement={choice.id} />
            ))}
          </div>
          <Label>Before → after: what a change did, the new figure in ink</Label>
          <BeforeAfter
            size="md"
            changes={[
              { label: "time", before: "1 h 12 min", after: "48 min" },
              { label: "filament", before: "14 g", after: "11.2 g" },
            ]}
          />
          <BeforeAfter
            changes={[
              { label: "time", before: "36 min", after: "52 min" },
              { label: "filament", before: "10.6 g", after: "10.6 g" },
            ]}
          />

          <Label>
            A model Spaghetti slices: saving, waiting (a pulse), slicing, sliced (led by the print, the name quieter,
            and how it was sliced), a caution and its one tap, why it couldn't be, and not sliced yet
          </Label>
          <ModelCard name="fusilli-knob.stl" state={{ kind: "saving" }} phone={false} />
          <ModelCard name="fusilli-knob.stl" state={{ kind: "waiting" }} phone={false} />
          <ModelCard name="fusilli-knob.stl" state={{ kind: "slicing", fraction: 0.05 }} phone={false} />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced()}
            prefill={PREFILL}
            download="#"
            details={{ open: noop }}
            phone={false}
          />
          <ModelCard
            name="steampunk-glasses.stl"
            state={sliced({ slice: FLOATING })}
            prefill={{ estimatedMinutes: 76, weightGrams: 7.7 }}
            download="#"
            onSlice={noop}
            details={{ open: noop }}
            phone={false}
          />
          <ModelCard
            name="lasagne-sheet.stl"
            state={{ kind: "failed", slice: TOO_BIG }}
            onSlice={noop}
            details={{ open: noop }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={{ kind: "unsliced" }}
            onSlice={noop}
            details={{ open: noop }}
            phone={false}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Label>
            Changed: slicing again with the slice there kept in view (Stop keeps it), then what the change did, with its
            undo; settings changed elsewhere and not sliced yet; a change it couldn't slice
          </Label>
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ again: { fraction: 0.42, words: "Fine" } })}
            prefill={{ estimatedMinutes: 72, weightGrams: 14 }}
            download="#"
            onStop={noop}
            details={{ open: noop }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ change: CHANGE })}
            prefill={PREFILL}
            download="#"
            onUndo={noop}
            details={{ open: noop }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ ahead: true })}
            prefill={PREFILL}
            download="#"
            onSlice={noop}
            details={{ open: noop }}
            phone={false}
          />
          <ModelCard
            name="lasagne-sheet.stl"
            state={{ kind: "failed", slice: TOO_BIG, change: { ...CHANGE, after: {}, failed: true } }}
            onSlice={noop}
            onUndo={noop}
            details={{ open: noop }}
            phone={false}
          />
          <Label>
            On an idea (raised: a 96 px plate with the 3D pill, its actions in the top corner); on a story card
            (compact: the 3D control a corner glyph, and only "Sliced by Spaghetti", which opens the settings); in an
            attempt's sheet on phones the settings don't open
          </Label>
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced()}
            prefill={PREFILL}
            download="#"
            plateOverlay={<ThreeDButton file={SAMPLE_MODEL} />}
            onRemove={noop}
            details={{ open: noop }}
            phone={false}
            raised
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced()}
            prefill={PREFILL}
            download="#"
            plateOverlay={<ThreeDButton file={SAMPLE_MODEL} glyph />}
            details={{ open: noop }}
            phone={false}
            compact
          />
          <ModelCard name="fusilli-knob.stl" state={sliced()} prefill={PREFILL} phone />
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Label>How to slice it (live): a popover beside the card on desktop, a tall sheet on phones</Label>
          <Panel className="max-w-md">
            <SliceSettingsPanel
              file={{ id: "styleguide-model", name: "fusilli-knob.stl", url: "#" }}
              settings={settings}
              onChange={setSettings}
              spools={SPOOLS}
              plates={["Textured PEI Plate", "Smooth PEI Plate"]}
              slice={SAMPLE_SLICE}
              scalable
              sliced="#"
              result={<SliceResult state={sliced()} prefill={PREFILL} phone={false} />}
            />
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <Label>Its result: slicing again, what the change did with its undo, and a change it couldn't slice</Label>
          <Panel className="flex max-w-md flex-col gap-5">
            <SliceResult
              state={sliced({ again: { fraction: 0.42, words: "Fine" } })}
              prefill={{ estimatedMinutes: 72, weightGrams: 14 }}
              onStop={noop}
              phone={false}
            />
            <SliceResult state={sliced({ change: CHANGE })} prefill={PREFILL} onUndo={noop} phone={false} />
            <SliceResult
              state={{ kind: "failed", slice: TOO_BIG, change: { ...CHANGE, after: {}, failed: true } }}
              onSlice={noop}
              onUndo={noop}
              phone={false}
            />
          </Panel>
          <Label>More, open: how supports are built, the brim, walls and infill by number, plate, nozzle, size</Label>
          <Panel className="max-w-md">
            <SliceSettingsPanel
              file={{ id: "styleguide-model", name: "lasagne-sheet.stl", url: "#" }}
              settings={{ ...settings, layerHeight: 0.16, walls: 3, infill: 22, pattern: "gyroid" }}
              onChange={setSettings}
              spools={[]}
              plates={["Textured PEI Plate"]}
              slice={TOO_BIG}
              scalable
              moreOpen
              result={null}
            />
          </Panel>
        </div>
      </div>
    </Section>
  );
}
