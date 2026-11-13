import engine from "virtual:slicer-engine";
import { fileUrl } from "@shared/api";
import { plateName, shortPreset } from "@shared/attempts";
import { slicedName } from "@shared/slicing/files.ts";
import type { FileSlice, SliceOptions } from "@shared/slicing/types.ts";
import {
  finishesOnComputer,
  printerName,
  problemSentence,
  sliceSummary,
  worthRetrying,
} from "@shared/slicing/words.ts";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Caution } from "@/components/ui/Caution";
import { DownloadIcon, ExternalIcon, ModelIcon, SameAgainIcon, SpaghettiIcon } from "@/components/ui/icons";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { cn } from "@/lib/cn";
import type { AttemptFileView } from "@/lib/items";
import { fileThumbSrc } from "@/lib/previews";
import { formatBytes, type SlicerFileDraft } from "@/lib/slicer-files";
import { onPhone, type SliceJob, startSlice, useSliceJob } from "@/lib/slicing/jobs";
import { useIsDesktop } from "@/lib/use-media-query";
import { canView3d, ThreeDButton } from "../viewer/ThreeDButton";
import { FileCard, type SavedFileCardProps } from "./SlicerFile";
import { formatMinutes } from "./settings";

/**
 * A model (.stl or plain .3mf) kept as it is and sliced in the browser (decision 0046): the card of a slicer file,
 * with its slicing in one quiet line. While it slices, a ring and "Slicing · 42 %"; once sliced, the plate picture
 * with its 3D control, the estimate, the sliced file to download, and "Sliced by Spaghetti · 0.20 mm · PLA", which
 * opens how; when it can't be, one short sentence and the one thing that helps ("Scale to 80 % and slice").
 */

/** Where a model's slicing is, from its row and this device's job. */
export type ModelState =
  | { kind: "saving" }
  | { kind: "waiting" }
  | { kind: "slicing"; fraction: number }
  | { kind: "sliced"; slice: FileSlice; saved: boolean }
  | { kind: "failed"; slice: FileSlice }
  | { kind: "unsliced" };

export function modelState(file: AttemptFileView, job: SliceJob | undefined): ModelState {
  if (job?.status === "waiting") return { kind: "waiting" };
  if (job?.status === "slicing") return { kind: "slicing", fraction: job.fraction };
  const outcome = job?.outcome;
  if (outcome)
    return outcome.ok
      ? { kind: "sliced", slice: outcome.slice, saved: false }
      : { kind: "failed", slice: outcome.slice };
  if (file.slice?.status === "sliced") return { kind: "sliced", slice: file.slice, saved: !file.pending };
  if (file.slice?.status === "failed") return { kind: "failed", slice: file.slice };
  return file.pending ? { kind: "saving" } : { kind: "unsliced" };
}

/** The options a slice was made with, to make it again. */
const optionsOf = (slice: FileSlice | null | undefined): SliceOptions => ({
  ...(slice?.settings.supports ? { supports: true } : {}),
  ...(slice && slice.settings.scale !== 100 ? { scale: slice.settings.scale } : {}),
});

/** The one thing that helps a slice that failed, if there is one. */
function remedy(slice: FileSlice): { label: string; options: SliceOptions } | null {
  if (slice.fitScale && (slice.problem === "too-big" || slice.problem === "too-tall" || slice.problem === "too-many")) {
    return { label: `Scale to ${slice.fitScale} % and slice`, options: { ...optionsOf(slice), scale: slice.fitScale } };
  }
  if (worthRetrying(slice) && !(slice.problem === "memory" && slice.device === "phone")) {
    return { label: "Try again", options: optionsOf(slice) };
  }
  return null;
}

/** The one thing to do about a model's slicing, under its line ("Scale to 80 % and slice"). */
function LineAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

/** "Sliced by Spaghetti · 0.20 mm · PLA": how it was sliced, in one line that opens the details. */
const SlicedLine = ({ slice, ...props }: { slice: FileSlice } & React.ComponentPropsWithRef<"button">) => (
  <button
    type="button"
    {...props}
    className="pressable focus-ring text-small text-ink-faint hover:text-ink -mx-1 inline-flex max-w-full items-center gap-1.5 self-start rounded-sm px-1 text-left"
  >
    <SpaghettiIcon size={14} className="shrink-0" aria-hidden />
    <span className="truncate">{["Sliced by Spaghetti", ...sliceSummary(slice.settings)].join(" · ")}</span>
  </button>
);

/** The lines under a model's name: its slicing, and what can be done about it. */
export function ModelStatus({
  state,
  phone,
  onSlice,
  details,
}: {
  state: ModelState;
  /** Says it about a phone ("ran out of memory on this phone"). */
  phone: boolean;
  /** Slicing it (again) from here; absent where the card only shows. */
  onSlice?: (options: SliceOptions) => void;
  /** How the "Sliced by Spaghetti" line opens its details: wrapped (a popover's trigger), or a tap (a sheet). */
  details?: { wrap?: (line: ReactNode) => ReactNode; open?: () => void };
}) {
  switch (state.kind) {
    case "saving":
      return <span className="text-caption text-ink-faint">Saving the model…</span>;
    case "waiting":
    case "slicing": {
      const percent = state.kind === "slicing" ? Math.round(state.fraction * 100) : null;
      return (
        <span className="text-small text-ink-soft tabular inline-flex items-center gap-1.5" role="status">
          <ProgressRing value={percent === null ? null : percent / 100} className="text-tomato" />
          {percent === null ? "Waiting to slice" : `Slicing · ${percent} %`}
        </span>
      );
    }
    case "sliced": {
      const line = <SlicedLine slice={state.slice} onClick={details?.open} />;
      return (
        <>
          {details?.wrap ? details.wrap(line) : line}
          {state.slice.cautions?.includes("floating") && (
            <>
              <Caution className="px-0">Parts of it float in the air.</Caution>
              {onSlice && (
                <LineAction onClick={() => onSlice({ ...optionsOf(state.slice), supports: true })}>
                  Slice with supports
                </LineAction>
              )}
            </>
          )}
        </>
      );
    }
    case "failed": {
      const help = remedy(state.slice);
      return (
        <>
          <Caution className="px-0">{problemSentence(state.slice, { phone })}</Caution>
          {onSlice && help && <LineAction onClick={() => onSlice(help.options)}>{help.label}</LineAction>}
        </>
      );
    }
    case "unsliced":
      return (
        <>
          <span className="text-caption text-ink-faint">Not sliced yet</span>
          {onSlice && <LineAction onClick={() => onSlice({})}>Slice it</LineAction>}
        </>
      );
  }
}

/** What the card's meta line says: the estimate, weight and sliced file's size, or the model's size. */
export function modelMeta(file: AttemptFileView, state: ModelState): string[] {
  if (state.kind !== "sliced") return [formatBytes(file.size)];
  const estimate = state.saved ? file.prefill.estimatedMinutes : undefined;
  const grams = state.saved ? file.prefill.weightGrams : undefined;
  return [
    estimate !== undefined ? `est. ${formatMinutes(estimate)}` : "",
    grams !== undefined ? `${grams.toLocaleString("en", { maximumFractionDigits: 1 })} g` : "",
    formatBytes(state.slice.bytes ?? file.size),
  ].filter(Boolean);
}

/** The original's bytes, for slicing a saved model again. */
async function fetchOriginal(fileId: string): Promise<Blob> {
  const response = await fetch(fileUrl(fileId), { credentials: "same-origin" });
  if (!response.ok) throw new Error(String(response.status));
  return response.blob();
}

/** The details on a phone: a sheet, loaded when first opened. */
const SliceDetailsSheet = lazy(() => import("./SliceDetailsSheet"));

export default function ModelFileCard({
  file,
  owner,
  filaments,
  printing,
  onRemove,
  compact,
  raised,
  className,
}: SavedFileCardProps) {
  const queryClient = useQueryClient();
  const job = useSliceJob(file.id);
  const isDesktop = useIsDesktop();
  const [sheet, setSheet] = useState(false);
  const state = modelState(file, job);
  const slice = owner
    ? (options: SliceOptions) =>
        void startSlice(queryClient, {
          fileId: file.id,
          name: file.name,
          source: () => fetchOriginal(file.id),
          options,
          target: owner,
        })
    : undefined;

  // A phone ran out of memory slicing it: a laptop or desktop that shows it finishes it, by itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per failed slice.
  useEffect(() => {
    if (slice && !job && !file.pending && !onPhone() && finishesOnComputer(file.slice)) slice(optionsOf(file.slice));
  }, [file.slice?.at]);

  const saved = state.kind === "sliced" && state.saved;
  // How it was sliced: a popover beside the line on desktop, a sheet on phones.
  const details =
    state.kind !== "sliced"
      ? undefined
      : isDesktop
        ? {
            wrap: (line: ReactNode) => (
              <Popover trigger={line} label="How it was sliced" side="bottom" align="start" className="w-96">
                <SliceDetails file={file} slice={state.slice} onSlice={slice} heading close />
              </Popover>
            ),
          }
        : { open: () => setSheet(true) };
  return (
    <>
      <FileCard
        name={file.name}
        thumbSrc={file.hasThumb || job?.picture ? fileThumbSrc(file.id) : undefined}
        icon={ModelIcon}
        meta={modelMeta(file, state)}
        status={<ModelStatus state={state} phone={!isDesktop} onSlice={slice} details={details} />}
        download={saved ? fileUrl(file.id, "sliced") : undefined}
        downloadName={slicedName(file.name)}
        plateOverlay={
          saved && canView3d(file) ? (
            <ThreeDButton file={file} fallbackColors={filaments?.map((f) => f.colorHex)} printing={printing} />
          ) : undefined
        }
        onRemove={onRemove}
        compact={compact}
        raised={raised}
        className={className}
      />
      {sheet && state.kind === "sliced" && (
        <Suspense fallback={null}>
          <SliceDetailsSheet open={sheet} onOpenChange={setSheet} name={file.name}>
            <SliceDetails
              file={file}
              slice={state.slice}
              size="md"
              onSlice={
                slice &&
                ((options) => {
                  setSheet(false);
                  slice(options);
                })
              }
            />
          </SliceDetailsSheet>
        </Suspense>
      )}
    </>
  );
}

/** A model read into a new attempt's sheet, before it is logged: its slicing on this device. */
export function ModelDraftCard({
  draft,
  onRemove,
  onSlice,
}: {
  draft: SlicerFileDraft;
  onRemove: () => void;
  onSlice?: (options: SliceOptions) => void;
}) {
  const job = useSliceJob(draft.id);
  const isDesktop = useIsDesktop();
  const file: AttemptFileView = {
    id: draft.id,
    name: draft.file.name,
    size: draft.file.size,
    stored: true,
    hasThumb: false,
    plate: 1,
    plateCount: 1,
    slicer: null,
    prefill: {},
    objects: [],
    kind: "model",
    slice: null,
    createdAt: 0,
  };
  const state = modelState(file, job);
  const prefill = job?.outcome?.ok ? job.outcome.prefill : undefined;
  return (
    <FileCard
      name={file.name}
      thumbSrc={job?.picture || draft.picture ? fileThumbSrc(draft.id) : undefined}
      icon={ModelIcon}
      meta={
        state.kind === "sliced" && prefill
          ? [
              prefill.estimatedMinutes !== undefined ? `est. ${formatMinutes(prefill.estimatedMinutes)}` : "",
              prefill.weightGrams !== undefined
                ? `${prefill.weightGrams.toLocaleString("en", { maximumFractionDigits: 1 })} g`
                : "",
              formatBytes(state.slice.bytes ?? file.size),
            ].filter(Boolean)
          : [formatBytes(file.size)]
      }
      status={<ModelStatus state={state} phone={!isDesktop} onSlice={onSlice} />}
      onRemove={onRemove}
    />
  );
}

/** One fact of how it was sliced: what it is, and its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-faint w-20 shrink-0">{label}</dt>
      <dd className="text-ink min-w-0">{children}</dd>
    </div>
  );
}

/**
 * How a model was sliced: the printer, process, filaments, plate, supports and scale, whose engine (with a link to
 * its source, as its licence asks), the original to download, and "Slice again".
 */
export function SliceDetails({
  file,
  slice,
  onSlice,
  heading,
  close,
  size = "sm",
}: {
  file: Pick<AttemptFileView, "id" | "name">;
  slice: FileSlice;
  onSlice?: (options: SliceOptions) => void;
  /** Its own title ("Sliced by Spaghetti"), where nothing above says it (a popover; a sheet has its title). */
  heading?: boolean;
  /** In a popover: the actions close it. */
  close?: boolean;
  /** Its buttons: small in a popover, a thumb's size in a phone's sheet. */
  size?: "sm" | "md";
}) {
  const { settings } = slice;
  const again = onSlice && (
    <Button variant="secondary" size={size} icon={SameAgainIcon} onClick={() => onSlice(optionsOf(slice))}>
      Slice again
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {heading && <p className="text-body text-ink font-semibold">Sliced by Spaghetti</p>}
        <p className="text-small text-ink-soft">
          In the browser, with OrcaSlicer's own engine and its presets for the {printerName(settings.machine)}.
        </p>
      </div>
      <dl className="text-small flex flex-col gap-1.5">
        <Fact label="Printer">{settings.machine.replace(/\s+([\d.]+)\s*nozzle$/i, ", $1 mm nozzle")}</Fact>
        <Fact label="Process">{shortPreset(settings.process)}</Fact>
        <Fact label={settings.filaments.length > 1 ? "Filaments" : "Filament"}>
          {settings.filaments.map(shortPreset).join(", ")}
        </Fact>
        <Fact label="Plate">{plateName(settings.bedType)}</Fact>
        <Fact label="Supports">{settings.supports ? "Tree supports, where needed" : "Off"}</Fact>
        {settings.scale !== 100 && <Fact label="Size">{settings.scale} % of the model</Fact>}
        {settings.project && (
          <Fact label="Settings">
            {settings.project === "own" ? "The file's own" : "The file's layer height, walls, infill and supports"}
          </Fact>
        )}
      </dl>
      <p className="text-caption text-ink-faint">
        OrcaSlicer {settings.orca || engine.orca.version} is free software under the AGPL.{" "}
        {engine.source && (
          <a
            href={engine.source}
            target="_blank"
            rel="noreferrer"
            className="focus-ring text-ink-soft hover:text-ink inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2"
          >
            Its source
            <ExternalIcon size={12} aria-hidden />
          </a>
        )}
      </p>
      <div className={cn("flex flex-wrap items-center gap-2")}>
        <a
          href={fileUrl(file.id)}
          download={file.name}
          className={cn(
            "pressable focus-ring bg-cream text-ink shadow-key hover:shadow-key-hover inline-flex items-center font-semibold",
            size === "sm" ? "text-small h-8 gap-1.5 rounded-sm px-3" : "text-body h-11 gap-2 rounded-md px-4",
          )}
        >
          <DownloadIcon size={size === "sm" ? 16 : 20} weight="bold" aria-hidden />
          Download the original
        </a>
        {again && (close ? <PopoverClose asChild>{again}</PopoverClose> : again)}
      </div>
    </div>
  );
}
