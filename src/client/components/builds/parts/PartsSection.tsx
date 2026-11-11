import { allPartsPrinted, type PartProgress, partProgress, partsFromFiles, progressLabel } from "@shared/parts";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckCircleIcon, FinishIcon, PlusIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { saveParts } from "@/lib/parts";
import { photoSrc } from "@/lib/previews";

const PartsEditor = lazy(() => import("./PartsEditor"));

/** One part and how far along it is: reference text on paper, a pip for each piece needed. */
export function PartLine({ progress, photo }: { progress: PartProgress; photo?: { id: string; color: string } }) {
  const { part, made, printing, done } = progress;
  return (
    <li className="flex items-center gap-3" data-testid="part-line">
      {photo && (
        <Photo
          src={photoSrc(photo.id, "thumb")}
          alt=""
          color={photo.color || undefined}
          className="size-9 shrink-0 rounded-md"
        />
      )}
      <span className="text-body text-ink min-w-0 flex-1 font-semibold">{part.name}</span>
      {part.quantity <= 8 && (
        <span className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: part.quantity }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: pips are positions.
              key={index}
              className={cn("size-2.5 rounded-full", index < made ? "bg-basil" : "bg-ink/20")}
            />
          ))}
        </span>
      )}
      <span
        className={cn(
          "text-small tabular flex shrink-0 items-center gap-1 font-semibold",
          done ? "text-basil-ink" : "text-ink-soft",
        )}
      >
        {done && <CheckCircleIcon size={16} weight="fill" aria-hidden />}
        {progressLabel(progress)}
        {!done && printing > 0 && <span className="text-ink-faint font-normal"> · {printing} printing</span>}
      </span>
    </li>
  );
}

/**
 * A build's parts, under its notes where the summary is. Nothing but a quiet "Add parts" for a simple build (and
 * "Parts from the file" when its slicer file names objects); a calm list with progress once there are parts, and an
 * offer to finish the build when every one is printed.
 */
export function PartsSection({
  item,
  active,
  readOnly,
  onFinishBuild,
}: {
  item: ItemView;
  /** The build is still going: only then does "all printed" offer to finish it. */
  active: boolean;
  readOnly: boolean;
  onFinishBuild: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const progress = useMemo(() => partProgress(item.parts, item.attempts), [item.parts, item.attempts]);
  const fromFile = useMemo(
    () =>
      partsFromFiles(
        item.attempts.flatMap((attempt) =>
          attempt.file && attempt.file.objects?.length
            ? [{ name: attempt.file.name, plate: attempt.file.plate, objects: attempt.file.objects }]
            : [],
        ),
      ),
    [item.attempts],
  );
  const disabled = readOnly || item.pending;
  const editor = (
    <Suspense fallback={null}>
      <PartsEditor
        itemId={item.id}
        parts={item.parts}
        photos={item.photos.filter((photo) => !photo.attemptId && !photo.upload)}
        onDone={() => setEditing(false)}
      />
    </Suspense>
  );

  if (!item.parts.length) {
    if (editing) {
      return (
        <section aria-label="Parts" className="mt-2 flex flex-col gap-2">
          <Overline as="h2">Parts</Overline>
          {editor}
        </section>
      );
    }
    return (
      <section aria-label="Parts" className="mt-1 -ml-2.5 flex flex-col items-start gap-1">
        {(fromFile.length > 1 || (fromFile[0]?.quantity ?? 0) > 1) && (
          <Button
            variant="quiet"
            size="sm"
            icon={PlusIcon}
            disabled={disabled}
            className="h-auto min-h-8 py-1 text-left whitespace-normal"
            onClick={() =>
              void saveParts(
                queryClient,
                item.id,
                fromFile.map((part) => ({ id: crypto.randomUUID(), ...part })),
              ).catch(() => undefined)
            }
          >
            Parts from the file:{" "}
            {fromFile.map((part) => (part.quantity > 1 ? `${part.name} ×${part.quantity}` : part.name)).join(", ")}
          </Button>
        )}
        <Button variant="quiet" size="sm" icon={PlusIcon} disabled={disabled} onClick={() => setEditing(true)}>
          Add parts
        </Button>
      </section>
    );
  }

  const photoOf = (photoId: string | null) => item.photos.find((photo) => photo.id === photoId && !photo.upload);
  return (
    <section aria-label="Parts" className="mt-2 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <Overline as="h2">Parts</Overline>
        {!editing && (
          <Button variant="quiet" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
            Edit parts
          </Button>
        )}
      </div>
      {editing ? (
        editor
      ) : (
        <ul className="flex max-w-sm flex-col gap-2.5" aria-label="Parts and how many are printed">
          {progress.map((entry) => (
            <PartLine key={entry.part.id} progress={entry} photo={photoOf(entry.part.photoId)} />
          ))}
        </ul>
      )}
      {active && !editing && allPartsPrinted(progress) && (
        <div
          className="bg-basil-soft text-basil-ink flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg py-2 pr-2 pl-3.5"
          data-testid="all-printed"
        >
          <p className="text-small font-semibold">All parts printed</p>
          <Button variant="quiet" size="sm" icon={FinishIcon} disabled={readOnly} onClick={onFinishBuild}>
            Finish the build
          </Button>
        </div>
      )}
    </section>
  );
}
