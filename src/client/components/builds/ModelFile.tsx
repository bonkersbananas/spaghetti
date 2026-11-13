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
import { Button, ButtonLink } from "@/components/ui/Button";
import { Caution } from "@/components/ui/Caution";
import { DownloadIcon, ExternalIcon, InfoIcon, SameAgainIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { QuietRowContent, quietRowClass } from "@/components/ui/QuietRow";
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
 * with its slicing in one quiet line. While it slices, a ring and "Slicing 42%"; once sliced, the plate picture
 * with its 3D control, the estimate, the sliced file to download, and "Sliced by Spaghetti · 0.20 mm · PLA", a quiet
 * row that opens how; when it can't be, one short sentence and the one thing that helps ("Scale to 80% and slice").
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
    return { label: `Scale to ${slice.fitScale}% and slice`, options: { ...optionsOf(slice), scale: slice.fitScale } };
  }
  if (worthRetrying(slice) && !(slice.problem === "memory" && slice.device === "phone")) {
    return { label: "Try again", options: optionsOf(slice) };
  }
  return null;
}

/** The one thing to do about a model's slicing, under its line ("Scale to 80% and slice"). */
function LineAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

/** "Sliced by Spaghetti · 0.20 mm · PLA", or only "Sliced by Spaghetti" where the attempt's own line says the rest. */
const slicedPieces = (slice: FileSlice, short?: boolean) =>
  short ? ["Sliced by Spaghetti"] : ["Sliced by Spaghetti", ...sliceSummary(slice.settings)];

/**
 * How it was sliced, as a quiet row that opens the details (44 px tall on phones). Without `onClick` or a wrapping
 * popover it is only words: a card in a sheet has nowhere to open them.
 */
const SlicedLine = ({
  slice,
  short,
  ...props
}: { slice: FileSlice; short?: boolean } & React.ComponentPropsWithRef<"button">) => {
  const pieces = slicedPieces(slice, short);
  return (
    <button
      type="button"
      aria-label={`${pieces.join(", ")}: how it was sliced`}
      {...props}
      className={cn(quietRowClass, "w-fit max-w-full self-start text-left md:min-h-0 md:py-1")}
    >
      <QuietRowContent icon={InfoIcon}>
        <MetaList>{pieces}</MetaList>
      </QuietRowContent>
    </button>
  );
};

/** The same words where they open nothing. */
const SlicedWords = ({ slice, short }: { slice: FileSlice; short?: boolean }) => (
  <MetaList className="text-small text-ink-faint">{slicedPieces(slice, short)}</MetaList>
);

/** The lines under a model's name: its slicing, and what can be done about it. */
export function ModelStatus({
  state,
  phone,
  onSlice,
  details,
  short,
}: {
  state: ModelState;
  /** Says it about a phone ("ran out of memory on this phone"). */
  phone: boolean;
  /** Slicing it (again) from here; absent where the card only shows. */
  onSlice?: (options: SliceOptions) => void;
  /**
   * How the "Sliced by Spaghetti" line opens its details: wrapped (a popover's trigger), or a tap (a sheet). Without
   * it the line is only words.
   */
  details?: { wrap?: (line: ReactNode) => ReactNode; open?: () => void };
  /** Only "Sliced by Spaghetti": on a story card, whose settings line already says the layer height and material. */
  short?: boolean;
}) {
  switch (state.kind) {
    case "saving":
      return <span className="text-small text-ink-faint">Saving the model…</span>;
    case "waiting":
    case "slicing": {
      const percent = state.kind === "slicing" ? Math.round(state.fraction * 100) : null;
      const words = percent === null ? "Waiting to slice" : `Slicing ${percent}%`;
      // A progressbar that says where it is, not a live region that reads out every percent.
      return (
        <span
          className="text-small text-ink-soft tabular inline-flex items-center gap-1.5"
          role="progressbar"
          aria-label="Slicing"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { "aria-valuenow": percent })}
          aria-valuetext={words}
        >
          <ProgressRing value={percent === null ? null : percent / 100} className="text-semolina" />
          {words}
        </span>
      );
    }
    case "sliced": {
      const line =
        details?.open || details?.wrap ? (
          <SlicedLine slice={state.slice} short={short} onClick={details.open} />
        ) : (
          <SlicedWords slice={state.slice} short={short} />
        );
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
          <span className="text-small text-ink-faint">Not sliced yet</span>
          {onSlice && <LineAction onClick={() => onSlice({})}>Slice it</LineAction>}
        </>
      );
  }
}

/**
 * What the card's meta line says: the estimate, weight and sliced file's size, or the model's size. `compact` (a
 * story card) leaves the weight to the attempt's own settings line, as a slicer file's compact card does.
 */
export function modelMeta(file: AttemptFileView, state: ModelState, compact?: boolean): string[] {
  if (state.kind !== "sliced") return [formatBytes(file.size)];
  const estimate = state.saved ? file.prefill.estimatedMinutes : undefined;
  const grams = state.saved && !compact ? file.prefill.weightGrams : undefined;
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
  inSheet,
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
  // How it was sliced: a popover beside the line on desktop, a sheet on phones (but not over the attempt's sheet).
  const details =
    state.kind !== "sliced" || (inSheet && !isDesktop)
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
        meta={modelMeta(file, state, compact)}
        status={<ModelStatus state={state} phone={!isDesktop} onSlice={slice} details={details} short={compact} />}
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
    <Button
      variant="secondary"
      size={size}
      icon={SameAgainIcon}
      fullWidth={size === "md"}
      onClick={() => onSlice(optionsOf(slice))}
    >
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
        {settings.scale !== 100 && <Fact label="Size">{settings.scale}% of the model</Fact>}
        {settings.project && (
          <Fact label="Settings">
            {settings.project === "own" ? "The file's own" : "The file's layer height, walls, infill and supports"}
          </Fact>
        )}
      </dl>
      <p className="text-caption text-ink-faint">
        OrcaSlicer is free software under the AGPL.{" "}
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
      {/* Side by side in a popover; in a phone's sheet, one under the other at the thumb's width. */}
      <div className={size === "sm" ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-2"}>
        <ButtonLink
          href={fileUrl(file.id)}
          download={file.name}
          size={size}
          icon={DownloadIcon}
          fullWidth={size === "md"}
        >
          Download the original
        </ButtonLink>
        {again && (close ? <PopoverClose asChild>{again}</PopoverClose> : again)}
      </div>
    </div>
  );
}
