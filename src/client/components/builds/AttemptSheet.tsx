import { type AttemptSettings, carryOver, describeChanges, type Outcome } from "@shared/attempts";
import { fullTime, relativeTime } from "@shared/time";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { TextField } from "@/components/ui/Field";
import { CalendarIcon, CameraIcon, ImageIcon, PlusIcon, SettingsIcon, TrashIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Sheet } from "@/components/ui/Sheet";
import { type AttemptDraft, deleteAttempt, logAttempt, saveAttemptChanges } from "@/lib/builds";
import { useDraftPhotos } from "@/lib/capture";
import { type AttemptView, addPhotosToItem, type ItemView, removePhoto } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { sessionQuery } from "@/lib/queries";
import { useAutosave } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";
import { OutcomePicker } from "./Outcome";
import { SettingsEditor } from "./SettingsEditor";
import { summarizeSettings } from "./settings";
import { TagPicker } from "./TagPicker";

interface AttemptSheetProps {
  item: ItemView;
  /** Edit (or finish) this attempt; without one, log a new attempt. */
  attemptId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open with the failure tags or the settings already showing. */
  initialOutcome?: Outcome | null;
}

/**
 * Logging an attempt, standing next to the printer: the outcome is one tap,
 * the time is now, and everything else (photos, a line, tags, settings) is
 * one more tap away. A bottom sheet on phones, a side panel on desktop.
 */
export function AttemptSheet({ item, attemptId, open, onOpenChange, initialOutcome }: AttemptSheetProps) {
  const attempt = attemptId ? item.attempts.find((a) => a.id === attemptId) : undefined;
  // The attempt was deleted (here or elsewhere) while open.
  useEffect(() => {
    if (open && attemptId && !attempt) onOpenChange(false);
  }, [open, attemptId, attempt, onOpenChange]);
  if (attemptId) {
    return attempt ? (
      <EditAttempt key={attempt.id} item={item} attempt={attempt} open={open} onOpenChange={onOpenChange} />
    ) : null;
  }
  return <LogAttempt item={item} open={open} onOpenChange={onOpenChange} initialOutcome={initialOutcome} />;
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
}

function AttemptFields(props: FieldsProps) {
  const { outcome, previous, settings } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const changes = previous ? describeChanges(previous.settings, settings) : [];
  const summary = summarizeSettings(settings);
  const filamentNames = (settings.filaments ?? [])
    .map((f) => [f.brand, f.type].filter(Boolean).join(" "))
    .filter(Boolean);
  const settingsSummary = previous
    ? changes.length
      ? `Changed from attempt ${previous.number}: ${changes.map((c) => c.text).join(", ")}`
      : `Same as attempt ${previous.number}${summary.length ? ` · ${[...filamentNames, ...summary].slice(0, 4).join(" · ")}` : ""}`
    : [...filamentNames, ...summary].join(" · ") || "Filament, plate, temperatures, times. All optional.";

  return (
    <div className="flex flex-col gap-5" data-capture>
      <div className="flex flex-col gap-3">
        <p className="text-small text-ink-soft px-0.5 font-semibold">{props.outcomeLabel}</p>
        <OutcomePicker value={outcome} onChange={props.onOutcome} />
      </div>
      {props.when}
      {props.photos}
      <TextField
        aria-label="Note"
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
        onChange={(event) => props.onNote(event.target.value)}
      />
      {(outcome === "failed" || outcome === "partial") && (
        <TagPicker kind="failure" label="What went wrong?" value={props.failureTags} onChange={props.onFailureTags} />
      )}
      {(outcome === "success" || outcome === "partial") && (
        <TagPicker kind="success" label="What worked?" value={props.successNotes} onChange={props.onSuccessNotes} />
      )}
      <Disclosure
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Settings"
        icon={SettingsIcon}
        summary={settingsSummary}
      >
        <SettingsEditor value={settings} onChange={props.onSettings} outcome={outcome} />
      </Disclosure>
    </div>
  );
}

function LogAttempt({
  item,
  open,
  onOpenChange,
  initialOutcome,
}: {
  item: ItemView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialOutcome?: Outcome | null;
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

  // A fresh sheet starts from the latest attempt (one may have been logged since), but a
  // half-filled one is kept when it closes: nothing typed is lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening.
  useEffect(() => {
    if (open && !dirty && !photos.length) setDraft(blank());
  }, [open]);

  const change = (next: Partial<Omit<AttemptDraft, "photos">>) => {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  };

  function save(outcome: Outcome | null) {
    if (!user) return;
    logAttempt(item, { ...draft, outcome, printedAt: when ?? Date.now(), photos }, user.id);
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
              <Kbd keys={["⌘", "Enter"]} /> logs it
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
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.outcome) {
            event.preventDefault();
            save(draft.outcome);
          }
        }}
      >
        {camera.input}
        {library.input}
        <AttemptFields
          outcomeLabel="How did it go?"
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
}: {
  item: ItemView;
  attempt: AttemptView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [value, setValue] = useState({
    outcome: attempt.outcome,
    printedAt: attempt.printedAt,
    note: attempt.note,
    failureTags: attempt.failureTags,
    successNotes: attempt.successNotes,
    settings: attempt.settings,
  });
  const saveState = useAutosave(value, (changes) => saveAttemptChanges(queryClient, item.id, attempt.id, changes), {
    delay: 500,
  });
  const change = (next: Partial<typeof value>) => setValue((current) => ({ ...current, ...next }));
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(item.id, files, attempt.id) });
  const library = useFilePicker({
    multiple: true,
    onFiles: (files) => addPhotosToItem(item.id, files, attempt.id),
  });
  const photos = item.photos.filter((photo) => photo.attemptId === attempt.id);
  const previous = item.attempts[attempt.number - 2];
  const printing = attempt.outcome === null;

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
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </>
      }
    >
      {camera.input}
      {library.input}
      <AttemptFields
        outcomeLabel={printing ? "Finished? How did it go?" : "How did it go?"}
        outcome={value.outcome}
        onOutcome={(outcome) => change({ outcome })}
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
                onRemove={() => removePhoto(queryClient, photo)}
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
