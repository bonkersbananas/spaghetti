import { useEffect, useRef, useState } from "react";
import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { OutcomeChip } from "@/components/builds/Outcome";
import { ActionMenu, ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import * as Icons from "@/components/ui/icons";
import { OpenLarge, openLarge } from "@/components/ui/OpenLarge";
import { Photo } from "@/components/ui/Photo";
import { PhotoMenuDot } from "@/components/ui/PhotoMenuDot";
import { AddPhotoTile, PhotoThumb } from "@/components/ui/PhotoTiles";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { toast } from "@/components/ui/Toast";
import { UploadBadge } from "@/components/ui/UploadBadge";
import type { PhotoView } from "@/lib/items";
import { photoSrc, setPreview } from "@/lib/previews";
import { Label, Panel, Section } from "./shared";

/** A photo's average color is data, measured from its pixels, not a design token. */
const SAMPLE_PHOTO_COLOR = "#867362"; // design-lint-ignore

export function PhotoSection() {
  return (
    <Section
      id="photos"
      title="Photos"
      note="A photo shows its own average color while it loads, then fades in. Captures upload in the background: the badge says how far along they are, and “Not saved yet” while a retry waits."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Photo: loading, then loaded</Label>
          <div className="grid grid-cols-2 gap-3">
            {/* What a loading photo shows: its own average color. */}
            <div
              role="img"
              aria-label="A photo still loading"
              className="aspect-4/3 rounded-md"
              style={{ backgroundColor: SAMPLE_PHOTO_COLOR }} // design-lint-ignore
            />
            <Photo src={dragonPhoto} alt="A red dragon" className="aspect-4/3 rounded-md" />
          </div>
          <Label>Upload badges</Label>
          <div className="bg-paper-deep flex flex-wrap gap-2 rounded-md p-3">
            <UploadBadge state="processing" />
            <UploadBadge state="uploading" progress={0.42} />
            <UploadBadge state="waiting" />
            <span className="text-ink-soft inline-flex items-center gap-2">
              <ProgressRing value={0.7} /> <ProgressRing value={null} />
            </span>
          </div>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Thumbnails and add tiles</Label>
          <div className="flex flex-wrap items-center gap-2.5">
            <PhotoThumb src={planterPhoto} alt="Planter" onRemove={() => toast.message("Removed")} />
            <PhotoThumb src={dragonPhoto} alt="Dragon" confirmRemove onRemove={() => toast.message("Removed")} />
            <PhotoThumb src={vasePhoto} alt="Vase" busy />
            <AddPhotoTile size="md" icon={Icons.CameraIcon} label="Camera" />
            <PhotoThumb size="sm" src={dragonPhoto} alt="Dragon" />
            <AddPhotoTile size="sm" icon={Icons.PlusIcon} label="Add photos" />
          </div>
          <Label>A saved photo's menu: tap the one showing again, hold one, or right-click (decision 0054)</Label>
          <StripMenuDemo />
          <div className="grid grid-cols-2 gap-3">
            <AddPhotoTile icon={Icons.CameraIcon} label="Take photo" />
            <AddPhotoTile icon={Icons.ImageIcon} label="From library" />
          </div>
          <Label>No photos yet, on a phone, under the title: two secondary buttons, not wells</Label>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <Button icon={Icons.CameraIcon}>Take photo</Button>
            <Button icon={Icons.ImageIcon}>From library</Button>
          </div>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4 md:col-span-2">
          <Label>
            Photos opened large: a tap or click on an attempt's photo opens it over the whole screen, on the deep paper.
            Swipe, ← → or the thumbnails for the others; ×, Esc or a swipe down closes it
          </Label>
          <LargePhotosDemo />
        </Panel>
      </div>
    </Section>
  );
}

const LARGE_SAMPLES = [
  { id: "sample-large-dragon", src: dragonPhoto, alt: "Dragon" },
  { id: "sample-large-planter", src: planterPhoto, alt: "Planter" },
  { id: "sample-large-vase", src: vasePhoto, alt: "Vase" },
];

/** Three sample photos (through the preview cache photos made on this device use) that open large. */
function LargePhotosDemo() {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const sample of LARGE_SAMPLES) {
        const blob = await (await fetch(sample.src)).blob();
        setPreview(sample.id, blob, blob);
      }
      if (cancelled) return;
      setPhotos(
        LARGE_SAMPLES.map((sample, position) => ({
          id: sample.id,
          itemId: "sample",
          position,
          width: 1200,
          height: 900,
          color: SAMPLE_PHOTO_COLOR,
          takenAt: null,
          attemptId: "sample",
          needsResize: false,
          createdBy: "sample",
          createdAt: 0,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="flex gap-2.5">
      {photos.map((photo, index) => (
        <OpenLarge
          key={photo.id}
          label={`Open photo ${index + 1} of ${photos.length} large`}
          onClick={(event) =>
            openLarge(event, {
              photos,
              start: index,
              title: "Attempt 2",
              badge: <OutcomeChip outcome="success" />,
              detail: "Alex · 2 hours ago",
            })
          }
          className={index === 0 ? "aspect-4/3 w-56 rounded-md" : "size-20 self-end rounded-md"}
        >
          <Photo src={photoSrc(photo.id, index === 0 ? "large" : "thumb")} alt="" className="size-full" />
        </OpenLarge>
      ))}
    </div>
  );
}

const STRIP = [
  { id: "planter", src: planterPhoto, alt: "Planter" },
  { id: "dragon", src: dragonPhoto, alt: "Dragon" },
  { id: "vase", src: vasePhoto, alt: "Vase" },
];

/** The idea page's strip in small: the photo showing carries the "…", and its menu holds Make cover and Remove. */
function StripMenuDemo() {
  const [selected, setSelected] = useState("dragon");
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ul className="flex gap-2.5 pt-1">
        {STRIP.map((photo, index) => (
          <li key={photo.id} className="group/thumb relative">
            <button
              type="button"
              ref={photo.id === selected ? anchor : undefined}
              aria-current={photo.id === selected || undefined}
              aria-label={`Photo ${index + 1}`}
              onClick={() => (photo.id === selected ? setOpen(true) : setSelected(photo.id))}
              className={
                photo.id === selected
                  ? "pressable focus-ring ring-semolina ring-offset-paper block rounded-md ring-2 ring-offset-2"
                  : "pressable focus-ring block rounded-md"
              }
            >
              <PhotoThumb size="sm" src={photo.src} alt={photo.alt} />
            </button>
            <PhotoMenuDot
              shown={photo.id === selected}
              onClick={() => {
                setSelected(photo.id);
                setOpen(true);
              }}
            />
          </li>
        ))}
      </ul>
      <ActionMenu
        open={open}
        onOpenChange={setOpen}
        title={`Photo ${STRIP.findIndex((photo) => photo.id === selected) + 1} of ${STRIP.length}`}
        anchor={anchor}
        returnFocus={anchor}
      >
        {selected !== STRIP[0]?.id && (
          <ActionMenuItem icon={Icons.MakeCoverIcon} onSelect={() => toast.message("Now the cover")}>
            Make cover
          </ActionMenuItem>
        )}
        <ActionMenuItem
          icon={Icons.TrashIcon}
          tone="danger"
          onSelect={() => toast.undo("Photo removed", { onUndo: () => undefined })}
        >
          Remove photo
        </ActionMenuItem>
      </ActionMenu>
    </>
  );
}
