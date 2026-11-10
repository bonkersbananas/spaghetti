import { fieldsFor, type SheetFields, type SheetValue, toChanges, toFields, toValue } from "@shared/attempt-fields";
import type { Outcome } from "@shared/attempts";
import { offTheBedLabel } from "@shared/print-progress";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { CameraIcon, ImageIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { deleteAttempt, queueFinish, saveAttemptChanges } from "@/lib/builds";
import { type AttemptView, addPhotosToItem, type ItemView, removePhoto } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useReadOnly } from "@/lib/read-only";
import { queueSlicerFile, removeSlicerFile } from "@/lib/slicer-files";
import { useLiveFields } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";
import { EstimateLine, elapsedIfPlausible } from "../Estimate";
import { SavedFileCard } from "../SlicerFile";
import { AttemptFields } from "./AttemptFields";
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
}) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const offline = useReadOnly(attempt.pending);
  const printing = attempt.outcome === null;
  // Offline, a print still printing can be finished (it is sent later); anything else saved is only for reading.
  const readOnly = offline ? (printing ? "finish" : "all") : undefined;
  // The fields follow the server's copy of the attempt (the other person's edit, the printer's report) except the
  // one being typed in, and a save sends only the fields changed here: each setting is a field of its own, sent
  // merged into the server's latest settings. While finishing offline nothing autosaves: what was typed waits for
  // the finish button (or for the connection, when it comes back and the usual autosave takes over).
  const server = useMemo(() => toFields(attempt), [attempt]);
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
    { delay: 500, hold: readOnly === "finish" },
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
  const slicer = useSlicerFile({
    // Offline, a saved attempt's settings are only for reading: no file can go on it.
    open: open && !readOnly,
    settings: value.settings,
    onSettings: (settings) => change({ settings }),
    onReady: (draft, plate, prefill) => queueSlicerFile(item.id, attempt.id, draft, plate, prefill),
    incomingFile,
  });
  const finish = (outcome: Outcome) => {
    // Finishing a print that was logged as it started: how long it took, if that's believable.
    const actual =
      printing && value.settings.actualMinutes === undefined
        ? elapsedIfPlausible(attempt.printedAt, value.settings.estimatedMinutes)
        : undefined;
    // A failure tag the printer suggested is offered (marked as a suggestion) once it didn't go well; it's the
    // person's to take off.
    const suggested =
      outcome !== "success" && attempt.suggestedFailureTag && value.failureTags.length === 0
        ? { failureTags: [attempt.suggestedFailureTag] }
        : {};
    change({
      outcome,
      ...suggested,
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
      <Button
        variant="quiet"
        icon={TrashIcon}
        size={isDesktop ? "md" : "lg"}
        disabled={!!readOnly}
        onClick={() => {
          deleteAttempt(queryClient, item.id, attempt);
          onOpenChange(false);
        }}
        className="max-md:px-4"
      >
        Delete
      </Button>
      <SaveStatus state={saveState} className="ml-auto" />
      <Button
        variant={printing && !value.outcome ? "secondary" : "primary"}
        size={isDesktop ? "md" : "lg"}
        onClick={() => {
          if (readOnly === "finish" && value.outcome)
            queueFinish(item.id, attempt, { ...value, outcome: value.outcome });
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
      {camera.input}
      {library.input}
      {slicer.picker.input}
      <AttemptFields
        outcomeLabel={printing ? "Finished? How did it go?" : "How did it go?"}
        readOnly={readOnly}
        outcome={value.outcome}
        onOutcome={finish}
        fromFile={attempt.file?.prefill}
        settingsKey={slicer.settingsKey}
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
                <SavedFileCard file={attempt.file} onRemove={() => removeSlicerFile(queryClient, item.id, attempt)} />
              ) : null
            }
          />
        }
        note={value.note}
        onNote={(note) => change({ note })}
        failureTags={value.failureTags}
        suggestedFailureTag={attempt.suggestedFailureTag ?? undefined}
        onFailureTags={(failureTags) => change({ failureTags })}
        successNotes={value.successNotes}
        onSuccessNotes={(successNotes) => change({ successNotes })}
        settings={value.settings}
        onSettings={(settings) => change({ settings })}
        previous={previous}
        when={<WhenField value={value.printedAt} onChange={(time) => change({ printedAt: time ?? Date.now() })} />}
        photos={
          <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 py-1 md:-mx-6 md:px-6">
            {photos.map((photo, index) => (
              <PhotoThumb
                key={photo.id}
                src={photoSrc(photo.id, "thumb")}
                alt={`Attempt photo ${index + 1}`}
                color={photo.color || undefined}
                busy={!!photo.upload}
                onRemove={offline && !photo.upload ? undefined : () => removePhoto(queryClient, photo)}
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
    </>
  );
}
