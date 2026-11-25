import { fieldsFor, type SheetFields, type SheetValue, toChanges, toFields, toValue } from "@shared/attempt-fields";
import type { Outcome } from "@shared/attempts";
import { partsOnPlate } from "@shared/parts";
import { takenWith } from "@shared/photo-read";
import { isOffTheBed } from "@shared/print-progress";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { SaveAsRecipe } from "@/components/recipes/SaveAsRecipe";
import { ActionMenuItem, MoreMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { CameraIcon, ImageIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { openLarge } from "@/components/ui/OpenLarge";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { deleteAttempt, queueFinish, saveAttemptChanges } from "@/lib/builds";
import { useHasCamera } from "@/lib/has-camera";
import { type AttemptView, addPhotosToItem, type ItemView, removePhoto } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useReadOnly } from "@/lib/read-only";
import { canBeRecipe } from "@/lib/recipes";
import { queueSlicerFile, removeSlicerFile } from "@/lib/slicer-files";
import { useLiveFields } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";
import { EstimateLine, elapsedIfPlausible } from "../Estimate";
import { OutcomeChip } from "../Outcome";
import { PhotoReadNote } from "../PhotoReadNote";
import { SavedFileCard } from "../SlicerFile";
import { AttemptFields } from "./AttemptFields";
import { useOutcomeCounts } from "./PlateParts";
import { SlicerFileSection, useSlicerFile } from "./SheetSlicerFile";
import { WhenField } from "./WhenField";

export function EditAttempt({
  item,
  attempt,
  open,
  onOpenChange,
  initialOutcome,
  incomingFile,
  footerHost,
  menuHost,
  ask,
}: {
  item: ItemView;
  attempt: AttemptView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Picked on the card of a print that is off the bed: the attempt is finished with it as the sheet opens. */
  initialOutcome?: Outcome | null;
  incomingFile?: { file: File; key: number } | null;
  /** Where the footer (Delete, the save state, Done) is drawn: the sheet's own footer. */
  footerHost: HTMLElement | null;
  /** Where its "…" menu is drawn: the sheet's header, top right, as the app's other menus. */
  menuHost: HTMLElement | null;
  /** Asked with the outcome, right above it: the printer's "which build is this?". */
  ask?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const hasCamera = useHasCamera();
  const offline = useReadOnly(attempt.pending);
  const printing = attempt.outcome === null;
  // Offline, a print still printing can be finished (it is sent later); anything else saved is only for reading.
  const readOnly = offline ? (printing ? "finish" : "all") : undefined;
  // The fields follow the server's copy of the attempt (the other person's edit, the printer's report) except the
  // one being typed in, and a save sends only the fields changed here: each setting is a field of its own, sent
  // merged into the server's latest settings. While finishing offline nothing autosaves: what was typed waits for
  // the finish button (or for the connection, when it comes back and the usual autosave takes over).
  const server = useMemo(() => toFields(attempt), [attempt]);
  // The finish is queued (the button was pressed): what was typed goes out inside it, as what was added to the note,
  // so it stays held. Once the finish shows as done the attempt isn't "printing" any more, and without this the held
  // text would be sent again as a plain edit of the whole note, overwriting what the other person wrote meanwhile.
  const finishQueued = useRef(false);
  const latestSettings = useRef(attempt.settings);
  latestSettings.current = attempt.settings;
  const {
    value: fields,
    change: changeFields,
    saveState,
  } = useLiveFields<SheetFields>(
    server,
    (changes) => {
      const { changes: send, settingsMerge } = toChanges(changes, latestSettings.current);
      return saveAttemptChanges(queryClient, item.id, attempt.id, send, settingsMerge);
    },
    { delay: 500, hold: readOnly === "finish" || finishQueued.current, keepAs: `attempt:${attempt.id}` },
  );
  const value = useMemo(() => toValue(fields), [fields]);
  const change = (next: Partial<SheetValue>) => changeFields((current) => fieldsFor(current, next));
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(item.id, files, attempt.id) });
  const library = useFilePicker({
    multiple: true,
    onFiles: (files) => addPhotosToItem(item.id, files, attempt.id),
  });
  const photos = item.photos.filter((photo) => photo.attemptId === attempt.id);
  const previous = item.attempts[attempt.number - 2];
  const outcomeCounts = useOutcomeCounts();
  const slicer = useSlicerFile({
    // Offline, a saved attempt's settings are only for reading: no file can go on it.
    open: open && !readOnly,
    settings: value.settings,
    onSettings: (settings) => change({ settings }),
    onReady: (draft, plate, prefill) => queueSlicerFile(item.id, attempt.id, draft, plate, prefill),
    onObjects: (objects) => {
      const found = partsOnPlate(objects, item.parts);
      if (found.length && !value.parts.length) change({ parts: outcomeCounts(found, value.outcome) });
    },
    incomingFile,
  });
  // Claude's read of the photo, while there is still a question: a suggestion only, the attempt has no outcome of its own.
  const read =
    attempt.outcome === null && !value.outcome && attempt.photoRead?.status === "read" ? attempt.photoRead : null;
  const reading = attempt.outcome === null && !value.outcome ? attempt.photoRead : null;
  // What is offered, marked "· suggested", whichever answer was picked: Claude's failure tags then the printer's tag,
  // and Claude's success notes.
  const claudeRead = attempt.photoRead?.status === "read" ? attempt.photoRead : null;
  const claudeTags = claudeRead?.failureTags ?? [];
  const suggestedFailureTags = [
    ...new Set([...claudeTags, ...(attempt.suggestedFailureTag ? [attempt.suggestedFailureTag] : [])]),
  ];
  // Claude's suggestions come along with an answer only while the print is being answered: once it has an outcome, they only
  // stay marked. Set as the sheet opens, so changing the answer in it still takes back what came with the first one.
  const answering = useRef(attempt.outcome === null);
  const finish = (outcome: Outcome) => {
    // Finishing a print that was logged as it started: how long it took, if that's believable.
    const actual =
      printing && value.settings.actualMinutes === undefined
        ? elapsedIfPlausible(attempt.printedAt, value.settings.estimatedMinutes)
        : undefined;
    // Claude's tags and notes come only with the outcome Claude suggested; the printer's tag only with Spaghetti
    // (decision 0023). They are the person's to take off; the others stay offered, marked, one tap each.
    const taken = takenWith(outcome, value, {
      read: answering.current ? claudeRead : null,
      printerTag: attempt.suggestedFailureTag,
    });
    change({
      outcome,
      ...(value.parts.length ? { parts: outcomeCounts(value.parts, outcome) } : {}),
      ...taken,
      ...(actual !== undefined ? { settings: { ...value.settings, actualMinutes: actual } } : {}),
    });
  };
  const { estimatedMinutes, actualMinutes } = value.settings;
  // The outcome was picked on the card: take it as the sheet opens, once.
  const picked = useRef(false);
  useEffect(() => {
    if (open && initialOutcome && printing && !picked.current) {
      picked.current = true;
      finish(initialOutcome);
    }
  });

  const footer = (
    <>
      {/* On a phone it floats just above Done (the sheet is its positioned parent), so Done keeps the whole width. */}
      <SaveStatus
        state={saveState}
        className="max-md:absolute max-md:right-5 max-md:bottom-[max(5.25rem,calc(var(--sg-safe-bottom)+4.25rem))] md:ml-auto"
      />
      <Button
        variant={printing && !value.outcome ? "secondary" : "primary"}
        size={isDesktop ? "md" : "lg"}
        className="max-md:flex-1"
        onClick={() => {
          if (readOnly === "finish" && value.outcome) {
            finishQueued.current = true;
            queueFinish(item.id, attempt, { ...value, outcome: value.outcome });
          }
          onOpenChange(false);
        }}
      >
        {readOnly === "finish" && value.outcome ? "Finish attempt" : "Done"}
      </Button>
    </>
  );

  return (
    <>
      {/* The footer belongs to the sheet's frame, which stays put when stepping to another attempt: it is drawn there. */}
      {footerHost && createPortal(footer, footerHost)}
      {menuHost &&
        createPortal(
          <>
            {/* Rare, and a slip next to Done is costly: delete lives behind "…" in the header, away from Done. */}
            <MoreMenu label="More for this attempt" title="Attempt" description={`Attempt ${attempt.number}`} inSheet>
              <ActionMenuItem
                icon={TrashIcon}
                tone="danger"
                disabled={!!readOnly}
                onSelect={() => {
                  deleteAttempt(queryClient, item.id, attempt);
                  onOpenChange(false);
                }}
              >
                Delete attempt
              </ActionMenuItem>
            </MoreMenu>
          </>,
          menuHost,
        )}
      {camera.input}
      {library.input}
      {slicer.picker.input}
      <AttemptFields
        outcomeLabel={printing ? "Finished? How did it go?" : "How did it go?"}
        readOnly={readOnly}
        outcome={value.outcome}
        onOutcome={finish}
        plate={{ parts: item.parts, value: value.parts, onChange: (parts) => change({ parts }) }}
        fromFile={attempt.file?.prefill}
        estimate={
          value.outcome && estimatedMinutes !== undefined && actualMinutes !== undefined ? (
            <EstimateLine estimated={estimatedMinutes} actual={actualMinutes} className="px-0.5" />
          ) : null
        }
        file={
          <SlicerFileSection
            state={slicer.state?.plate === null ? slicer.state : null}
            onPick={slicer.picker.open}
            onPlate={slicer.choosePlate}
            onAddUnknown={slicer.addUnknown}
            unknown={slicer.unknownFilaments}
            card={
              attempt.file ? (
                <SavedFileCard
                  file={attempt.file}
                  filaments={attempt.settings.filaments}
                  owner={readOnly ? undefined : { itemId: item.id, attemptId: attempt.id }}
                  inSheet
                  onRemove={() => removeSlicerFile(queryClient, item.id, attempt)}
                />
              ) : null
            }
          />
        }
        note={value.note}
        onNote={(note) => change({ note })}
        failureTags={value.failureTags}
        suggestedFailureTag={suggestedFailureTags}
        suggestedSuccessNotes={claudeRead?.successNotes}
        printerFailureTag={
          // The printer's tag is the printer's, unless Claude named it too and its answer is the one picked.
          attempt.suggestedFailureTag &&
          !(claudeTags.includes(attempt.suggestedFailureTag) && value.outcome === claudeRead?.outcome)
            ? attempt.suggestedFailureTag
            : undefined
        }
        suggestedOutcome={read?.outcome}
        outcomeHint={reading ? <PhotoReadNote read={reading} /> : null}
        ask={ask}
        onFailureTags={(failureTags) => change({ failureTags })}
        successNotes={value.successNotes}
        onSuccessNotes={(successNotes) => change({ successNotes })}
        settings={value.settings}
        onSettings={(settings) => change({ settings })}
        previous={previous}
        suggestion={
          value.outcome === "success" &&
          !attempt.pending &&
          canBeRecipe({ outcome: value.outcome, settings: value.settings }) ? (
            <SaveAsRecipe
              source={{
                id: attempt.id,
                itemId: item.id,
                number: attempt.number,
                title: item.title,
                settings: value.settings,
              }}
              disabled={!!readOnly}
            />
          ) : undefined
        }
        when={
          <WhenField
            starting={printing && !value.outcome}
            value={value.printedAt}
            onChange={(time) => change({ printedAt: time ?? Date.now() })}
          />
        }
        photos={
          <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 py-1 md:-mx-6 md:px-6">
            {photos.map((photo, index) => (
              <PhotoThumb
                key={photo.id}
                src={photoSrc(photo.id, "thumb")}
                alt={`Attempt photo ${index + 1}`}
                color={photo.color || undefined}
                busy={!!photo.upload}
                onOpen={(event) =>
                  openLarge(event, {
                    photos,
                    start: index,
                    title: `Attempt ${attempt.number}`,
                    badge: <OutcomeChip outcome={attempt.outcome} offTheBed={isOffTheBed(attempt)} />,
                  })
                }
                confirmRemove
                onRemove={offline && !photo.upload ? undefined : () => removePhoto(queryClient, photo)}
              />
            ))}
            {hasCamera && <AddPhotoTile size="md" icon={CameraIcon} label="Take photo" onClick={camera.open} />}
            <AddPhotoTile
              size="md"
              icon={isDesktop ? PlusIcon : ImageIcon}
              label={isDesktop ? "Add photos" : "Library"}
              onClick={library.open}
            />
          </div>
        }
      />
    </>
  );
}
