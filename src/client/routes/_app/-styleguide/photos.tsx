import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import * as Icons from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { AddPhotoTile, PhotoThumb } from "@/components/ui/PhotoTiles";
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
          <Label>Remove a saved photo: two taps in place</Label>
          <div className="relative">
            <Photo src={vasePhoto} alt="A vase" className="aspect-4/3 rounded-md" />
            <ConfirmRemove
              what="this photo"
              onRemove={() => toast.message("Removed")}
              className="absolute top-3 right-3"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AddPhotoTile icon={Icons.CameraIcon} label="Take photo" />
            <AddPhotoTile icon={Icons.ImageIcon} label="From library" />
          </div>
        </Panel>
      </div>
    </Section>
  );
}
