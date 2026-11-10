import type { Outcome } from "@shared/attempts";
import { useState } from "react";
import { AttemptEntry } from "@/components/builds/AttemptEntry";
import { OutcomeChip, OutcomePicker } from "@/components/builds/Outcome";
import { TagPicker } from "@/components/builds/TagPicker";
import * as Icons from "@/components/ui/icons";
import { AddPhotoTile } from "@/components/ui/PhotoTiles";
import { toast } from "@/components/ui/Toast";
import type { AttemptView } from "@/lib/items";
import { Label, Panel, people, SAMPLE_COLOR, Section } from "./shared";

const sampleAttempt: AttemptView = {
  id: "sample-attempt",
  itemId: "sample-build",
  number: 2,
  pending: false,
  outcome: "partial",
  printedAt: Date.now() - 26 * 60 * 60 * 1000,
  finishedAt: Date.now() - 23 * 60 * 60 * 1000,
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
  finishedBy: "a",
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
