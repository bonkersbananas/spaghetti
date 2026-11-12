import { fileUrl, MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { AttemptFilament } from "@shared/attempts";
import type { Plate } from "@shared/threemf/types.ts";
import { type ReactNode, useMemo } from "react";
import { IconButton } from "@/components/ui/Button";
import { CloseIcon, DownloadIcon, PlusIcon, SlicerFileIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Swatch } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";
import { useOnline } from "@/lib/connection";
import type { AttemptFileView } from "@/lib/items";
import { fileThumbSrc } from "@/lib/previews";
import { formatBytes, plateThumb, type SlicerFileDraft } from "@/lib/slicer-files";
import { useObjectUrl } from "@/lib/use-object-url";
import { canView3d, type PrintingAttempt, ThreeDButton } from "../viewer/ThreeDButton";
import { formatMinutes } from "./settings";

/** A plate's picture on a quiet well (slicers render them on transparent ground). */
export function PlateThumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  return (
    <span
      className={cn(
        "bg-ink/5 shadow-well flex shrink-0 items-center justify-center overflow-hidden rounded-md",
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt} className="size-full object-contain" draggable={false} />
      ) : (
        <SlicerFileIcon size={22} className="text-ink-faint" aria-hidden />
      )}
    </span>
  );
}

interface FileCardProps {
  name: string;
  thumbSrc?: string;
  /** Short pieces: "plate 2 of 3", "est. 1 h 30 min", "4.2 MB". */
  meta: string[];
  /** A line under it, such as "Too big to keep". */
  note?: string;
  download?: string;
  /** Sits on the plate picture's corner (the "3D" control). */
  plateOverlay?: ReactNode;
  onRemove?: () => void;
  /** On a story card: no box of its own, a smaller plate, and only what the card's other lines don't say. */
  compact?: boolean;
  className?: string;
}

/** A slicer file on an attempt: the plate that was meant to print, the file's name, and a way to get it back. */
export function FileCard({
  name,
  thumbSrc,
  meta,
  note,
  download,
  plateOverlay,
  onRemove,
  compact,
  className,
}: FileCardProps) {
  return (
    <div className={cn("flex items-center gap-3", compact ? "-mr-1.5" : "bg-ink/3 rounded-lg p-2.5 pr-1.5", className)}>
      <span className="relative shrink-0">
        <PlateThumb src={thumbSrc} alt="The plate, as sliced" className={compact ? "size-12" : "size-16"} />
        {plateOverlay}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-small text-ink truncate font-semibold" title={name}>
          {name}
        </span>
        <MetaList className="text-small text-ink-faint tabular">
          {meta.map((piece) => (
            <span key={piece} className="whitespace-nowrap">
              {piece}
            </span>
          ))}
        </MetaList>
        {note && <span className="text-caption text-ink-faint">{note}</span>}
      </div>
      {download && (
        <a
          href={download}
          download={name}
          className="pressable focus-ring text-ink-soft hover:bg-ink/5 hover:text-ink flex size-11 shrink-0 items-center justify-center rounded-md md:size-9"
          aria-label={`Download ${name}`}
          title="Download the file"
        >
          <DownloadIcon size={20} aria-hidden />
        </a>
      )}
      {onRemove && <IconButton icon={CloseIcon} label="Remove the slicer file" size="sm" onClick={onRemove} />}
    </div>
  );
}

/** What a file that's on an attempt (or on its way) says about itself. */
export function savedFileMeta(file: AttemptFileView): { meta: string[]; note?: string } {
  const meta = [
    file.plateCount > 1 ? `plate ${file.plate} of ${file.plateCount}` : "",
    file.prefill.estimatedMinutes !== undefined ? `est. ${formatMinutes(file.prefill.estimatedMinutes)}` : "",
    formatBytes(file.size),
  ].filter(Boolean);
  const note = !file.stored
    ? `Over ${formatBytes(MAX_SLICER_FILE_BYTES)}, so only what it said is kept.`
    : file.pending
      ? "Saving the file…"
      : undefined;
  return { meta, ...(note ? { note } : {}) };
}

/** The card for a file on a saved attempt. */
export function SavedFileCard({
  file,
  filaments,
  printing,
  onRemove,
  compact,
  className,
}: {
  file: AttemptFileView;
  compact?: boolean;
  /** The attempt, while it prints: the 3D view then follows the printer. */
  printing?: PrintingAttempt;
  /** The attempt's filaments: their colours stand in for any the file doesn't give. */
  filaments?: AttemptFilament[];
  onRemove?: () => void;
  className?: string;
}) {
  const { meta, note } = savedFileMeta(file);
  return (
    <FileCard
      name={file.name}
      thumbSrc={file.hasThumb ? fileThumbSrc(file.id) : undefined}
      meta={meta}
      note={note}
      download={file.stored && !file.pending ? fileUrl(file.id) : undefined}
      plateOverlay={
        canView3d(file) ? (
          <ThreeDButton file={file} fallbackColors={filaments?.map((f) => f.colorHex)} printing={printing} />
        ) : undefined
      }
      onRemove={onRemove}
      compact={compact}
      className={className}
    />
  );
}

/** An object URL for a plate's picture, revoked when it is no longer shown. */
export function usePlateThumbUrl(plate: Plate | undefined): string | undefined {
  return useObjectUrl(useMemo(() => plateThumb(plate), [plate]));
}

/** For a file with several plates: which one was printed, in one tap. */
export function PlateChooser({ draft, onPick }: { draft: SlicerFileDraft; onPick: (plate: number) => void }) {
  return (
    <section aria-label="Which plate?" className="bg-semolina-soft/50 flex flex-col gap-3 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <span className="text-small text-ink font-semibold">Which plate did you print?</span>
        <span className="text-caption text-ink-faint truncate">{draft.file.name}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
        {draft.plates.map((plate) => (
          <PlateButton key={plate.index} draft={draft} index={plate.index} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

function PlateButton({
  draft,
  index,
  onPick,
}: {
  draft: SlicerFileDraft;
  index: number;
  onPick: (plate: number) => void;
}) {
  const plate = draft.plates.find((p) => p.index === index);
  const src = usePlateThumbUrl(plate);
  const minutes = plate?.predictedSeconds !== undefined ? Math.round(plate.predictedSeconds / 60) : undefined;
  return (
    <button
      type="button"
      onClick={() => onPick(index)}
      className="pressable focus-ring bg-cream shadow-soft hover:shadow-raised flex min-w-0 flex-col gap-1.5 rounded-md p-1.5 text-left"
    >
      <PlateThumb src={src} alt="" className="aspect-square w-full" />
      <span className="flex min-w-0 flex-col px-1 pb-0.5">
        <span className="text-small text-ink truncate font-semibold">{plate?.name || `Plate ${index}`}</span>
        <span className="text-caption text-ink-faint tabular truncate">
          {minutes !== undefined ? formatMinutes(Math.max(1, minutes)) : plate?.name ? `Plate ${index}` : " "}
        </span>
      </span>
    </button>
  );
}

/** Filaments from the file that aren't in the pantry yet: one tap adds each. */
export function UnknownFilaments({
  filaments,
  onAdd,
}: {
  filaments: Array<{ index: number; filament: AttemptFilament }>;
  onAdd: (index: number) => void;
}) {
  // Adding a spool needs the server; offline the filaments stay as the file said.
  const online = useOnline();
  if (!filaments.length || !online) return null;
  return (
    <div className="flex flex-col gap-2 px-0.5">
      <span className="text-small text-ink-faint">
        {filaments.length === 1 ? "Not in the pantry yet:" : "Not in the pantry yet, from the file:"}
      </span>
      <div className="flex flex-wrap gap-2">
        {filaments.map(({ index, filament }) => (
          <button
            key={index}
            type="button"
            onClick={() => onAdd(index)}
            className="pressable focus-ring bg-cream text-small text-ink-soft shadow-soft hover:text-ink rounded-pill inline-flex h-9 items-center gap-2 pr-3.5 pl-2.5 font-semibold md:h-8"
          >
            <Swatch color={filament.colorHex} />
            {[filament.type, filament.profile && filament.profile !== filament.type ? `(${filament.profile})` : ""]
              .filter(Boolean)
              .join(" ")}
            <PlusIcon size={14} weight="bold" className="text-ink-faint" aria-hidden />
            <span className="sr-only">Add to the pantry</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The well to add a slicer file: tap to pick one (phones), or drop it anywhere on the sheet. */
export function AddSlicerFile({ onClick, desktop }: { onClick: () => void; desktop: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable focus-ring bg-ink/4 text-ink-soft shadow-well hover:bg-ink/6 hover:text-ink flex h-14 w-full items-center gap-3 rounded-lg px-4 text-left"
    >
      <SlicerFileIcon size={22} aria-hidden />
      <span className="text-small flex-1 font-semibold">Add the slicer file</span>
      <span className="text-caption text-ink-faint">{desktop ? "or drop a .3mf here" : ".3mf or .gcode.3mf"}</span>
    </button>
  );
}
