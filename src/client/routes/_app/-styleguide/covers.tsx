import type { AttemptFile } from "@shared/api";
import { useEffect, useState } from "react";
import renderHook from "@/assets/samples/render-hook.svg";
import renderHookBlack from "@/assets/samples/render-hook-black.svg";
import { Card, CoverPicture, coverPhoto } from "@/components/ui/Card";
import { BuildsIcon } from "@/components/ui/icons";
import { type Cover, setPreview } from "@/lib/previews";
import { Label, Section } from "./shared";

const sample = (id: string): Cover => ({ kind: "plate", file: { id, hasThumb: true, createdAt: 0 } as AttemptFile });
const plate = sample("sample-render-hook");
const black = sample("sample-render-hook-black");
const note: Cover = { kind: "note", text: "For the bathroom door.", fromTitle: false };
const named: Cover = { kind: "note", text: "Drawer bins, 42 mm grid", fromTitle: true };

/** The sample renders, a white and a black hook on a clear ground as a slicer draws them, through the preview cache. */
function useRenders() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const [id, source] of [
        ["sample-render-hook", renderHook],
        ["sample-render-hook-black", renderHookBlack],
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

/** One rule for what a thing shows where its picture goes (coverOf), and CoverPicture, which draws it at any size. */
export function CoversSection() {
  const ready = useRenders();
  return (
    <Section
      id="covers"
      title="Covers"
      note="Every idea and build shows its picture by one rule (coverOf, lib/previews.ts): the best photo; else its newest plate render (or its twist's), whole, on the render ground, with a hairline edge and a faint shadow so white and black plastic both keep their outline, labeled From the model where there is room; else its note on an index card (the title stands in for a missing note, said once), a size or two down in a wider frame. Tiles of 48 px and less use a deeper ground and a firmer edge, and show the build glyph where only words would be. Never an empty image icon."
    >
      {ready && (
        <div className="flex flex-col gap-10">
          <div>
            <Label>On a card: a white model, a black one, a note, a build with only a name</Label>
            <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4 md:gap-5">
              <Card
                photo={coverPhoto(plate, "Slicer preview: Towel hook")}
                title="Towel hook"
                meta="Printing"
                aspect="portrait"
              />
              <Card
                photo={coverPhoto(black, "Slicer preview: Coat hook")}
                title="Coat hook"
                meta="Black PLA"
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
            <Label>Where the photos go, labeled; a note in a wide frame, set a size down</Label>
            <div className="flex flex-wrap items-end gap-5">
              <CoverPicture cover={plate} label className="aspect-4/3 w-72 rounded-lg" />
              <CoverPicture cover={black} label className="aspect-4/3 w-72 rounded-lg" />
              <CoverPicture cover={note} shape="wide" className="shadow-soft aspect-4/3 w-72 rounded-lg" />
              <CoverPicture cover={note} shape="strip" className="shadow-soft aspect-5/2 w-80 rounded-lg" />
            </div>
          </div>
          <div>
            <Label>Small tiles (a row's 48 px, the sidebar's 36 px)</Label>
            <div className="flex flex-wrap items-end gap-5">
              <CoverPicture
                cover={plate}
                small
                inset="p-0.5"
                glyph={<BuildsIcon size={22} />}
                className="size-12 rounded-md"
              />
              <CoverPicture
                cover={black}
                small
                inset="p-0.5"
                glyph={<BuildsIcon size={22} />}
                className="size-12 rounded-md"
              />
              <CoverPicture cover={note} glyph={<BuildsIcon size={22} />} className="size-12 rounded-md" />
              <CoverPicture
                cover={plate}
                small
                inset="p-0"
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
