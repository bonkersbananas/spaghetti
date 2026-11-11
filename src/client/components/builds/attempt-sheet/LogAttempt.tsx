import { carryOver, type Outcome } from "@shared/attempts";
import { partsOnPlate } from "@shared/parts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { type AppliedRecipe, RecipePicker } from "@/components/recipes/RecipePicker";
import { Button } from "@/components/ui/Button";
import { CameraIcon, ImageIcon, PlusIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { Sheet } from "@/components/ui/Sheet";
import { type AttemptDraft, logAttempt } from "@/lib/builds";
import { useDraftPhotos } from "@/lib/capture";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { sessionQuery } from "@/lib/queries";
import { queueSlicerFile } from "@/lib/slicer-files";
import { useIsDesktop } from "@/lib/use-media-query";
import { WhatWorkedSuggestion } from "../WhatWorkedSuggestion";
import { AttemptFields } from "./AttemptFields";
import { useOutcomeCounts } from "./PlateParts";
import { DraftFile, SlicerFileSection, useSlicerFile } from "./SheetSlicerFile";
import { WhenField } from "./WhenField";

// Claude's ideas from the attempt before: only there when it went wrong.
const CoachSuggestions = lazy(() => import("../Coach").then((m) => ({ default: m.CoachSuggestions })));

export function LogAttempt({
  item,
  open,
  onOpenChange,
  initialOutcome,
  incomingFile,
}: {
  item: ItemView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialOutcome?: Outcome | null;
  incomingFile?: { file: File; key: number } | null;
}) {
  const isDesktop = useIsDesktop();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const previous = item.attempts.at(-1);
  const blank = (): Omit<AttemptDraft, "photos"> => ({
    outcome: initialOutcome ?? null,
    printedAt: Date.now(),
    note: "",
    failureTags: [],
    successNotes: [],
    settings: carryOver(previous?.settings),
    parts: [],
  });
  const [draft, setDraft] = useState(blank);
  const [when, setWhen] = useState<number | null>(null);
  const [recipe, setRecipe] = useState<AppliedRecipe | null>(null);
  const [dirty, setDirty] = useState(false);
  const { photos, addFiles, removePhoto: removeDraftPhoto, clear } = useDraftPhotos();
  const camera = useFilePicker({ camera: true, onFiles: addFiles });
  const library = useFilePicker({ multiple: true, onFiles: addFiles });
  const outcomeCounts = useOutcomeCounts();
  const slicer = useSlicerFile({
    open,
    settings: draft.settings,
    onSettings: (settings) => change({ settings }),
    // A plate from a file: its parts are what's on it (unless someone already said).
    onObjects: (objects) => {
      const found = partsOnPlate(objects, item.parts);
      if (found.length)
        setDraft((current) =>
          current.parts.length ? current : { ...current, parts: outcomeCounts(found, current.outcome) },
        );
    },
    incomingFile,
  });

  // A fresh sheet starts from the latest attempt (one may have been logged since), but a
  // half-filled one is kept when it closes: nothing typed is lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening.
  useEffect(() => {
    if (open && !dirty && !photos.length && !slicer.state) {
      setDraft(blank());
      setRecipe(null);
    }
  }, [open]);

  const change = (next: Partial<Omit<AttemptDraft, "photos">>) => {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  };

  function save(outcome: Outcome | null) {
    if (!user) return;
    const attemptId = logAttempt(item, { ...draft, outcome, printedAt: when ?? Date.now(), photos }, user.id);
    const file = slicer.state;
    if (file?.prefill) queueSlicerFile(item.id, attemptId, file.draft, file.plate, file.prefill);
    slicer.clear();
    clear();
    setDirty(false);
    setWhen(null);
    setRecipe(null);
    setDraft(blank());
    onOpenChange(false);
  }

  const number = item.attempts.length + 1;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      desktop="panel"
      title={`Attempt ${number}`}
      description={
        previous
          ? `Starts from attempt ${previous.number}'s settings. Change only what you try differently.`
          : item.title || undefined
      }
      footer={
        <>
          {isDesktop && (
            <span className="text-caption text-ink-faint mr-auto inline-flex items-center gap-1.5">
              <Kbd keys={["Enter"]} /> logs it
            </span>
          )}
          <Button
            variant="secondary"
            size={isDesktop ? "md" : "lg"}
            onClick={() => save(null)}
            className="max-md:flex-1"
          >
            Still printing
          </Button>
          <Button
            variant="primary"
            size={isDesktop ? "md" : "lg"}
            disabled={!draft.outcome}
            onClick={() => save(draft.outcome)}
            className="max-md:flex-1"
          >
            Log attempt
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // The note handles its own Enter (and logs from there): don't log twice.
          if (event.defaultPrevented) return;
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.outcome) {
            event.preventDefault();
            save(draft.outcome);
          }
        }}
      >
        {camera.input}
        {library.input}
        {slicer.picker.input}
        <AttemptFields
          outcomeLabel="How did it go?"
          fromFile={slicer.state?.prefill ?? undefined}
          settingsKey={slicer.settingsKey}
          file={
            <SlicerFileSection
              state={slicer.state}
              onPick={slicer.picker.open}
              onPlate={slicer.choosePlate}
              onAddUnknown={slicer.addUnknown}
              unknown={slicer.unknownFilaments}
              card={slicer.state?.prefill ? <DraftFile state={slicer.state} onRemove={slicer.clear} /> : null}
            />
          }
          onEnter={() => {
            if (draft.outcome) save(draft.outcome);
          }}
          outcome={draft.outcome}
          onOutcome={(outcome) => change({ outcome, parts: outcomeCounts(draft.parts, outcome) })}
          plate={{ parts: item.parts, value: draft.parts, onChange: (parts) => change({ parts }) }}
          note={draft.note}
          onNote={(note) => change({ note })}
          failureTags={draft.failureTags}
          onFailureTags={(failureTags) => change({ failureTags })}
          successNotes={draft.successNotes}
          onSuccessNotes={(successNotes) => change({ successNotes })}
          settings={draft.settings}
          onSettings={(settings) => change({ settings })}
          previous={previous}
          baseline={recipe ? { label: `recipe “${recipe.recipe.name}”`, settings: recipe.settings } : undefined}
          suggestion={
            <>
              {previous?.coach && (
                <Suspense fallback={null}>
                  <CoachSuggestions
                    coach={previous.coach}
                    itemId={item.id}
                    attemptId={previous.id}
                    attemptNumber={previous.number}
                    settings={draft.settings}
                    note={draft.note}
                    onUse={({ settings, note }) =>
                      change({ ...(settings ? { settings } : {}), ...(note !== undefined ? { note } : {}) })
                    }
                  />
                </Suspense>
              )}
              {/* A slicer file says what this attempt is: no other settings to offer. */}
              {slicer.state ? null : (
                <>
                  <WhatWorkedSuggestion
                    itemId={item.id}
                    settings={draft.settings}
                    onUse={(settings) => change({ settings })}
                  />
                  <RecipePicker
                    settings={draft.settings}
                    applied={recipe}
                    onApply={(applied) => {
                      setRecipe(applied);
                      change({ settings: applied.settings });
                    }}
                    onUndo={(applied) => {
                      setRecipe(null);
                      change({ settings: applied.before });
                    }}
                  />
                </>
              )}
            </>
          }
          when={
            <WhenField
              value={when}
              onChange={(time) => {
                setWhen(time);
                setDirty(true);
              }}
            />
          }
          photos={
            <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 py-1 md:-mx-6 md:px-6">
              {photos.map((photo, index) => (
                <PhotoThumb
                  key={photo.id}
                  src={photoSrc(photo.id, "thumb")}
                  alt={`Attempt photo ${index + 1}`}
                  color={photo.processed?.color}
                  busy={!photo.processed}
                  onRemove={() => removeDraftPhoto(photo.id)}
                />
              ))}
              {!isDesktop && <AddPhotoTile size="md" icon={CameraIcon} label="Take photo" onClick={camera.open} />}
              <AddPhotoTile
                size="md"
                icon={isDesktop ? PlusIcon : ImageIcon}
                label={isDesktop ? "Add photos" : "Library"}
                onClick={library.open}
              />
            </div>
          }
        />
      </form>
    </Sheet>
  );
}
