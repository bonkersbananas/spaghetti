import type { UpkeepLog, UpkeepTask } from "@shared/api";
import { inlineTime } from "@shared/time";
import { formatHours } from "@shared/upkeep";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { NumberField, TextArea, TextField } from "@/components/ui/Field";
import { CameraIcon, ImageIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { Sheet } from "@/components/ui/Sheet";
import { photoSrc } from "@/lib/previews";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { addUpkeep, deleteUpkeep, logUpkeep, updateUpkeep, upkeepQuery } from "@/lib/upkeep";
import { useIsDesktop } from "@/lib/use-media-query";
import { useObjectUrl } from "@/lib/use-object-url";

/** "Done": a note and a photo are optional; the person, the time and the printer's hours are recorded. */
export function DoneSheet({ task, onOpenChange }: { task: UpkeepTask; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(sessionQuery);
  const hours = useQuery(upkeepQuery).data?.printHours;
  const isDesktop = useIsDesktop();
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const photoUrl = useObjectUrl(photo);
  const pick = (files: File[]) => {
    const file = files[0];
    if (file) setPhoto(file);
  };
  const camera = useFilePicker({ camera: true, onFiles: pick, testId: "upkeep-camera-input" });
  const library = useFilePicker({ onFiles: pick, testId: "upkeep-photo-input" });
  const save = () => {
    if (user) void logUpkeep(queryClient, task, user.id, { note, photo });
    onOpenChange(false);
  };

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={task.name}
      description={hours === undefined ? "Mark it done." : `Done now, at ${formatHours(hours)} of printing.`}
      footer={
        <Button variant="primary" onClick={save} className="max-md:flex-1">
          Done
        </Button>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {task.note && <p className="text-small text-ink-soft">{task.note}</p>}
        <TextArea
          label="A note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What you did, or what you found"
          minRows={2}
        />
        {camera.input}
        {library.input}
        <div className="flex gap-2.5">
          {photo ? (
            photoUrl && <PhotoThumb src={photoUrl} alt="Photo of the upkeep" onRemove={() => setPhoto(null)} />
          ) : (
            <>
              {!isDesktop && <AddPhotoTile size="md" icon={CameraIcon} label="Take a photo" onClick={camera.open} />}
              <AddPhotoTile
                size="md"
                icon={isDesktop ? PlusIcon : ImageIcon}
                label={isDesktop ? "Add a photo" : "Library"}
                onClick={library.open}
              />
            </>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function LogRow({ log }: { log: UpkeepLog }) {
  const { data: people } = useQuery(peopleQuery);
  const person = people?.find((p) => p.id === log.doneBy);
  return (
    <li className="flex items-start gap-3 py-2.5">
      {person && <Avatar person={person} size="sm" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-small text-ink tabular">
          {inlineTime(log.doneAt)} <span className="text-ink-faint">· at {formatHours(log.printerHours)}</span>
        </span>
        {log.note && <span className="text-small text-ink-soft">{log.note}</span>}
      </div>
      {log.photo && (
        <Photo
          src={photoSrc(log.photo.id, "thumb")}
          alt={`Photo from ${inlineTime(log.doneAt)}`}
          color={log.photo.color}
          className="size-14 shrink-0 rounded-md"
        />
      )}
    </li>
  );
}

/** A task: its name, what it involves and its interval, and its history; or a new one. Fields save when left. */
export function TaskSheet({ task, onOpenChange }: { task: UpkeepTask | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(task?.name ?? "");
  const [note, setNote] = useState(task?.note ?? "");
  const [hours, setHours] = useState<number | undefined>(task?.intervalHours ?? undefined);
  const [days, setDays] = useState<number | undefined>(task?.intervalDays ?? (task ? undefined : 30));
  const noInterval = !hours && !days;
  const valid = name.trim() !== "" && !noInterval;

  const commit = (changes: {
    name?: string;
    note?: string;
    intervalHours?: number | null;
    intervalDays?: number | null;
  }) => {
    if (task && valid) void updateUpkeep(queryClient, task.id, changes);
  };

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={task ? task.name : "A task of your own"}
      description={
        task ? "How often it comes round, and when it was done." : "Something the printer needs now and then."
      }
      footer={
        task ? (
          <Button
            variant="quiet"
            icon={TrashIcon}
            onClick={() => {
              deleteUpkeep(queryClient, task);
              onOpenChange(false);
            }}
          >
            Remove task
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!valid}
            className="max-md:flex-1"
            onClick={() => {
              void addUpkeep(queryClient, {
                name: name.trim(),
                note: note.trim(),
                intervalHours: hours ?? null,
                intervalDays: days ?? null,
              });
              onOpenChange(false);
            }}
          >
            Add task
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name.trim() !== task?.name && commit({ name: name.trim() })}
          placeholder="Wipe the lid"
          maxLength={80}
        />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Every (print hours)"
            suffix="print h"
            value={hours}
            min={1}
            max={100000}
            onChange={setHours}
            onBlur={() => hours !== (task?.intervalHours ?? undefined) && commit({ intervalHours: hours ?? null })}
          />
          <NumberField
            label="Or every (days)"
            suffix="days"
            value={days}
            min={1}
            max={3650}
            onChange={setDays}
            onBlur={() => days !== (task?.intervalDays ?? undefined) && commit({ intervalDays: days ?? null })}
          />
        </div>
        <p className="text-small text-ink-faint -mt-3">
          {noInterval
            ? "Give it print hours, days or both: whichever comes first makes it due."
            : "Whichever comes first makes it due."}
        </p>
        <TextArea
          label="What it involves"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => task && note !== task.note && commit({ note })}
          minRows={2}
        />
        {task && (
          <section aria-labelledby="upkeep-history">
            <h3 id="upkeep-history" className="text-caption text-ink-faint font-semibold tracking-wider uppercase">
              History
            </h3>
            {task.history.length === 0 ? (
              <p className="text-small text-ink-faint mt-2">Not done yet. Done puts the first line here.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {task.history.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
