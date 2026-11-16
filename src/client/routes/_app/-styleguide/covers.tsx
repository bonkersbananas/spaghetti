import type { AttemptFile } from "@shared/api";
import { useEffect, useState } from "react";
import renderHook from "@/assets/samples/render-hook.svg";
import { Card } from "@/components/ui/Card";
import { CoverPicture, coverPhoto } from "@/components/ui/CoverPicture";
import { BuildsIcon } from "@/components/ui/icons";
import { type Cover, setPreview } from "@/lib/previews";
import { Label, Section } from "./shared";

const plate: Cover = {
  kind: "plate",
  file: { id: "sample-render-hook", hasThumb: true, createdAt: 0 } as AttemptFile,
};
const note: Cover = { kind: "note", text: "For the bathroom door.", fromTitle: false };
const named: Cover = { kind: "note", text: "Drawer bins, 42 mm grid", fromTitle: true };

/** The sample render, a white hook on a clear ground as a slicer draws it, through the device's preview cache. */
function useRender() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const blob = await (await fetch(renderHook)).blob();
      setPreview("sample-render-hook", blob, blob);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

/** One rule for what a thing shows where its picture goes (coverOf), and CoverPicture, which draws it at any size. */
export function CoversSection() {
  const ready = useRender();
  return (
    <Section
      id="covers"
      title="Covers"
      note="Every idea and build shows its picture by one rule (coverOf, lib/previews.ts): the best photo; else its newest plate render, whole, on the render ground, where the model casts a faint shadow so white plastic keeps its edge, labeled From the model where there is room; else its note on an index card (the title stands in for a missing note, said once). A tile too small for words shows the build glyph. Never an empty image icon. The idea page, the build page, cards, Today, the Journal's Now, the sidebar and the Since group all follow it, and a shared link unfurls with the same photo."
    >
      {ready && (
        <div className="flex flex-col gap-10">
          <div>
            <Label>On a card: a white model's render, a note, a build with only a name</Label>
            <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4 md:gap-5">
              <Card
                photo={coverPhoto(plate, "Slicer preview: Towel hook")}
                title="Towel hook"
                meta="Printing"
                aspect="portrait"
              />
              <Card
                note={note.kind === "note" ? note.text : undefined}
                title="Towel hook"
                meta="Attempt 2"
                aspect="portrait"
              />
              <Card
                note={named.kind === "note" ? named.text : undefined}
                meta="Attempt 1 · Just now"
                aspect="portrait"
              />
            </div>
          </div>
          <div>
            <Label>Where the photos go (CoverPicture with label), and small tiles</Label>
            <div className="flex flex-wrap items-end gap-5">
              <CoverPicture cover={plate} label className="aspect-4/3 w-72 rounded-lg" />
              <CoverPicture cover={note} className="aspect-4/3 w-48 rounded-lg" />
              <CoverPicture cover={plate} inset="p-1" glyph={<BuildsIcon size={22} />} className="size-12 rounded-md" />
              <CoverPicture cover={note} glyph={<BuildsIcon size={22} />} className="size-12 rounded-md" />
              <CoverPicture
                cover={plate}
                inset="p-0.5"
                glyph={<BuildsIcon size={18} />}
                className="size-9 rounded-sm"
              />
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
