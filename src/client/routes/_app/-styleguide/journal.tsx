import type { Attempt, JournalEntry as Entry, Item, Photo } from "@shared/api";
import { useEffect, useState } from "react";
import dragonPhoto from "@/assets/samples/dragon.svg";
import tugboatPhoto from "@/assets/samples/planter.svg";
import platePicture from "@/assets/samples/plate.svg";
import { JournalEntry } from "@/components/journal/JournalEntry";
import { setPreview } from "@/lib/previews";
import { Label, people, Section } from "./shared";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const now = Date.now();

const photo = (id: string, attemptId: string | null): Photo => ({
  id,
  itemId: "sample",
  position: 0,
  width: 400,
  height: 300,
  color: "#8d7a66",
  takenAt: null,
  attemptId,
  createdBy: "a",
  createdAt: now,
});

const attempt = (id: string, itemId: string, fields: Partial<Attempt>): Attempt => ({
  id,
  itemId,
  outcome: "success",
  printedAt: now - 3 * HOUR,
  finishedAt: now - 2 * HOUR,
  note: "",
  failureTags: [],
  successNotes: [],
  settings: {
    filaments: [{ type: "PLA", brand: "Bambu", colorHex: "#00ae42", colorName: "Bambu green" }], // design-lint-ignore: a filament color is data
    layerHeight: 0.2,
    infillDensity: 15,
    bedType: "Textured PEI Plate",
  },
  changes: [],
  file: null,
  createdBy: "a",
  finishedBy: "a",
  createdAt: now,
  updatedAt: now,
  ...fields,
});

const item = (id: string, fields: Partial<Item>): Item => ({
  id,
  stage: "building",
  title: null,
  note: "",
  createdBy: "a",
  createdAt: now - 10 * HOUR,
  updatedAt: now,
  startedAt: now - 9 * HOUR,
  finishedAt: null,
  coverPhotoId: null,
  photos: [],
  attempts: [],
  ...fields,
});

const planFile = {
  id: "sample-plate",
  name: "desk-clips.gcode.3mf",
  size: 14_000,
  stored: true,
  hasThumb: true,
  plate: 1,
  plateCount: 2,
  slicer: "BambuStudio 02.01.00.00",
  prefill: {},
  createdAt: now,
};

// A print on the bed from a slicer file, with no photo yet.
const clips = item("sample-clips", { title: "Desk cable clips" });
clips.attempts = [
  attempt("sample-clips-1", clips.id, {
    outcome: null,
    finishedAt: null,
    finishedBy: null,
    printedAt: now - 25 * MINUTE,
    file: planFile,
    settings: { ...attempt("x", "y", {}).settings, estimatedMinutes: 72 },
  }),
];
// A finished attempt with a photo, and a text-only failure with neither photo nor file.
const dragon = item("sample-dragon", {
  title: "Articulated dragon",
  photos: [photo("sample-dragon-photo", "sample-dragon-3")],
});
dragon.attempts = [
  attempt("sample-dragon-3", dragon.id, {
    note: "The wings fold flat now. Slower first layer did it.",
    successNotes: ["great-first-layer"],
  }),
];
const bare = item("sample-bare", { title: "Hook for the helmet" });
bare.attempts = [
  attempt("sample-bare-1", bare.id, {
    outcome: "failed",
    note: "Corner lifted at layer 30, then it was all noodles.",
    failureTags: ["warping"],
  }),
];
// The four kinds of event: with and without a photo.
const tugboat = item("sample-tugboat", { title: "Bath tugboat", photos: [photo("sample-tugboat-photo", null)] });
const finished = item("sample-finished", { title: "Headphone stand", stage: "done", finishedAt: now - HOUR });
finished.attempts = [attempt("sample-finished-1", finished.id, {})];

const entry = (kind: Entry["kind"], target: Item, attemptId: string | null = null): Entry => ({
  key: `${kind}:${target.id}`,
  kind,
  itemId: target.id,
  attemptId,
  at: now - 40 * MINUTE,
  by: "a",
});

/** Samples draw their pictures from the sample SVGs, through the same preview cache that photos made on this device use. */
function useSamplePictures() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const [id, source] of [
        ["sample-dragon-photo", dragonPhoto],
        ["sample-tugboat-photo", tugboatPhoto],
        ["sample-plate", platePicture],
      ] as const) {
        const blob = await (await fetch(source)).blob();
        setPreview(id, blob, blob);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

export function JournalSection() {
  const ready = useSamplePictures();
  const [first, second] = people;
  const rows = (compact: boolean) => (
    <div className="flex flex-col gap-3">
      <JournalEntry
        entry={entry("attempt", clips, "sample-clips-1")}
        item={clips}
        person={first}
        when="time"
        compact={compact}
      />
      <JournalEntry
        entry={entry("attempt", dragon, "sample-dragon-3")}
        item={dragon}
        person={second}
        when="time"
        compact={compact}
      />
      <JournalEntry
        entry={entry("attempt", bare, "sample-bare-1")}
        item={bare}
        person={first}
        when="time"
        compact={compact}
      />
    </div>
  );
  return (
    <Section
      id="journal"
      title="Journal entries"
      note="An attempt is a card that leads with its photo, or with the slicer's picture of the plate (labeled as a preview) while there is no photo yet. A print in progress shows how far along it is. Events are quiet rows with one icon: in the tile, or beside the label when a photo fills the tile. The compact variant makes every entry a row, for Today's “Lately”."
    >
      {ready && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <Label>Attempt cards: plate preview and progress, photo, neither</Label>
            {rows(false)}
          </div>
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-col gap-3">
              <Label>Event rows: idea and finished without a photo, started with one</Label>
              <JournalEntry entry={entry("idea", bare)} item={bare} person={first} when="time" />
              <JournalEntry entry={entry("started", tugboat)} item={tugboat} person={second} when="time" />
              <JournalEntry entry={entry("finished", finished)} item={finished} person={first} when="time" />
              <JournalEntry entry={entry("shelved", bare)} item={bare} person={second} when="time" />
            </div>
            <div className="flex flex-col gap-3">
              <Label>Compact: the same attempts as rows</Label>
              {rows(true)}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
