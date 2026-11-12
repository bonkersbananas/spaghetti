import type { Twist } from "@shared/api";
import type { TwistChange } from "@shared/twists";
import { useState } from "react";
import { Fusilli } from "@/components/illustrations/Fusilli";
import { TwistCard } from "@/components/twists/TwistCard";
import { TwistChanges } from "@/components/twists/TwistChanges";
import { EmptyState } from "@/components/ui/EmptyState";
import { Label, Panel, Section } from "./shared";

const now = Date.now();
const bins: Twist = {
  id: "sample-twist",
  name: "Drawer bins, 42 mm grid",
  note: "",
  source: {
    url: "https://makerworld.com/en/models/1-bins",
    title: null,
    designer: "Brightside Studio",
    license: null,
    place: "MakerWorld",
    photo: null,
  },
  changes: [
    { id: "1", kind: "scale", label: "", value: "84 %", note: "fits the 42 mm grid" },
    { id: "2", kind: "tolerance", label: "", value: "+0.2 mm", note: "" },
    { id: "3", kind: "text", label: "", value: "“Screws”", note: "" },
  ],
  fromItemId: null,
  recipeId: null,
  createdBy: "a",
  createdAt: now,
  updatedAt: now,
};

export function TwistsSection() {
  const [changes, setChanges] = useState<TwistChange[]>(bins.changes);
  return (
    <Section
      id="twists"
      title="Twists"
      note="A twist is someone else's model, changed our way: the card leads with the picture, names where it came from and says what we changed in one quiet line. The changes are rows of a kind, a value and a few words; adding one is a tap on its kind, and the new row's value is focused."
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Twist card</Label>
          <TwistCard twist={bins} />
          <Label>Before anything is written down</Label>
          <TwistCard
            twist={{
              ...bins,
              name: "Spool holder, a looser fit",
              changes: [],
              source: { ...bins.source, designer: null, place: "Printables" },
            }}
          />
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>What we changed (editable)</Label>
          <TwistChanges changes={changes} readOnly={false} onChange={setChanges} />
          <Label>Empty state</Label>
          <EmptyState illustration={<Fusilli />} title="Nothing twisted yet">
            When you print someone else's model with changes, keep it here.
          </EmptyState>
        </Panel>
      </div>
    </Section>
  );
}
