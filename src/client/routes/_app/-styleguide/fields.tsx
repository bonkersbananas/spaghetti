import { useState } from "react";
import { TextArea, TextField } from "@/components/ui/Field";
import { ForField, ForLine } from "@/components/ui/ForField";
import { ForOffer, OfferChip } from "@/components/ui/ForOffer";
import * as Icons from "@/components/ui/icons";
import { NoteField } from "@/components/ui/NoteField";
import { type SaveState, SaveStatus } from "@/components/ui/SaveStatus";
import { Label, Panel, Section } from "./shared";

export function FieldSection() {
  const [title, setTitle] = useState("Cable clip for the desk");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [note, setNote] = useState("Needs to fit a 6 mm cable. Try PETG so it flexes without snapping.");
  const [query, setQuery] = useState("PETG warping");
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
          <Label>
            A search field with text: the × empties it, its target the field's full height to its right edge (outlined
            here), so a thumb near the × can't land in the text
          </Label>
          <TextField
            type="search"
            icon={Icons.SearchIcon}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search, with text"
            className="[&_[data-clear]]:outline-tomato [&_[data-clear]]:outline-2 [&_[data-clear]]:-outline-offset-2 [&_[data-clear]]:outline-dashed"
          />
        </Panel>
        <Panel className="flex flex-col gap-3">
          <Label>Plain, for writing surfaces</Label>
          <TextArea appearance="title" defaultValue="Articulated dragon" aria-label="Title" minRows={1} />
          <TextArea appearance="plain" aria-label="Note" placeholder="Jot it down…" minRows={3} />
          <Label>
            For field: who it is for, quiet under a title; it reads "for you" when it names the reader, the name as
            typed while edited
          </Label>
          <ForField defaultValue="Mila" aria-label="For" />
          <ForField defaultValue="Sam" aria-label="For, naming the reader" you />
          <Label>
            Nobody named: one offer among the title's chips (an OfferChip: a plus and a dashed ring, never a fact or a
            toggle), "For Sam" in one tap and a pencil to write someone else; "For someone" until the other person is
            known
          </Label>
          <div className="flex flex-wrap gap-2">
            <ForOffer name="Sam" onName={() => undefined} onAsk={() => undefined} />
            <OfferChip onClick={() => undefined}>For someone…</OfferChip>
          </div>
          <Label>For line on a card: a name stays quiet, "for you" stands out</Label>
          <p className="text-small text-ink-soft flex gap-4">
            <ForLine text="for Mila" />
            <ForLine text="for you" />
          </p>
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
