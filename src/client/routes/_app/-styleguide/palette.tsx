import { searchTerms } from "@shared/search";
import { useState } from "react";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { OutcomeChip } from "@/components/builds/Outcome";
import { Highlight } from "@/components/ui/Highlight";
import * as Icons from "@/components/ui/icons";
import { type PaletteGroup, PaletteSurface } from "@/components/ui/Palette";
import { ShortcutList } from "@/components/ui/ShortcutList";
import { Label, Panel, Section } from "./shared";

const paletteHints = [
  { keys: ["↑", "↓"], label: "Move" },
  { keys: ["↵"], label: "Open" },
  { keys: ["Esc"], label: "Close" },
];

const paletteEmpty = {
  title: "Nothing in the pot",
  text: "No idea, build, attempt or action goes by that name. Try fewer words.",
};

export function PaletteSection() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | undefined>("a");
  const terms = searchTerms("tug");
  const groups: PaletteGroup[] = [
    {
      id: "this",
      label: "This build",
      rows: [
        { id: "a", label: "Log attempt", title: "Log attempt", icon: Icons.PlusIcon, keys: ["A"] },
        { id: "b", label: "Finish build", title: "Finish build", icon: Icons.FinishIcon },
      ],
    },
    {
      id: "builds",
      label: "Builds",
      rows: [
        {
          id: "c",
          label: "Tugboat",
          title: <Highlight text="Tugboat, take two" terms={terms} />,
          subtitle: "On the bed · 3 attempts",
          photo: { src: vasePhoto, color: "#c9b8a4" }, // design-lint-ignore
          trailing: <OutcomeChip outcome="partial" />,
        },
        {
          id: "d",
          label: "Vase",
          title: "Spiral vase",
          subtitle: "Done · 2 attempts",
          photo: { src: planterPhoto, color: "#b9c4a8" }, // design-lint-ignore
          trailing: <OutcomeChip outcome="success" />,
        },
      ],
    },
  ];
  return (
    <Section
      id="palette"
      title="Palette & shortcuts"
      note="Command palette (⌘K, desktop only): jump to anything or run an action; what fits the screen comes first. The shortcut list (?) reads the same registry the keys use, so the two can't drift."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Label>PaletteSurface, with results</Label>
          <div className="bg-lifted shadow-float overflow-hidden rounded-xl">
            <PaletteSurface
              query={query}
              onQueryChange={setQuery}
              groups={groups}
              activeId={active}
              onActiveChange={setActive}
              onRun={setActive}
              empty={paletteEmpty}
              hints={paletteHints}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Label>While results are on their way (the old ones dim)</Label>
          <div className="bg-lifted shadow-float overflow-hidden rounded-xl">
            <PaletteSurface
              query="tugb"
              onQueryChange={() => undefined}
              groups={groups.slice(0, 1)}
              activeId="a"
              onActiveChange={() => undefined}
              onRun={() => undefined}
              pending
              stale
              empty={paletteEmpty}
            />
          </div>
          <Label>Nothing matches</Label>
          <div className="bg-lifted shadow-float overflow-hidden rounded-xl">
            <PaletteSurface
              query="zzz"
              onQueryChange={() => undefined}
              groups={[]}
              activeId={undefined}
              onActiveChange={() => undefined}
              onRun={() => undefined}
              empty={paletteEmpty}
            />
          </div>
        </div>
      </div>
      <Panel className="mt-6">
        <Label>ShortcutList: everything the keyboard does, by screen</Label>
        <ShortcutList />
      </Panel>
    </Section>
  );
}
