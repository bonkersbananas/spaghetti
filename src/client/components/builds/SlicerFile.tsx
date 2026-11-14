import { fileUrl, MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { AttemptFilament } from "@shared/attempts";
import type { Plate } from "@shared/threemf/types.ts";
import { lazy, type ReactNode, Suspense, useMemo } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Caution } from "@/components/ui/Caution";
import { CloseIcon, DownloadIcon, PlusIcon, SlicerFileIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Swatch } from "@/components/ui/Swatch";
import { tooBigForPhone, useUpload } from "@/lib/big-upload";
import { cn } from "@/lib/cn";
import { useOnline } from "@/lib/connection";
import type { AttemptFileView } from "@/lib/items";
import { fileThumbSrc } from "@/lib/previews";
import { formatBytes, plateThumb, type SlicerFileDraft } from "@/lib/slicer-files";
import type { SliceTarget } from "@/lib/slicing/jobs";
import { useObjectUrl } from "@/lib/use-object-url";
import { canView3d, type PrintingAttempt, ThreeDButton, type View3d } from "../viewer/ThreeDButton";
import { OpenInStudio } from "./OpenInStudio";
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
  /**
   * The card's first line, in the name's place, when the print says more than the file's name: a sliced model's
   * "About 36 min · 10.6 g". The name follows it, quieter.
   */
  lead?: string[];
  /** A lead of its own, in the same place: what a change did to a sliced model ("1 h 12 min → 48 min"). */
  leadNode?: ReactNode;
  /** The lead is the slice being replaced (sliced again with other settings): quieter, so it isn't read as the new one's. */
  leadStale?: boolean;
  /** Short pieces: "plate 2 of 3", "est. 1 h 30 min", "4.2 MB"; or a line of its own (a story card's "Sliced by Spaghetti"). */
  meta: ReactNode[];
  /**
   * A control under the name, on a line of its own (a story card's "Sliced by Spaghetti", which opens the model's
   * settings): apart from the meta line, whose frame would clip its touch target and focus ring.
   */
  opener?: ReactNode;
  /** A line under it, such as "Too big to keep". */
  note?: string;
  /** Lines under the meta in place of the note: a model's slicing, with its actions (ModelFile.tsx). */
  status?: ReactNode;
  download?: string;
  /** The kept file, where it can be opened in Bambu Studio (a button under the text, on computers only). */
  openFile?: Parameters<typeof OpenInStudio>[0]["file"];
  /** The download's file name, when it isn't the card's name (a model's sliced file). */
  downloadName?: string;
  /** Where the file can be shown in 3D: the whole plate picture opens the view, a "3D" pill on its corner. */
  view3d?: View3d;
  onRemove?: () => void;
  /** On a story card: no box of its own and a smaller plate, its download in line with the attempt's menu above it. */
  compact?: boolean;
  /**
   * A raised card (like a model's link card, the column's width) with a 96 px plate and its actions in the top corner;
   * on desktop Remove shows on hover.
   */
  raised?: boolean;
  className?: string;
}

/** A slicer file on an attempt: the plate that was meant to print, the file's name, and a way to get it back. */
export function FileCard({
  name,
  thumbSrc,
  lead,
  leadNode,
  leadStale,
  meta,
  opener,
  note,
  status,
  download,
  openFile,
  downloadName,
  view3d,
  onRemove,
  compact,
  raised,
  className,
}: FileCardProps) {
  const box = compact
    ? "-mr-1.5"
    : raised
      ? "group bg-cream shadow-soft max-w-content rounded-lg p-3 pr-1.5"
      : "bg-ink/3 rounded-lg p-2.5 pr-1.5";
  // A story card's plate is small: the well's padding keeps the whole model clear of its rounded edge.
  const picture = (
    <PlateThumb
      src={thumbSrc}
      alt="The plate, as sliced"
      className={compact ? "size-12 p-1" : raised ? "size-24" : "size-16"}
    />
  );
  const thumb = (
    <span className={cn("relative shrink-0", !!status && "md:row-span-2 md:self-start")}>
      {view3d ? (
        <ThreeDButton {...view3d} glyph={compact}>
          {picture}
        </ThreeDButton>
      ) : (
        picture
      )}
    </span>
  );
  const named = !!leadNode || !!lead?.length;
  const text = (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", !!status && "md:self-end")}>
      {named ? (
        <>
          {leadNode ?? (
            <MetaList className={cn("text-body tabular font-semibold", leadStale ? "text-ink-faint" : "text-ink")}>
              {lead?.map((piece) => (
                <span key={piece} className="whitespace-nowrap">
                  {piece}
                </span>
              ))}
            </MetaList>
          )}
          <span className="text-small text-ink-faint truncate" title={name}>
            {name}
          </span>
        </>
      ) : (
        <span className="text-small text-ink truncate font-semibold" title={name}>
          {name}
        </span>
      )}
      {meta.length > 0 && (
        <MetaList className="text-small text-ink-faint tabular">
          {meta.map((piece, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are their place in the line.
            <span key={index} className="whitespace-nowrap">
              {piece}
            </span>
          ))}
        </MetaList>
      )}
      {opener}
      {note && <span className="text-caption text-ink-faint">{note}</span>}
    </div>
  );
  const actions = (
    <>
      {openFile && !compact && <OpenInStudio icon file={openFile} />}
      {download && (
        <a
          href={download}
          download={downloadName ?? name}
          className={cn(
            "pressable focus-ring text-ink-soft hover:bg-ink/5 hover:text-ink flex shrink-0 items-center justify-center",
            // On a story card it is the attempt menu's size, so the two line up down the card's edge.
            compact ? "touch-target relative size-8 rounded-sm" : "size-11 rounded-md md:size-9",
          )}
          aria-label={`Download ${downloadName ?? name}`}
          title={downloadName ? "Download the sliced file" : "Download the file"}
        >
          <DownloadIcon size={20} aria-hidden />
        </a>
      )}
      {onRemove && (
        <IconButton
          icon={CloseIcon}
          label="Remove the slicer file"
          size="sm"
          onClick={onRemove}
          className={raised ? "md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100" : undefined}
        />
      )}
    </>
  );
  if (!status) {
    return (
      <div className={cn("flex items-center gap-3", box, className)}>
        {thumb}
        {text}
        <div className={cn("flex items-center", raised && "self-start")}>{actions}</div>
      </div>
    );
  }
  // With a status (a model's slicing): under the text on desktop; on phones a row of its own across the card, where
  // its line and its action have room. A raised card's actions sit in its top corner, so on desktop its status also
  // takes the room under them; it keeps as far from the card's edge as the card's other sides (the corner's padding is
  // tighter), and a long settings row wraps there.
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 md:gap-y-1",
        box,
        className,
      )}
    >
      {thumb}
      {text}
      <div className={cn("flex items-center", raised ? "self-start" : "md:row-span-2")}>{actions}</div>
      <div
        className={cn(
          "col-span-3 flex min-w-0 flex-col items-start gap-1.5 md:col-start-2 md:self-start",
          raised ? "mr-1.5 md:col-span-2" : "md:col-span-1",
        )}
      >
        {status}
      </div>
    </div>
  );
}

/**
 * What a file that's on an attempt (or on its way) says about itself. On a story card (`compact`) the attempt's
 * settings line already gives the estimate: the card doesn't say it twice.
 */
export function savedFileMeta(file: AttemptFileView, compact?: boolean): { meta: string[]; note?: string } {
  const meta = [
    file.plateCount > 1 ? `plate ${file.plate} of ${file.plateCount}` : "",
    file.prefill.estimatedMinutes !== undefined && !compact
      ? `est. ${formatMinutes(file.prefill.estimatedMinutes)}`
      : "",
    formatBytes(file.size),
  ].filter(Boolean);
  const note = !file.stored
    ? `Over ${formatBytes(MAX_SLICER_FILE_BYTES)}, so only what it said is kept.`
    : file.pending
      ? "Saving the file…"
      : file.kind !== "model" && tooBigForPhone(file.size)
        ? "Too big for the 3D view on a phone. A laptop will show it."
        : undefined;
  return { meta, ...(note ? { note } : {}) };
}

export interface SavedFileCardProps {
  file: AttemptFileView;
  compact?: boolean;
  raised?: boolean;
  /** The attempt, while it prints: the 3D view then follows the printer. */
  printing?: PrintingAttempt;
  /** The attempt's filaments: their colours stand in for any the file doesn't give. */
  filaments?: AttemptFilament[];
  onRemove?: () => void;
  /** Where the file is kept, so a model can be sliced (again) from its card; without it the card only shows. */
  owner?: SliceTarget;
  /** In the attempt's sheet: on phones a model's details don't open a second sheet over it. */
  inSheet?: boolean;
  className?: string;
}

/** A model's card: its code (and the slicing jobs') loads when the first model is shown. */
const ModelFileCard = lazy(() => import("./ModelFile"));

/** The card for a kept file: a slicer's file as it is, or a model with its slicing. */
export function SavedFileCard(props: SavedFileCardProps) {
  if (props.file.kind === "model") {
    return (
      <Suspense
        fallback={
          <FileCard
            name={props.file.name}
            meta={[]}
            compact={props.compact}
            raised={props.raised}
            className={props.className}
          />
        }
      >
        <ModelFileCard {...props} />
      </Suspense>
    );
  }
  return <SlicerFileCard {...props} />;
}

/** A big file's upload on its card: the percent as it goes, or that it stopped, with one tap to send it again. */
function UploadLine({ upload }: { upload: NonNullable<ReturnType<typeof useUpload>> }) {
  if (upload.failed) {
    return (
      <>
        <Caution className="px-0">Didn't finish saving. Your file is still here.</Caution>
        {upload.retry && (
          <Button variant="secondary" size="sm" onClick={upload.retry}>
            Try again
          </Button>
        )}
      </>
    );
  }
  const percent = Math.round(upload.fraction * 100);
  return (
    <span
      className="text-small text-ink-soft tabular inline-flex items-center gap-1.5"
      role="progressbar"
      aria-label="Saving the file"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`Saving ${percent}%`}
    >
      <ProgressRing value={upload.fraction} className="text-semolina" />
      Saving {percent}%
    </span>
  );
}

function SlicerFileCard({ file, filaments, printing, onRemove, compact, raised, className }: SavedFileCardProps) {
  const { meta, note } = savedFileMeta(file, compact);
  const upload = useUpload(file.id);
  const going = file.pending && upload ? upload : undefined;
  return (
    <FileCard
      name={file.name}
      thumbSrc={file.hasThumb ? fileThumbSrc(file) : undefined}
      meta={meta}
      note={going ? undefined : note}
      status={going ? <UploadLine upload={going} /> : undefined}
      download={file.stored && !file.pending ? fileUrl(file.id) : undefined}
      openFile={file}
      view3d={canView3d(file) ? { file, fallbackColors: filaments?.map((f) => f.colorHex), printing } : undefined}
      onRemove={onRemove}
      compact={compact}
      raised={raised}
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
      <span className="text-caption text-ink-faint">{desktop ? "or drop one here" : ".gcode.3mf, .3mf or .stl"}</span>
    </button>
  );
}
