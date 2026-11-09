import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { CameraIcon, ImageIcon, PlusIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { useCapture } from "@/lib/capture";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * Capture in under ten seconds: a photo, a note, or both. Saving closes the
 * sheet at once; the idea lands at the top of the inbox while its photos
 * upload in the background. Closing keeps the draft.
 */
export function CaptureSheet() {
  const { open, setOpen, draft, setDraft, photos, addFiles, removePhoto, save } = useCapture();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const camera = useFilePicker({ camera: true, onFiles: addFiles });
  const library = useFilePicker({ multiple: true, onFiles: addFiles });
  const canSave = !!draft.trim() || photos.length > 0;

  function onSave() {
    const id = save();
    if (id && pathname !== "/ideas") {
      toast.action("Saved to Ideas", {
        label: "View",
        onClick: () => navigate({ to: "/ideas/$ideaId", params: { ideaId: id } }),
      });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="New idea"
      description="Titles can wait. Just get it down."
      footer={
        <>
          {isDesktop && (
            <span className="text-caption text-ink-faint mr-auto inline-flex items-center gap-1.5">
              <Kbd keys={["Enter"]} /> saves <span aria-hidden>·</span> <Kbd keys={["Shift", "Enter"]} /> new line
            </span>
          )}
          <Button
            variant="primary"
            size={isDesktop ? "md" : "lg"}
            fullWidth={!isDesktop}
            disabled={!canSave}
            onClick={onSave}
          >
            Save idea
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-capture>
        {camera.input}
        {library.input}
        {photos.length > 0 ? (
          <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pt-1 pb-1 md:-mx-6 md:px-6">
            {photos.map((photo, index) => (
              <PhotoThumb
                key={photo.id}
                src={photoSrc(photo.id, "thumb")}
                alt={`Photo ${index + 1}`}
                color={photo.processed?.color}
                busy={!photo.processed}
                onRemove={() => removePhoto(photo.id)}
              />
            ))}
            {!isDesktop && <AddPhotoTile size="md" icon={CameraIcon} label="Camera" onClick={camera.open} />}
            <AddPhotoTile
              size="md"
              icon={isDesktop ? PlusIcon : ImageIcon}
              label={isDesktop ? "Add" : "Library"}
              onClick={library.open}
            />
          </div>
        ) : isDesktop ? (
          <AddPhotoTile icon={ImageIcon} label="Drop, paste or choose photos" onClick={library.open} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <AddPhotoTile icon={CameraIcon} label="Take photo" onClick={camera.open} />
            <AddPhotoTile icon={ImageIcon} label="From library" onClick={library.open} />
          </div>
        )}
        <TextArea
          appearance="plain"
          aria-label="Note"
          placeholder="What's the idea? A link, a measurement, a half-thought…"
          minRows={isDesktop ? 4 : 3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoFocus={isDesktop}
          enterKeyHint={isDesktop ? undefined : "enter"}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            // Desktop: Enter saves, Shift+Enter is a new line. Anywhere: Cmd/Ctrl+Enter saves.
            if ((isDesktop && !event.shiftKey) || event.metaKey || event.ctrlKey) {
              event.preventDefault();
              if (canSave) onSave();
            }
          }}
        />
      </div>
    </Sheet>
  );
}
