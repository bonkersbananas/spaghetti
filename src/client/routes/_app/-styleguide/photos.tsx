import { useRef, useState } from "react";
import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { ActionMenu, ActionMenuItem } from "@/components/ui/ActionMenu";
import * as Icons from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { AddPhotoTile, PhotoMenuDot, PhotoThumb } from "@/components/ui/PhotoTiles";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { toast } from "@/components/ui/Toast";
import { UploadBadge } from "@/components/ui/UploadBadge";
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
        </Panel>
      </div>
    </Section>
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
