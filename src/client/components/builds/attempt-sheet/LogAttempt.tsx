import type { AttemptFile } from "@shared/api";
import { type AttemptSettings, carryOver, type Outcome } from "@shared/attempts";
import { partsOnPlate } from "@shared/parts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { type AppliedRecipe, RecipePicker } from "@/components/recipes/RecipePicker";
import { Button } from "@/components/ui/Button";
import { CameraIcon, ImageIcon, PlusIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { type AttemptDraft, logAttempt } from "@/lib/builds";
import { useDraftPhotos } from "@/lib/capture";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { sessionQuery } from "@/lib/queries";
import { queueSlicerFile } from "@/lib/slicer-files";
import { useIsDesktop } from "@/lib/use-media-query";
import { offerLine, useWhatWorked, WhatWorkedSuggestion } from "../WhatWorkedSuggestion";
import { AttemptFields } from "./AttemptFields";
import { useOutcomeCounts } from "./PlateParts";
import { DraftFile, fetchKeptFile, keptSlices, SlicerFileSection, useSlicerFile } from "./SheetSlicerFile";
import { WhenField } from "./WhenField";

// Claude's ideas from the attempt before: only there when it went wrong.
const CoachSuggestions = lazy(() => import("../Coach").then((m) => ({ default: m.CoachSuggestions })));

/** What the notebook says after a print that went to spaghetti: kind, short, never cheerful about the failure itself. */
const FAILED_LINES = [
  ["Written down", "The next try starts from what this one taught."],
  ["Noted, noodles and all", "Spaghetti is the best kind of note."],
  ["Into the notebook", "You'll know exactly what to change."],
] as const;

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
  const [usedMatch, setUsedMatch] = useState<{ id: string; before: AttemptSettings } | null>(null);
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

  // The first attempt prints from the idea's slice: with exactly one, it is attached as the sheet opens (taking it
  // off, or picking another, is the person's choice and stays). With several there is a plain choice in the well.
  const only = previous
    ? undefined
    : (() => {
        const slices = keptSlices(item.files ?? []);
        return slices.length === 1 ? slices[0] : undefined;
      })();
  const [declined, setDeclined] = useState(false);
  // A download that finishes after the person chose something else (took the file off, dropped another, reopened)
  // must not attach: each start takes a number, and only the latest may attach.
  const attaching = useRef(0);
  const taken = useRef(false);
  taken.current = !!slicer.state || declined;
  const attachKept = async (kept: AttemptFile, auto = false) => {
    const turn = ++attaching.current;
    const file = await fetchKeptFile(kept, auto);
    if (!file || turn !== attaching.current || (auto && taken.current)) return;
    // A kept model gives its sliced file, and what its slice said (no stand-in filament claimed).
    void slicer.take(file, kept.kind === "model" ? kept.prefill : undefined);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once for each file the idea has, as the sheet opens.
  useEffect(() => {
    if (open && only && !declined && !slicer.state && !incomingFile) void attachKept(only, true);
  }, [open, only?.id, declined]);

  const worked = useWhatWorked(item.id, draft.settings);

  // A fresh sheet starts from the latest attempt (one may have been logged since), but a
  // half-filled one is kept when it closes: nothing typed is lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening.
  useEffect(() => {
    if (open && !dirty && !photos.length && !slicer.state) {
      setDraft(blank());
      setRecipe(null);
      setUsedMatch(null);
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
    // A model goes with the attempt as soon as it is logged, sliced or not: its slice follows it (lib/slicing/jobs).
    if (file && (file.prefill || file.draft.kind === "model")) {
      queueSlicerFile(item.id, attemptId, file.draft, file.plate, file.prefill ?? {});
    }
    slicer.clear();
    clear();
    setDirty(false);
    setWhen(null);
    setRecipe(null);
    setUsedMatch(null);
    setDraft(blank());
    onOpenChange(false);
    // A failed print is worth keeping: say so, in a different small way each time.
    if (outcome === "failed") {
      const line = FAILED_LINES[item.attempts.length % FAILED_LINES.length];
      if (line) toast.message(line[0], line[1]);
    }
  }

  const number = item.attempts.length + 1;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      desktop="panel"
      title={`Attempt ${number}`}
      description={previous ? undefined : item.title || undefined}
      footer={
        <>
          {isDesktop && (
            <span className="text-caption text-ink-faint mr-auto inline-flex items-center gap-1.5">
              <Kbd keys={["Enter"]} /> {draft.outcome ? "logs it" : "starts it"}
            </span>
          )}
          {/* One primary at a time: "Start print" until an outcome is picked, then "Log attempt" takes over. */}
          <Button
            variant="primary"
            size={isDesktop ? "md" : "lg"}
            onClick={() => save(draft.outcome)}
            className="max-md:flex-1"
          >
            {draft.outcome ? "Log attempt" : "Start print"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // The note handles its own Enter (and logs from there): don't log twice.
          if (event.defaultPrevented) return;
          // Enter on an outcome button, once one is picked (a key press may have picked it): log, don't pick again.
          if (
            event.key === "Enter" &&
            !event.metaKey &&
            !event.ctrlKey &&
            draft.outcome &&
            (event.target as HTMLElement).getAttribute("role") === "radio"
          ) {
            event.preventDefault();
            save(draft.outcome);
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
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
          changeChips
          atFoot={!(!previous && !only && keptSlices(item.files ?? []).length > 1)}
          fromFile={slicer.state?.prefill ?? undefined}
          file={
            <SlicerFileSection
              state={slicer.state}
              onPick={slicer.picker.open}
              onPlate={slicer.choosePlate}
              onAddUnknown={slicer.addUnknown}
              ideaFiles={previous ? undefined : item.files}
              onUseIdeaFile={(kept) => void attachKept(kept)}
              unknown={slicer.unknownFilaments}
              card={
                slicer.state && (slicer.state.prefill || slicer.state.draft.kind === "model") ? (
                  <DraftFile
                    state={slicer.state}
                    onRemove={() => {
                      setDeclined(true);
                      slicer.remove();
                    }}
                    onChange={only ? slicer.picker.open : undefined}
                    onSlice={slicer.reslice}
                  />
                ) : null
              }
            />
          }
          onEnter={() => save(draft.outcome)}
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
          coach={
            previous?.coach && (
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
            )
          }
          suggestionOffer={!slicer.state && worked.best && worked.offers ? offerLine(worked.best) : undefined}
          suggestion={
            <>
              {/* A slicer file says what this attempt is: no other settings to offer. */}
              {slicer.state ? null : (
                <>
                  <WhatWorkedSuggestion
                    itemId={item.id}
                    settings={draft.settings}
                    onUse={(settings) => change({ settings })}
                    used={usedMatch}
                    onUsed={setUsedMatch}
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
              starting={!draft.outcome}
              value={when}
              onChange={(time) => {
                setWhen(time);
                setDirty(true);
              }}
            />
          }
          photos={
            !isDesktop && photos.length === 0 ? (
              // One-handed at the printer: two wide, short tiles across the sheet, easy to hit with a thumb, and the
              // note comes sooner than under the old pair of squares.
              <div className="grid grid-cols-2 gap-2.5">
                <AddPhotoTile size="row" icon={CameraIcon} label="Take photo" onClick={camera.open} />
                <AddPhotoTile size="row" icon={ImageIcon} label="Library" onClick={library.open} />
              </div>
            ) : (
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
            )
          }
        />
      </form>
    </Sheet>
  );
}
