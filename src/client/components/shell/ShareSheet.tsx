import { useNavigate } from "@tanstack/react-router";
import { m } from "motion/react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { CheckIcon } from "@/components/ui/icons";
import { NoteLinks } from "@/components/ui/NoteLinks";
import { PhotoThumb } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Sheet } from "@/components/ui/Sheet";
import { useCapture } from "@/lib/capture";
import { type ItemView, useItem, useItemFields } from "@/lib/items";
import { spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * "Captured": what you shared is already an idea in the inbox. This sheet is a moment to add a word to it (the note
 * autosaves like any other) or to open it; closing it loses nothing.
 */
export function ShareSheet() {
  const { shared, closeShared } = useCapture();
  const { item } = useItem(shared ?? "");
  // Keyed by the idea, so each share starts its own fields.
  return shared && item ? <SharedIdea key={item.id} item={item} onClose={closeShared} /> : null;
}

function SharedIdea({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const fields = useItemFields(item);
  const photos = item.photos.filter((photo) => !photo.attemptId);
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title="Captured"
      description="Saved to your ideas. Add a word if you like."
      footer={
        <>
          <Button
            variant="quiet"
            size={isDesktop ? "md" : "lg"}
            onClick={() => {
              onClose();
              void navigate({ to: "/ideas/$ideaId", params: { ideaId: item.id } });
            }}
          >
            Open idea
          </Button>
          <Button variant="primary" size={isDesktop ? "md" : "lg"} onClick={onClose} className="max-md:flex-1">
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-capture-shared>
        <div className="flex items-center gap-3">
          <m.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.gentle}
            className="bg-basil-soft text-basil-ink flex size-9 items-center justify-center rounded-full"
            aria-hidden
          >
            <CheckIcon size={20} weight="bold" />
          </m.span>
          <p className="text-body text-ink-soft min-w-0 flex-1 truncate">{item.title || "Untitled idea"}</p>
          <SaveStatus state={fields.saveState} />
        </div>
        {photos.length > 0 && (
          <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pt-1 pb-1 md:-mx-6 md:px-6">
            {photos.map((photo, index) => (
              <PhotoThumb
                key={photo.id}
                src={photoSrc(photo.id, "thumb")}
                alt={`Shared photo ${index + 1}`}
                color={photo.color}
              />
            ))}
          </div>
        )}
        <TextArea
          appearance="plain"
          aria-label="Add a word"
          placeholder="Add a word: what it's for, what to try…"
          minRows={3}
          value={fields.note}
          onChange={(event) => fields.setNote(event.target.value)}
          autoFocus={isDesktop}
        />
        <NoteLinks note={fields.note} />
      </div>
    </Sheet>
  );
}
