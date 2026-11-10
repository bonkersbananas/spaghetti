import { MAX_SLICER_FILE_BYTES } from "@shared/api";
import { type AttemptSettings, carryOver, describeChanges, type Outcome } from "@shared/attempts";
import { filamentFromSpool, printerHints, spoolFromFilament } from "@shared/spools";
import { applyFileSettings } from "@shared/threemf/index.ts";
import { fullTime, relativeTime } from "@shared/time";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { Disclosure } from "@/components/ui/Disclosure";
import { TextArea, TextField } from "@/components/ui/Field";
import { CalendarIcon, CameraIcon, ImageIcon, PlusIcon, SettingsIcon, TrashIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { MetaList } from "@/components/ui/MetaList";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { type AttemptDraft, deleteAttempt, logAttempt, queueFinish, saveAttemptChanges } from "@/lib/builds";
import { useDraftPhotos } from "@/lib/capture";
import { type AttemptView, addPhotosToItem, type ItemView, removePhoto } from "@/lib/items";
import { addSpool, spoolsQuery, usePrinterSetup } from "@/lib/pantry";
import { photoSrc } from "@/lib/previews";
import { sessionQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import {
  fileSettings,
  formatBytes,
  linkSpools,
  plateOf,
  queueSlicerFile,
  readSlicerFile,
  removeSlicerFile,
  SLICER_ACCEPT,
  type SlicerFileDraft,
  useSlicerDropTarget,
} from "@/lib/slicer-files";
import { useAutosave } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";
import { EstimateLine, elapsedIfPlausible } from "./Estimate";
import { OutcomePicker } from "./Outcome";
import { SettingsEditor } from "./SettingsEditor";
import { AddSlicerFile, FileCard, PlateChooser, SavedFileCard, UnknownFilaments, usePlateThumbUrl } from "./SlicerFile";
import { formatMinutes, summarizeSettings } from "./settings";
import { TagPicker } from "./TagPicker";
import { WhatWorkedSuggestion } from "./WhatWorkedSuggestion";

interface AttemptSheetProps {
  item: ItemView;
  /** Edit (or finish) this attempt; without one, log a new attempt. */
  attemptId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open with the failure tags or the settings already showing. */
  initialOutcome?: Outcome | null;
  /** A slicer file dropped on the build or the attempt: read it into the sheet. */
  incomingFile?: { file: File; key: number } | null;
}

/**
 * Logging an attempt, standing next to the printer: the outcome is one tap,
 * the time is now, and everything else (photos, a line, tags, settings) is
 * one more tap away. A bottom sheet on phones, a side panel on desktop.
 */
export function AttemptSheet({ item, attemptId, open, onOpenChange, initialOutcome, incomingFile }: AttemptSheetProps) {
  const attempt = attemptId ? item.attempts.find((a) => a.id === attemptId) : undefined;
  // The attempt was deleted (here or elsewhere) while open.
  useEffect(() => {
    if (open && attemptId && !attempt) onOpenChange(false);
  }, [open, attemptId, attempt, onOpenChange]);
  if (attemptId) {
    return attempt ? (
      // A finish queued on this device remounts it, so it starts again from the finished attempt rather than autosaving its draft.
      <EditAttempt
        key={`${attempt.id}${attempt.finishQueued ? ":queued" : ""}`}
        item={item}
        attempt={attempt}
        open={open}
        onOpenChange={onOpenChange}
        incomingFile={incomingFile}
      />
    ) : null;
  }
  return (
    <LogAttempt
      item={item}
      open={open}
      onOpenChange={onOpenChange}
      initialOutcome={initialOutcome}
      incomingFile={incomingFile}
    />
  );
}

/** A slicer file being read into the sheet: which plate, what it said, which filaments aren't in the pantry. */
interface SlicerState {
  draft: SlicerFileDraft;
  /** Null until a plate is picked, for a file with several. */
  plate: number | null;
  prefill: AttemptSettings | null;
  /** Filaments (by position) that matched no spool. */
  unknown: number[];
}

/**
 * Reading a dropped or picked .3mf into an attempt: ask for the plate when
 * there are several, lay what the file says over the settings, link its
 * filaments to spools in the pantry, and offer to add the ones that aren't.
 */
function useSlicerFile({
  open,
  settings,
  onSettings,
  onReady,
  incomingFile,
}: {
  open: boolean;
  settings: AttemptSettings;
  onSettings: (settings: AttemptSettings) => void;
  onReady?: (draft: SlicerFileDraft, plate: number | null, prefill: AttemptSettings) => void;
  incomingFile?: { file: File; key: number } | null;
}) {
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const { data: spools = [] } = useQuery(spoolsQuery);
  const [state, setState] = useState<SlicerState | null>(null);
  const [settingsKey, setSettingsKey] = useState(0);
  const latest = useRef(settings);
  latest.current = settings;

  const apply = (draft: SlicerFileDraft, plate: number | null) => {
    const prefill = fileSettings(draft, plate);
    const linked = linkSpools(prefill, spools);
    onSettings(applyFileSettings(latest.current, linked.settings));
    setState({ draft, plate, prefill, unknown: linked.unknown });
    setSettingsKey((key) => key + 1);
    onReady?.(draft, plate, prefill);
  };
  const receive = async (file: File) => {
    const draft = await readSlicerFile(file);
    if (!draft) return;
    if (draft.plates.length > 1) setState({ draft, plate: null, prefill: null, unknown: [] });
    else apply(draft, draft.plates[0]?.index ?? null);
  };
  const picker = useFilePicker({
    accept: SLICER_ACCEPT,
    onFiles: ([file]) => file && void receive(file),
    testId: "slicer-file-input",
  });
  useSlicerDropTarget((file) => void receive(file), open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new drop is a new key.
  useEffect(() => {
    if (incomingFile) void receive(incomingFile.file);
  }, [incomingFile?.key]);

  /** One tap: a filament from the file that isn't in the pantry becomes a spool there, and this attempt's. */
  const addUnknown = (index: number) => {
    const filament = latest.current.filaments?.[index];
    if (!filament || !user) return;
    const { spool } = addSpool(queryClient, spoolFromFilament(filament), user.id);
    onSettings({
      ...latest.current,
      filaments: latest.current.filaments?.map((f, i) =>
        i === index ? filamentFromSpool(spool, { profile: f.profile }) : f,
      ),
    });
    setState((current) => current && { ...current, unknown: current.unknown.filter((i) => i !== index) });
    toast.success("Added to the pantry", [spool.colorName, spool.brand, spool.material].filter(Boolean).join(" "));
  };

  const unknownFilaments = (state?.unknown ?? []).flatMap((index) => {
    const filament = settings.filaments?.[index];
    return filament && !filament.spoolId ? [{ index, filament }] : [];
  });

  return {
    state,
    picker,
    choosePlate: (plate: number) => state && apply(state.draft, plate),
    clear: () => setState(null),
    addUnknown,
    unknownFilaments,
    settingsKey,
  };
}

/** A file read into a new attempt, before it is logged. */
function DraftFile({ state, onRemove }: { state: SlicerState; onRemove: () => void }) {
  const plate = plateOf(state.draft, state.plate);
  const src = usePlateThumbUrl(plate);
  const plateCount = state.draft.result.plates.length;
  const estimate = state.prefill?.estimatedMinutes;
  return (
    <FileCard
      name={state.draft.file.name}
      thumbSrc={src}
      meta={[
        plateCount > 1 && plate ? `plate ${plate.index} of ${plateCount}` : "",
        estimate !== undefined ? `est. ${formatMinutes(estimate)}` : "",
        formatBytes(state.draft.file.size),
      ].filter(Boolean)}
      note={
        state.draft.file.size > MAX_SLICER_FILE_BYTES
          ? `Over ${formatBytes(MAX_SLICER_FILE_BYTES)}, so only what it said will be kept.`
          : undefined
      }
      onRemove={onRemove}
    />
  );
}

const toLocalInput = (time: number) => {
  const date = new Date(time - new Date(time).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};

/** When it printed: "Now" until someone picks another time. */
function WhenField({ value, onChange }: { value: number | null; onChange: (time: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing && value === null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="pressable focus-ring text-small text-ink-soft hover:text-ink rounded-pill inline-flex h-9 items-center gap-1.5 self-start pr-3 pl-2.5 font-semibold md:h-8"
      >
        <CalendarIcon size={16} aria-hidden />
        Printed just now
        <span className="text-ink-faint font-medium">· change</span>
      </button>
    );
  }
  return (
    <TextField
      size="sm"
      type="datetime-local"
      label="When it printed"
      icon={CalendarIcon}
      max={toLocalInput(Date.now())}
      value={toLocalInput(value ?? Date.now())}
      onChange={(event) => {
        const time = new Date(event.target.value).getTime();
        if (Number.isFinite(time)) onChange(Math.min(time, Date.now()));
      }}
      className="max-w-72"
    />
  );
}

interface FieldsProps {
  outcome: Outcome | null;
  onOutcome: (outcome: Outcome) => void;
  note: string;
  onNote: (note: string) => void;
  failureTags: string[];
  onFailureTags: (tags: string[]) => void;
  successNotes: string[];
  onSuccessNotes: (tags: string[]) => void;
  settings: AttemptSettings;
  onSettings: (settings: AttemptSettings) => void;
  /** The attempt before, for "same as attempt 3" and what changed. */
  previous?: AttemptView;
  when: ReactNode;
  photos: ReactNode;
  /** Shown above the outcome while printing. */
  outcomeLabel: string;
  /** Enter in the note, on desktop: log the attempt. */
  onEnter?: () => void;
  /**
   * A saved attempt, seen without a connection: "all" shows what was written and changes nothing;
   * "finish" (a print still printing) lets the outcome, note and tags be filled in, to be sent later.
   */
  readOnly?: "all" | "finish";
  /** Shown above the settings: "what worked last time", for a new attempt. */
  suggestion?: ReactNode;
  /** The slicer file: its card, a plate to pick, or the well to add one. */
  file?: ReactNode;
  /** What the slicer file said, to mark the values that came from it. */
  fromFile?: AttemptSettings;
  /** Changes when a file was read: the settings open to show what it filled in. */
  settingsKey?: number;
  /** Shown under the outcome: how long it took next to the estimate. */
  estimate?: ReactNode;
}

function AttemptFields(props: FieldsProps) {
  const { outcome, previous, settings } = props;
  const isDesktop = useIsDesktop();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A file was read: show what it filled in.
  useEffect(() => {
    if (props.settingsKey) setSettingsOpen(true);
  }, [props.settingsKey]);
  const setup = usePrinterSetup();
  const hints = printerHints(settings, setup);
  const changes = previous ? describeChanges(previous.settings, settings) : [];
  const summary = summarizeSettings(settings);
  const filamentNames = (settings.filaments ?? [])
    .map((f) => [f.brand, f.type].filter(Boolean).join(" "))
    .filter(Boolean);
  const pieces = [...filamentNames, ...summary];
  const settingsSummary: ReactNode = previous ? (
    changes.length ? (
      `Changed from attempt ${previous.number}: ${changes.map((c) => c.text).join(", ")}`
    ) : (
      <MetaList>
        {[`Same as attempt ${previous.number}`, ...pieces.slice(0, 4)].map((piece) => (
          <span key={piece}>{piece}</span>
        ))}
      </MetaList>
    )
  ) : pieces.length ? (
    <MetaList>
      {pieces.map((piece) => (
        <span key={piece}>{piece}</span>
      ))}
    </MetaList>
  ) : (
    "Filament, plate, temperatures, times. All optional."
  );
  const summaryWithFile = props.fromFile ? (
    <span className="inline-flex min-w-0 items-start gap-1.5">
      <FromFileMark className="mt-0.5" />
      <span className="min-w-0">{settingsSummary}</span>
    </span>
  ) : (
    settingsSummary
  );

  return (
    <div className="flex flex-col gap-5" data-capture>
      <fieldset disabled={props.readOnly === "all"} className="contents">
        <div className="flex flex-col gap-3">
          <p className="text-small text-ink-soft px-0.5 font-semibold">{props.outcomeLabel}</p>
          <OutcomePicker value={outcome} onChange={props.onOutcome} />
          {props.estimate}
        </div>
      </fieldset>
      <fieldset disabled={!!props.readOnly} className="contents">
        {props.when}
      </fieldset>
      {props.photos}
      <fieldset disabled={props.readOnly === "all"} className="contents">
        {/* One line of meaning, but it wraps and grows so the whole note stays in view while typing. */}
        <TextArea
          aria-label="Note"
          minRows={1}
          placeholder={
            outcome === "failed"
              ? "What went wrong? One line is plenty."
              : outcome === "success"
                ? "What made it work? One line is plenty."
                : "A line about this attempt"
          }
          maxLength={500}
          enterKeyHint="done"
          value={props.note}
          onChange={(event) => props.onNote(event.target.value.replace(/\n/g, " "))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            // Enter logs the attempt on desktop (when it can be logged); on a phone it puts the keyboard away.
            event.preventDefault();
            if (isDesktop && props.onEnter) props.onEnter();
            else event.currentTarget.blur();
          }}
        />
        {(outcome === "failed" || outcome === "partial") && (
          <TagPicker kind="failure" label="What went wrong?" value={props.failureTags} onChange={props.onFailureTags} />
        )}
        {(outcome === "success" || outcome === "partial") && (
          <TagPicker kind="success" label="What worked?" value={props.successNotes} onChange={props.onSuccessNotes} />
        )}
      </fieldset>
      <fieldset disabled={!!props.readOnly} className="contents">
        {props.file}
      </fieldset>
      {props.suggestion}
      <div className="flex flex-col gap-2">
        <fieldset disabled={!!props.readOnly} className="contents">
          <Disclosure
            open={settingsOpen || !!props.readOnly}
            onOpenChange={setSettingsOpen}
            title="Settings"
            icon={SettingsIcon}
            summary={summaryWithFile}
          >
            <SettingsEditor value={settings} onChange={props.onSettings} outcome={outcome} fromFile={props.fromFile} />
          </Disclosure>
        </fieldset>
        {/* Closed, the settings still say if something needs a look. */}
        {!settingsOpen && !props.readOnly && hints[0] && (
          <Caution className="px-1">
            {hints[0].text}
            {hints.length > 1 ? ` And ${hints.length - 1} more in the settings.` : ""}
          </Caution>
        )}
      </div>
    </div>
  );
}

function LogAttempt({
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
  });
  const [draft, setDraft] = useState(blank);
  const [when, setWhen] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const { photos, addFiles, removePhoto: removeDraftPhoto, clear } = useDraftPhotos();
  const camera = useFilePicker({ camera: true, onFiles: addFiles });
  const library = useFilePicker({ multiple: true, onFiles: addFiles });
  const slicer = useSlicerFile({
    open,
    settings: draft.settings,
    onSettings: (settings) => change({ settings }),
    incomingFile,
  });

  // A fresh sheet starts from the latest attempt (one may have been logged since), but a
  // half-filled one is kept when it closes: nothing typed is lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening.
  useEffect(() => {
    if (open && !dirty && !photos.length && !slicer.state) setDraft(blank());
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
          onOutcome={(outcome) => change({ outcome })}
          note={draft.note}
          onNote={(note) => change({ note })}
          failureTags={draft.failureTags}
          onFailureTags={(failureTags) => change({ failureTags })}
          successNotes={draft.successNotes}
          onSuccessNotes={(successNotes) => change({ successNotes })}
          settings={draft.settings}
          onSettings={(settings) => change({ settings })}
          previous={previous}
          suggestion={
            // A slicer file says what this attempt is: no other settings to offer.
            slicer.state ? null : (
              <WhatWorkedSuggestion
                itemId={item.id}
                settings={draft.settings}
                onUse={(settings) => change({ settings })}
              />
            )
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

function EditAttempt({
  item,
  attempt,
  open,
  onOpenChange,
  incomingFile,
}: {
  item: ItemView;
  attempt: AttemptView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incomingFile?: { file: File; key: number } | null;
}) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const offline = useReadOnly(attempt.pending);
  const printing = attempt.outcome === null;
  // Offline, a print still printing can be finished (it is sent later); anything else saved is only for reading.
  const readOnly = offline ? (printing ? "finish" : "all") : undefined;
  const [value, setValue] = useState({
    outcome: attempt.outcome,
    printedAt: attempt.printedAt,
    note: attempt.note,
    failureTags: attempt.failureTags,
    successNotes: attempt.successNotes,
    settings: attempt.settings,
  });
  // While finishing offline nothing autosaves: what was typed waits for the finish button (or for the
  // connection, when it comes back and the usual autosave takes over).
  const held = useRef(value);
  if (readOnly !== "finish") held.current = value;
  const saveState = useAutosave(
    readOnly === "finish" ? held.current : value,
    (changes) => saveAttemptChanges(queryClient, item.id, attempt.id, changes),
    { delay: 500 },
  );
  const change = (next: Partial<typeof value>) => setValue((current) => ({ ...current, ...next }));
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
    change({ outcome, ...(actual !== undefined ? { settings: { ...value.settings, actualMinutes: actual } } : {}) });
  };
  const { estimatedMinutes, actualMinutes } = value.settings;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      desktop="panel"
      title={printing ? `Finish attempt ${attempt.number}` : `Attempt ${attempt.number}`}
      description={
        <time dateTime={new Date(attempt.printedAt).toISOString()} title={fullTime(attempt.printedAt)}>
          {printing ? "Started printing " : "Printed "}
          {relativeTime(attempt.printedAt).toLowerCase()}
        </time>
      }
      footer={
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
      }
    >
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
    </Sheet>
  );
}

/** The sheet's slicer file: a plate to pick, the file's card (and filaments to add to the pantry), or the well to add one. */
function SlicerFileSection({
  state,
  card,
  onPick,
  onPlate,
  onAddUnknown,
  unknown,
}: {
  state: SlicerState | null;
  card: ReactNode;
  onPick: () => void;
  onPlate: (plate: number) => void;
  onAddUnknown: (index: number) => void;
  unknown: Array<{ index: number; filament: NonNullable<AttemptSettings["filaments"]>[number] }>;
}) {
  const isDesktop = useIsDesktop();
  if (state && state.plate === null) return <PlateChooser draft={state.draft} onPick={onPlate} />;
  if (card) {
    return (
      <div className="flex flex-col gap-3">
        {card}
        <UnknownFilaments filaments={unknown} onAdd={onAddUnknown} />
      </div>
    );
  }
  return <AddSlicerFile onClick={onPick} desktop={isDesktop} />;
}
