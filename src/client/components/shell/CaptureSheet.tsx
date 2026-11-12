import type { Outcome } from "@shared/attempts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { OutcomePicker } from "@/components/builds/Outcome";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { TextArea } from "@/components/ui/Field";
import { ChipRow } from "@/components/ui/FilterChips";
import { CameraIcon, ImageIcon, PlusIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { printingAttempts, usePrintingNow } from "@/lib/builds";
import { type CaptureTarget, useCapture } from "@/lib/capture";
import { useBuilds } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";

type Target =
  | { kind: "idea" }
  | { kind: "item"; itemId: string; name: string; isBuild: boolean }
  | { kind: "attempt"; itemId: string; attemptId: string; name: string; number: number };

/**
 * What a capture could be added to instead of a new idea, by context: the idea or build on
 * screen, the print running now (on its build's page, or anywhere). It is only offered, as the
 * second segment: the sheet always opens on "New idea".
 */
function useCaptureTarget(): Target {
  const { pageItem, aim } = useCapture();
  const printingNow = usePrintingNow();
  // Opened from "Snap this print": that print, whatever else is on the bed or on screen.
  if (aim) return { kind: "attempt", itemId: aim.itemId, attemptId: aim.attemptId, name: aim.name, number: aim.number };
  if (pageItem?.printing) {
    return {
      kind: "attempt",
      itemId: pageItem.id,
      attemptId: pageItem.printing.attemptId,
      name: pageItem.title || "this build",
      number: pageItem.printing.number,
    };
  }
  if (pageItem) {
    const isBuild = pageItem.stage !== "idea";
    return {
      kind: "item",
      itemId: pageItem.id,
      name: pageItem.title || (isBuild ? "this build" : "this idea"),
      isBuild,
    };
  }
  if (printingNow) {
    return {
      kind: "attempt",
      itemId: printingNow.item.id,
      attemptId: printingNow.attempt.id,
      name: printingNow.item.title || "the build",
      number: printingNow.attempt.number,
    };
  }
  return { kind: "idea" };
}

/**
 * Capture in under ten seconds: a photo, a note, or both. Saving closes the
 * sheet at once; the idea lands at the top of the inbox while its photos
 * upload in the background. Closing keeps the draft.
 *
 * It always opens on "New idea", from the sidebar, the C hotkey, the + button, a drop or a paste.
 * On an idea's or build's page, or while something prints, a second segment offers "This idea",
 * "This build" or "This print" (which can finish the print), one tap away.
 */
export function CaptureSheet() {
  const { open, setOpen, draft, setDraft, photos, addFiles, removePhoto, save, saveTo, aim } = useCapture();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const camera = useFilePicker({ camera: true, onFiles: addFiles });
  const library = useFilePicker({ multiple: true, onFiles: addFiles });
  const found = useCaptureTarget();
  const { items: builds } = useBuilds();
  const prints = printingAttempts(builds);
  // With several prints on the bed, "This print" can be any of them: the one the sheet picked is only the start.
  const [pickedPrint, setPickedPrint] = useState<string | null>(null);
  const chosen = found.kind === "attempt" ? prints.find((p) => p.attempt.id === pickedPrint) : undefined;
  const auto: Target = chosen
    ? {
        kind: "attempt",
        itemId: chosen.item.id,
        attemptId: chosen.attempt.id,
        name: chosen.item.title || "the build",
        number: chosen.attempt.number,
      }
    : found;
  const [asIdea, setAsIdea] = useState(!aim);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Each time it opens, it starts on "New idea" again.
  useEffect(() => {
    if (!open) {
      setAsIdea(true);
      setOutcome(null);
      setPickedPrint(null);
    } else if (aim) setAsIdea(false);
  }, [open, aim]);
  const target: Target = asIdea ? { kind: "idea" } : auto;
  const canSave = !!draft.trim() || photos.length > 0 || (target.kind === "attempt" && !!outcome);

  function onSave() {
    if (target.kind === "idea") {
      const id = save();
      if (id && pathname !== "/ideas") {
        toast.action("Saved to Ideas", {
          label: "View",
          onClick: () => navigate({ to: "/ideas/$ideaId", params: { ideaId: id } }),
        });
      }
      return;
    }
    const to: Exclude<CaptureTarget, { kind: "idea" }> =
      target.kind === "attempt"
        ? { kind: "attempt", itemId: target.itemId, attemptId: target.attemptId, outcome }
        : { kind: "item", itemId: target.itemId };
    if (!saveTo(to)) return;
    const here = pathname.endsWith(target.itemId);
    const message =
      target.kind === "attempt"
        ? outcome
          ? `Attempt ${target.number} finished`
          : `Added to attempt ${target.number}`
        : `Added to ${target.name}`;
    if (here) toast.success(message);
    else {
      const isIdea = target.kind === "item" && !target.isBuild;
      toast.action(message, {
        label: "View",
        onClick: () =>
          isIdea
            ? navigate({ to: "/ideas/$ideaId", params: { ideaId: target.itemId } })
            : navigate({ to: "/builds/$buildId", params: { buildId: target.itemId } }),
      });
    }
  }

  const title =
    target.kind === "idea" ? "New idea" : target.kind === "attempt" ? "Add to the print" : `Add to ${target.name}`;
  const description =
    target.kind === "idea"
      ? "Titles can wait. Just get it down."
      : target.kind === "attempt"
        ? `${target.name}, attempt ${target.number}, is printing.`
        : target.isBuild
          ? "Photos join the build, the note goes into its notes."
          : "Photos join the idea, the note goes into its notes.";
  const saveLabel =
    target.kind === "idea"
      ? "Save idea"
      : target.kind === "attempt"
        ? outcome
          ? "Finish print"
          : "Add to print"
        : target.isBuild
          ? "Add to build"
          : "Add to idea";

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
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
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-capture>
        {camera.input}
        {library.input}
        {auto.kind !== "idea" && (
          <SegmentedControl
            label="Where it goes"
            labelHidden
            options={[
              { value: "idea", label: "New idea" },
              {
                value: "here",
                label: auto.kind === "attempt" ? "This print" : auto.isBuild ? "This build" : "This idea",
              },
            ]}
            value={asIdea ? "idea" : "here"}
            onChange={(value) => setAsIdea(value === "idea")}
            className="w-full"
          />
        )}
        {!asIdea && auto.kind === "attempt" && prints.length > 1 && (
          // Several prints: which one is this photo of? Named by the build; the first is where the sheet started.
          <ChipRow label="Which print" wrap>
            {prints.map(({ item, attempt }) => (
              <ToggleChip
                key={attempt.id}
                selected={attempt.id === auto.attemptId}
                onClick={() => setPickedPrint(attempt.id)}
              >
                {item.title || "Untitled build"} · {attempt.number}
              </ToggleChip>
            ))}
          </ChipRow>
        )}
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
          placeholder={
            target.kind === "idea"
              ? "What's the idea? A link, a measurement, a half-thought…"
              : target.kind === "attempt"
                ? "A line about the print: how it looks, what you noticed…"
                : "A note to add: a measurement, a link, what to try…"
          }
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
        {target.kind === "attempt" && (
          <div className="flex flex-col gap-2.5">
            <p className="text-small text-ink-soft px-0.5 font-semibold">Done printing? How did it go?</p>
            <OutcomePicker
              size="md"
              value={outcome}
              onChange={(next) => setOutcome((current) => (current === next ? null : next))}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}
