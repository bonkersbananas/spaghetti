import { layMeshDown, type Mesh, restingFaces } from "@shared/mesh";
import { DEFAULT_SLICING } from "@shared/slicing/defaults.ts";
import { filamentOfSpool } from "@shared/slicing/pantry.ts";
import { renderPlate } from "@shared/slicing/render.ts";
import {
  QUALITIES,
  type QualityId,
  type SlicingDefaults,
  type SlicingSettings,
  STRENGTHS,
  SUPPORT_PLACEMENTS,
  withNozzle,
} from "@shared/slicing/settings.ts";
import type { FileSlice } from "@shared/slicing/types.ts";
import type { SpoolLike } from "@shared/spools";
import { DEFAULT_PRINTER } from "@shared/spools";
import { useEffect, useState } from "react";
import { ModelCard, type ModelState, SliceResult } from "@/components/builds/ModelFile";
import { SliceSettingsPanel, WorkspaceSlicing } from "@/components/builds/SliceSettings";
import { BeforeAfter } from "@/components/ui/BeforeAfter";
import { ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { LayersGlyph, NozzleGlyph, StrengthGlyph, SupportsGlyph } from "@/components/ui/SlicingGlyphs";
import type { AttemptFileView } from "@/lib/items";
import type { LyingState } from "@/lib/slicing/orientations";
import { Label, Panel, Section } from "./shared";

const ORANGE = "#f2754e"; // design-lint-ignore: a filament color is data
const BLACK = "#1d1d1f"; // design-lint-ignore: a filament color is data
const WHITE = "#f4f1ea"; // design-lint-ignore: a filament color is data
const TEAL = "#2c8a87"; // design-lint-ignore: a filament color is data

type Vec = [number, number, number];

/** A box's twelve triangles, corners counter-clockwise from outside. */
function box([x, y, z]: Vec, [w, d, h]: Vec): number[] {
  const c = (i: number, j: number, k: number): number[] => [x + i * w, y + j * d, z + k * h];
  const tri = (a: number[], b: number[], e: number[]) => [...a, ...b, ...e];
  return [
    ...tri(c(0, 0, 0), c(0, 1, 0), c(1, 1, 0)),
    ...tri(c(0, 0, 0), c(1, 1, 0), c(1, 0, 0)),
    ...tri(c(0, 0, 1), c(1, 0, 1), c(1, 1, 1)),
    ...tri(c(0, 0, 1), c(1, 1, 1), c(0, 1, 1)),
    ...tri(c(0, 0, 0), c(1, 0, 0), c(1, 0, 1)),
    ...tri(c(0, 0, 0), c(1, 0, 1), c(0, 0, 1)),
    ...tri(c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)),
    ...tri(c(0, 1, 0), c(1, 1, 1), c(1, 1, 0)),
    ...tri(c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)),
    ...tri(c(0, 0, 0), c(0, 1, 1), c(0, 1, 0)),
    ...tri(c(1, 0, 0), c(1, 1, 0), c(1, 1, 1)),
    ...tri(c(1, 0, 0), c(1, 1, 1), c(1, 0, 1)),
  ];
}

/** A shelf bracket (an L): the model the "Lay it down" tiles show, found and drawn by the app's own code. */
const BRACKET: Mesh = {
  positions: Float32Array.from([...box([0, 0, 0], [50, 30, 8]), ...box([0, 0, 8], [8, 30, 40])]),
};

/** The tiles' pictures for the bracket, drawn here (the app draws them in a worker, orient-worker.ts). */
function useBracketLying(colour: string): LyingState {
  const [state, setState] = useState<LyingState>({ status: "loading" });
  useEffect(() => {
    const draw = (mesh: Mesh) => {
      const size = 192;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas
        .getContext("2d")
        ?.putImageData(
          new ImageData(new Uint8ClampedArray(renderPlate([mesh.positions], { size, colour })), size, size),
          0,
          0,
        );
      return canvas.toDataURL();
    };
    const height = (mesh: Mesh) => {
      let max = 0;
      for (let i = 2; i < mesh.positions.length; i += 3) max = Math.max(max, mesh.positions[i] as number);
      return max;
    };
    const options = [
      { down: null, area: 0, mesh: layMeshDown(BRACKET, [0, 0, -1]) },
      // Two with a flat face, then the one it only stands on at its edges (the slanted face across the hollow).
      ...[
        ...restingFaces(BRACKET, 6)
          .filter((face) => face.down[2] > -0.99)
          .reduce<ReturnType<typeof restingFaces>>((kept, face) => {
            if (face.spots ? kept.some((k) => k.spots) : kept.filter((k) => !k.spots).length >= 2) return kept;
            return [...kept, face];
          }, []),
      ].map((face) => ({ down: face.down, area: face.area, spots: face.spots, mesh: layMeshDown(BRACKET, face.down) })),
    ];
    setState({
      status: "ready",
      options: options.map((option) => ({
        down: option.down,
        area: option.area,
        spots: "spots" in option ? option.spots : undefined,
        height: height(option.mesh),
        src: draw(option.mesh),
      })),
    });
  }, [colour]);
  return state;
}

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
/** Sliced by Spaghetti's own slicer (decision 0055), with how long it took. */
const OURS: FileSlice = {
  ...SAMPLE_SLICE,
  settings: { ...SAMPLE_SLICE.settings, slicer: "spaghetti", rust: "1", slicing: { ...SETTINGS, slicer: "spaghetti" } },
  ms: 2_560,
};
/** Ours was asked for, but it can't build tree supports yet: OrcaSlicer's engine sliced it. */
const STEPPED_IN: FileSlice = {
  ...SAMPLE_SLICE,
  settings: { ...SAMPLE_SLICE.settings, slicer: "orca", slicing: { ...SETTINGS, slicer: "spaghetti" } },
  fallback: { why: "unsupported", what: "tree supports" },
  ms: 8_770,
};
const TOO_BIG: FileSlice = {
  ...SAMPLE_SLICE,
  status: "failed",
  problem: "too-big",
  dimensions: [320, 100, 4],
  volume: [256, 256, 261],
  fitScale: 78,
};
/**
 * Recipes to slice with, as recipesFor offers them: two for the model's filament (one that kept a slice's settings,
 * one from a slicer's own file), then one for another (set apart on a phone).
 */
const RECIPES = [
  {
    id: "knobs",
    name: "Fine knobs",
    note: "Fine and tree supports where needed: the threads come out clean.",
    material: "PLA",
    finish: "basic",
    settings: {},
    slicing: { ...SETTINGS, filaments: [{ material: "PLA", finish: "basic" }] },
    createdAt: 2,
    fits: true,
  },
  {
    id: "bins",
    name: "PLA bins, fast and square",
    note: "",
    material: "PLA",
    finish: null,
    settings: { layerHeight: 0.24, wallLoops: 2, infillDensity: 10, brim: false },
    createdAt: 1,
    fits: true,
  },
  {
    id: "petg",
    name: "PETG, dried and 245 °C",
    note: "Dried for 6 h first, then 245 °C: no strings.",
    material: "PETG",
    finish: null,
    settings: { layerHeight: 0.2, nozzleTemperature: 245 },
    createdAt: 3,
    fits: false,
  },
];
const CHANGE = { before: { minutes: 72, grams: 14 }, after: { minutes: 48, grams: 11.2 } };
const noop = () => undefined;
const SUMMARY = ["Standard", "Everyday strength", "No supports", "PLA Basic jade white"];
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
  const [defaults, setDefaults] = useState<SlicingDefaults | undefined>(undefined);
  const lying = useBracketLying(ORANGE);
  return (
    <Section
      id="slicing"
      title="Slicing"
      note="Models Spaghetti slices in the browser, and how people set them up: a few big choices that say what they do, the rest under More (decision 0047)."
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
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
          <Label>
            Glyphs: the layers of each quality, how solid each strength is, where supports go, which nozzle prints (the
            line it lays as wide as it is)
          </Label>
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
            <span className="bg-ink/10 h-6 w-px" aria-hidden />
            <NozzleGlyph diameter={0.4} side="left" />
            <NozzleGlyph diameter={0.2} side="right" />
            <NozzleGlyph diameter={0.8} side={null} />
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
            A model Spaghetti slices: saving (a big file in parts says how far, or that it stopped, with one tap),
            waiting (a pulse), slicing, sliced (led by the print, the name quieter, and how it was sliced), a caution
            and its one tap, why it couldn't be, and not sliced yet
          </Label>
          <ModelCard name="fusilli-knob.stl" state={{ kind: "saving" }} phone={false} />
          <ModelCard name="dragon-scale-armour.stl" state={{ kind: "saving", fraction: 0.42 }} phone={false} />
          <ModelCard name="dragon-scale-armour.stl" state={{ kind: "notSaved", retry: noop }} phone={false} />
          <ModelCard name="fusilli-knob.stl" state={{ kind: "waiting" }} phone={false} />
          <ModelCard name="fusilli-knob.stl" state={{ kind: "slicing", fraction: 0.05 }} phone={false} />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced()}
            prefill={PREFILL}
            download="#"
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="steampunk-glasses.stl"
            state={sliced({ slice: FLOATING })}
            prefill={{ estimatedMinutes: 76, weightGrams: 7.7 }}
            download="#"
            onSlice={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="lasagne-sheet.stl"
            state={{ kind: "failed", slice: TOO_BIG }}
            onSlice={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={{ kind: "unsliced" }}
            onSlice={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
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
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ change: CHANGE })}
            prefill={PREFILL}
            download="#"
            onUndo={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ ahead: true })}
            prefill={PREFILL}
            download="#"
            onSlice={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="lasagne-sheet.stl"
            state={{ kind: "failed", slice: TOO_BIG, change: { ...CHANGE, after: {}, failed: true } }}
            onSlice={noop}
            onUndo={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <Label>
            Which slicer made it (decision 0055): Spaghetti's own, named while OrcaSlicer is the usual one; OrcaSlicer
            stepping in for what ours can't do yet, and why, in one line
          </Label>
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ slice: OURS })}
            prefill={PREFILL}
            download="#"
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced({ slice: STEPPED_IN })}
            prefill={PREFILL}
            download="#"
            details={{ open: noop, summary: SUMMARY }}
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
            view3d={{ file: SAMPLE_MODEL }}
            onRemove={noop}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
            raised
          />
          <ModelCard
            name="fusilli-knob.stl"
            state={sliced()}
            prefill={PREFILL}
            download="#"
            view3d={{ file: SAMPLE_MODEL }}
            details={{ open: noop, summary: SUMMARY }}
            phone={false}
            compact
          />
          <ModelCard name="fusilli-knob.stl" state={sliced()} prefill={PREFILL} phone />
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-10">
        <div className="flex min-w-0 flex-col gap-4">
          <Label>
            How to slice it (live): a panel beside the page on desktop, two columns that need no scrolling at 1440×900;
            a tall sheet on phones, one column in the same order. A 0.2 mm nozzle is fitted as the other nozzle: the
            model slices for the main one, and tries another size under More
          </Label>
          {/* As the panel draws it: lifted, floating. */}
          <div className="sg-lifted-surface bg-lifted shadow-float w-full max-w-[44rem] rounded-xl p-6">
            <SliceSettingsPanel
              file={{ id: "styleguide-model", name: "fusilli-knob.stl", url: "#", size: 1 }}
              lying={lying}
              settings={settings}
              onChange={setSettings}
              spools={SPOOLS}
              plates={["Textured PEI Plate", "Smooth PEI Plate"]}
              nozzles={{
                main: { diameter: 0.4, hardened: true },
                auxiliary: { diameter: 0.2, hardened: false },
              }}
              slice={SAMPLE_SLICE}
              scalable
              recipes={RECIPES}
              sliced="#"
            />
          </div>

          <Label>
            More, open: the nozzle size first (the sizes fitted marked; here a 0.6 mm the model tried, which the main
            nozzle doesn't have, said under the filament and on its Print it), then how supports are built, the brim,
            walls and infill by number, plate, size, and which slicer; under it, which slicer slices it and its source
          </Label>
          <div className="sg-lifted-surface bg-lifted shadow-float w-full max-w-[44rem] rounded-xl p-6">
            <SliceSettingsPanel
              file={{ id: "styleguide-model", name: "lasagne-sheet.stl", url: "#", size: 1 }}
              lying={{ status: "none" }}
              settings={{
                ...withNozzle({ ...settings, layerHeight: 0.16, walls: 3, infill: 22, pattern: "gyroid" }, 0.6),
                nozzlePicked: true,
              }}
              onChange={setSettings}
              spools={[]}
              plates={["Textured PEI Plate"]}
              nozzles={{
                main: { diameter: 0.4, hardened: true },
                auxiliary: { diameter: 0.2, hardened: false },
              }}
              onReset={noop}
              slice={TOO_BIG}
              scalable
              moreOpen
            />
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Label>
            Its result at a phone's sheet's foot: slicing again, what the change did with its undo, and a change it
            couldn't slice
          </Label>
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
          <Label>
            The workspace's defaults, on the Printer page (live): how a model nobody set up prints, without what is each
            model's
          </Label>
          <Panel className="max-w-md">
            <WorkspaceSlicing
              value={defaults}
              onChange={(next) => setDefaults(next ?? undefined)}
              nozzles={DEFAULT_PRINTER.nozzles}
            />
          </Panel>
        </div>
      </div>
    </Section>
  );
}
