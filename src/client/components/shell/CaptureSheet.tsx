import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { CameraIcon, ImageIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { useCapture } from "@/lib/capture";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * Placeholder for capture (the real one arrives with ideas): the shape of
 * the sheet, its photo-first layout and its draft that survives closing.
 */
export function CaptureSheet() {
  const { open, setOpen, draft, setDraft } = useCapture();
  const isDesktop = useIsDesktop();

  function save() {
    toast.message("Not cooked yet", "Saving ideas comes with the next update. Your draft stays put.");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="New idea"
      description="Titles can wait. Just get it down."
      footer={
        <>
          {isDesktop && <span className="text-caption text-ink-faint mr-auto">Drafts are kept until you save.</span>}
          <Button variant="primary" size={isDesktop ? "md" : "lg"} fullWidth={!isDesktop} onClick={save}>
            Save idea
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isDesktop ? (
          <PhotoTile icon={ImageIcon} label="Drop, paste or choose a photo" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <PhotoTile icon={CameraIcon} label="Take photo" />
            <PhotoTile icon={ImageIcon} label="From library" />
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
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
          }}
        />
      </div>
    </Sheet>
  );
}

function PhotoTile({ icon: Icon, label }: { icon: typeof CameraIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={() => toast.message("Photos are on the way", "Photo capture comes with the next update.")}
      className="pressable focus-ring bg-ink/4 text-ink-soft shadow-well hover:bg-ink/6 hover:text-ink flex h-28 flex-col items-center justify-center gap-2 rounded-lg"
    >
      <Icon size={28} aria-hidden />
      <span className="text-small font-semibold">{label}</span>
    </button>
  );
}
