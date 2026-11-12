import { useState } from "react";
import { TextArea, TextField } from "@/components/ui/Field";
import { ForChip, ForField } from "@/components/ui/ForField";
import * as Icons from "@/components/ui/icons";
import { NoteField } from "@/components/ui/NoteField";
import { type SaveState, SaveStatus } from "@/components/ui/SaveStatus";
import { Label, Panel, Section } from "./shared";

export function FieldSection() {
  const [title, setTitle] = useState("Cable clip for the desk");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [note, setNote] = useState("Needs to fit a 6 mm cable. Try PETG so it flexes without snapping.");
  const [linkedNote, setLinkedNote] = useState(
    "Remix of https://www.printables.com/model/123-cable-clip with a wider mouth.",
  );

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 700);
  }

  return (
    <Section
      id="fields"
      title="Fields"
      note="Everything autosaves: no save buttons, just a quiet status beside the label. Plain fields read as text until you edit them."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <TextField
            label="Title"
            saveState={saveState}
            value={title}
            onChange={(e) => edit(setTitle, e.target.value)}
          />
          <TextArea
            label="Notes"
            value={note}
            onChange={(e) => edit(setNote, e.target.value)}
            hint="Grows as you type."
          />
          <TextField label="Nozzle temperature" defaultValue="320" error="The X2D tops out at 300 °C." />
          <TextField icon={Icons.SearchIcon} placeholder="Search…" aria-label="Search" />
        </Panel>
        <Panel className="flex flex-col gap-3">
          <Label>Plain, for writing surfaces</Label>
          <TextArea appearance="title" defaultValue="Articulated dragon" aria-label="Title" minRows={1} />
          <TextArea appearance="plain" aria-label="Note" placeholder="Jot it down…" minRows={3} />
          <Label>
            For field: who it is for, quiet under a title; nobody named, the page offers a quiet chip instead
          </Label>
          <ForField defaultValue="Mila" aria-label="For" />
          <ForChip onClick={() => undefined} />
          <Label>Note field: links stay clickable, tap the text to edit</Label>
          <NoteField value={linkedNote} onChange={setLinkedNote} />
          <Label>Save states</Label>
          <div className="flex flex-wrap gap-5">
            <SaveStatus state="saving" />
            <SaveStatus state="saved" />
            <SaveStatus state="error" />
          </div>
        </Panel>
      </div>
    </Section>
  );
}
