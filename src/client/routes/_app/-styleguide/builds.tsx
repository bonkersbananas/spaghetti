import type { Outcome } from "@shared/attempts";
import { useState } from "react";
import { AttemptEntry } from "@/components/builds/AttemptEntry";
import { OutcomeChip, OutcomePicker } from "@/components/builds/Outcome";
import { OutcomeStrip } from "@/components/builds/OutcomeStrip";
import { TagPicker } from "@/components/builds/TagPicker";
import * as Icons from "@/components/ui/icons";
import { AddPhotoTile } from "@/components/ui/PhotoTiles";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { toast } from "@/components/ui/Toast";
import type { AttemptView } from "@/lib/items";
import { Label, Panel, people, SAMPLE_COLOR, Section } from "./shared";

const MINUTE = 60 * 1000;

/** A print mid-way, one past its estimate, and one with no estimate to go by. */
const progressSamples = [
  { name: "Running", startedAt: Date.now() - 30 * MINUTE, estimatedMinutes: 75 },
  { name: "Due", startedAt: Date.now() - 95 * MINUTE, estimatedMinutes: 90 },
  { name: "Unknown", startedAt: Date.now() - 10 * MINUTE, estimatedMinutes: undefined },
] as const;

const sampleStrip = [
  { id: "1", number: 1, outcome: "failed" },
  { id: "2", number: 2, outcome: "partial" },
  { id: "3", number: 3, outcome: "success" },
  { id: "4", number: 4, outcome: null },
] as const;

const longStrip = Array.from({ length: 17 }, (_, index) => ({
  id: String(index + 1),
  number: index + 1,
  outcome: index % 3 === 0 ? ("failed" as const) : index % 3 === 1 ? ("partial" as const) : ("success" as const),
}));

const sampleAttempt: AttemptView = {
  id: "sample-attempt",
  itemId: "sample-build",
  number: 2,
  pending: false,
  outcome: "partial",
  printedAt: Date.now() - 26 * 60 * 60 * 1000,
  finishedAt: Date.now() - 23 * 60 * 60 * 1000,
  endedAt: null,
  suggestedFailureTag: null,
  note: "Stayed down this time, but the stern corners curled up a little.",
  failureTags: ["warping"],
  successNotes: ["great-first-layer"],
  file: null,
  settings: {
    filaments: [{ type: "PLA", brand: "Bambu", colorHex: SAMPLE_COLOR, colorName: "Sunflower yellow", amsSlot: "A2" }],
    bedType: "Textured PEI Plate",
    layerHeight: 0.2,
    infillDensity: 15,
    brim: true,
    nozzleTemperature: 220,
    bedTemperature: 60,
    estimatedMinutes: 190,
    actualMinutes: 197,
  },
  changes: [
    { key: "bedType", text: "Smooth PEI → Textured PEI plate" },
    { key: "brim", text: "added a brim" },
    { key: "bedTemperature", text: "bed 55 → 60 °C" },
  ],
  createdBy: "a",
  createdVia: null,
  finishedBy: "a",
  finishedVia: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export function BuildsSection() {
  const [outcome, setOutcome] = useState<Outcome | null>("failed");
  const [failureTags, setFailureTags] = useState(["spaghetti"]);
  return (
    <Section
      id="builds"
      title="Builds & attempts"
      note="Logging an attempt next to the printer: the outcome is one big tap, tags and settings one more. A failed print is spaghetti, recorded with the same care as a success: soft tomato, never an error."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <Label>Outcome picker</Label>
          <OutcomePicker value={outcome} onChange={setOutcome} />
          <Label>Outcome chips</Label>
          <div className="flex flex-wrap gap-2">
            <OutcomeChip outcome={null} />
            <OutcomeChip outcome="success" />
            <OutcomeChip outcome="partial" />
            <OutcomeChip outcome="failed" />
          </div>
          <Label>Print progress: bar and ring, in three states</Label>
          <div className="flex flex-col gap-4">
            {progressSamples.map((sample) => (
              <div key={sample.name} className="flex items-center gap-4">
                <span className="text-small text-ink-faint w-20 shrink-0 font-medium">{sample.name}</span>
                <PrintProgress
                  startedAt={sample.startedAt}
                  estimatedMinutes={sample.estimatedMinutes}
                  className="flex-1"
                />
                <PrintProgress variant="ring" startedAt={sample.startedAt} estimatedMinutes={sample.estimatedMinutes} />
              </div>
            ))}
          </div>
          <p className="text-small text-ink-faint">
            Without an estimate there is no bar and no ring: the app never draws progress it can't know.
          </p>
          <Label>Outcome strip: dots, oldest first</Label>
          <div className="flex flex-col items-start gap-3">
            <OutcomeStrip attempts={[...sampleStrip]} />
            <OutcomeStrip attempts={[...sampleStrip]} onPick={(id) => toast.message(`Attempt ${id}`)} />
            <OutcomeStrip attempts={longStrip} />
          </div>
          <TagPicker
            kind="failure"
            label="Tag picker: what went wrong?"
            value={failureTags}
            onChange={setFailureTags}
            visible={6}
          />
        </Panel>
        <div className="flex flex-col gap-4">
          <Label>Attempt in a build's timeline</Label>
          <ol className="flex flex-col">
            <AttemptEntry
              attempt={sampleAttempt}
              photos={[]}
              person={people[1]}
              first
              last
              onOpen={() => toast.message("Opens the attempt")}
            />
          </ol>
          <Label>New build tiles</Label>
          <div className="grid grid-cols-2 gap-3">
            <AddPhotoTile size="card" icon={Icons.PlusIcon} label="New build" />
            <div className="flex flex-col justify-end">
              <AddPhotoTile size="row" icon={Icons.PlusIcon} label="New build" />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
