import engine from "virtual:slicer-engine";
import { fileUrl } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { plateName, shortPreset } from "@shared/attempts";
import { slicedName } from "@shared/slicing/files.ts";
import type { FileSlice, SliceOptions, SliceSettings } from "@shared/slicing/types.ts";
import {
  finishesOnComputer,
  layersDetail,
  printerName,
  problemSentence,
  sliceSummary,
  worthRetrying,
} from "@shared/slicing/words.ts";
import { useQueryClient } from "@tanstack/react-query";
import { type ComponentPropsWithRef, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Caution } from "@/components/ui/Caution";
import { DownloadIcon, ExternalIcon, InfoIcon, SameAgainIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { PulseDot } from "@/components/ui/PulseDot";
import { QuietRowContent, quietRowClass } from "@/components/ui/QuietRow";
import { type UploadState, useUpload } from "@/lib/big-upload";
import { cn } from "@/lib/cn";
import type { AttemptFileView } from "@/lib/items";
import { fileThumbSrc } from "@/lib/previews";
import type { SlicerFileDraft } from "@/lib/slicer-files";
import { onPhone, type SliceJob, startSlice, useSliceJob } from "@/lib/slicing/jobs";
import { useIsDesktop } from "@/lib/use-media-query";
import { canView3d, ThreeDButton } from "../viewer/ThreeDButton";
import { FileCard, type SavedFileCardProps } from "./SlicerFile";
import { formatMinutes } from "./settings";

/**
 * A model (.stl or plain .3mf) kept as it is and sliced in the browser (decision 0046): the card of a slicer file,
 * led by the print once it is sliced. While it waits, a pulsing dot; while it slices, a ring and "Slicing 42%"; once
 * sliced, the plate picture with its 3D control, "About 36 min · 10.6 g" with the file's name quieter under it, the
 * sliced file to download, and "Sliced by Spaghetti · PLA · 0.2 mm layers", a quiet row that opens how; when it
 * can't be, one short sentence and the one thing that helps ("Scale to 80% and slice").
 */

/** Where a model's slicing is, from its row and this device's job. */
export type ModelState =
  /** On its way to the server; a big file shows how far (`fraction`, 0-1). */
  | { kind: "saving"; fraction?: number }
  /** A big file stopped on the way: one tap sends it again. */
  | { kind: "notSaved"; retry: () => void }
  | { kind: "waiting" }
  | { kind: "slicing"; fraction: number }
  | { kind: "sliced"; slice: FileSlice; saved: boolean }
  | { kind: "failed"; slice: FileSlice }
  | { kind: "unsliced" };

export function modelState(file: AttemptFileView, job: SliceJob | undefined, upload?: UploadState): ModelState {
  if (file.pending && upload) {
    return upload.failed && upload.retry
      ? { kind: "notSaved", retry: upload.retry }
      : { kind: "saving", fraction: upload.fraction };
  }
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

/** "Sliced by Spaghetti · PLA · 0.2 mm layers", or only "Sliced by Spaghetti" where the attempt's own line says the rest. */
const slicedPieces = (slice: FileSlice, short?: boolean) =>
  short ? ["Sliced by Spaghetti"] : ["Sliced by Spaghetti", ...sliceSummary(slice.settings)];

/**
 * How it was sliced, as a quiet row that opens the details (44 px tall on phones); `inline`, only "Sliced by
 * Spaghetti" as a piece of a story card's meta line (its hit area still 44 px on touch screens).
 */
const SlicedLine = ({
  slice,
  inline,
  ...props
}: { slice: FileSlice; inline?: boolean } & ComponentPropsWithRef<"button">) => {
  const pieces = slicedPieces(slice, inline);
  return (
    <button
      type="button"
      aria-label={`${pieces.join(", ")}: how it was sliced`}
      {...props}
      className={
        inline
          ? "focus-ring pressable hover:text-ink duration-fast touch-target relative -mx-1 inline-flex items-center gap-1 rounded-sm px-1 transition-colors"
          : cn(quietRowClass, "w-fit max-w-full self-start text-left md:min-h-0 md:py-1")
      }
    >
      {inline ? (
        <>
          <InfoIcon size={14} className="shrink-0" aria-hidden />
          {pieces[0]}
        </>
      ) : (
        <QuietRowContent icon={InfoIcon}>
          <MetaList>{pieces}</MetaList>
        </QuietRowContent>
      )}
    </button>
  );
};

/** The same words where they open nothing (a card in a sheet has nowhere to open them). */
const SlicedWords = ({ slice, short }: { slice: FileSlice; short?: boolean }) =>
  short ? "Sliced by Spaghetti" : <MetaList className="text-small text-ink-faint">{slicedPieces(slice)}</MetaList>;

/** "About 36 min · 10.6 g": what a sliced model's card leads with. */
export function sliceLead(prefill: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams"> | undefined): string[] {
  return [
    prefill?.estimatedMinutes !== undefined ? `About ${formatMinutes(prefill.estimatedMinutes)}` : "",
    prefill?.weightGrams !== undefined
      ? `${prefill.weightGrams.toLocaleString("en", { maximumFractionDigits: 1 })} g`
      : "",
  ].filter(Boolean);
}

/** The lines under a model's name: its slicing, and what can be done about it. */
export function ModelStatus({
  state,
  phone,
  onSlice,
  line,
}: {
  state: ModelState;
  /** Says it about a phone ("ran out of memory on this phone"). */
  phone: boolean;
  /** Slicing it (again) from here; absent where the card only shows. */
  onSlice?: (options: SliceOptions) => void;
  /** Once sliced, how it was ("Sliced by Spaghetti"), unless the card's meta line says it. */
  line?: ReactNode;
}) {
  switch (state.kind) {
    case "saving": {
      if (state.fraction === undefined) return <span className="text-small text-ink-faint">Saving the model…</span>;
      const percent = Math.round(state.fraction * 100);
      return (
        <span
          className="text-small text-ink-soft tabular inline-flex items-center gap-1.5"
          role="progressbar"
          aria-label="Saving the model"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`Saving ${percent}%`}
        >
          <ProgressRing value={state.fraction} className="text-semolina" />
          Saving {percent}%
        </span>
      );
    }
    case "notSaved":
      return (
        <>
          <Caution className="px-0">Didn't finish saving. Your file is still here.</Caution>
          <LineAction onClick={state.retry}>Try again</LineAction>
        </>
      );
    case "waiting":
    case "slicing": {
      const percent = state.kind === "slicing" ? Math.round(state.fraction * 100) : null;
      const words = percent === null ? "Waiting to slice" : `Slicing ${percent}%`;
      // A progressbar that says where it is, not a live region that reads out every percent. Waiting is a pulse
      // (it will start by itself), not a spinner that looks stuck.
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
          {percent === null ? (
            <PulseDot className="m-0.5" />
          ) : (
            <ProgressRing value={percent / 100} className="text-semolina" />
          )}
          {words}
        </span>
      );
    }
    case "sliced": {
      return (
        <>
          {line}
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

/** How a model's "Sliced by Spaghetti" line opens its details: wrapped (a popover's trigger), or a tap (a sheet). */
export interface DetailsOpener {
  wrap?: (line: ReactNode) => ReactNode;
  open?: () => void;
}

/**
 * A model's card as it shows, from where its slicing is: what the saved card, the attempt sheet's draft and the
 * styleguide share. Once sliced it leads with the print ("About 36 min · 10.6 g") and the file's name follows,
 * quieter; a model's size says nothing about the print, so it isn't shown. On a story card (`compact`) the attempt's
 * settings line already gives the estimate and weight: the card says only "Sliced by Spaghetti", in its meta line.
 */
export function ModelCard({
  name,
  state,
  thumbSrc,
  prefill,
  download,
  plateOverlay,
  onRemove,
  onSlice,
  details,
  phone,
  compact,
  raised,
  className,
}: {
  name: string;
  state: ModelState;
  thumbSrc?: string;
  /** What the slice said: its estimate and weight lead the card. */
  prefill?: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams">;
  /** The sliced file's address, once it is saved. */
  download?: string;
  plateOverlay?: ReactNode;
  onRemove?: () => void;
  onSlice?: (options: SliceOptions) => void;
  /** Without it the "Sliced by Spaghetti" line is only words. */
  details?: DetailsOpener;
  phone: boolean;
  compact?: boolean;
  raised?: boolean;
  className?: string;
}) {
  const slice = state.kind === "sliced" ? state.slice : null;
  const opens = !!(details?.open || details?.wrap);
  const words = slice ? (
    opens ? (
      <SlicedLine slice={slice} inline={compact} onClick={details?.open} />
    ) : (
      <SlicedWords slice={slice} short={compact} />
    )
  ) : null;
  const line = words && details?.wrap ? details.wrap(words) : words;
  const quiet = !!slice && compact && !slice.cautions?.includes("floating");
  return (
    <FileCard
      name={name}
      thumbSrc={thumbSrc}
      lead={slice && !compact ? sliceLead(prefill) : undefined}
      meta={compact && line ? [line] : []}
      status={
        quiet ? undefined : <ModelStatus state={state} phone={phone} onSlice={onSlice} line={compact ? null : line} />
      }
      download={download}
      downloadName={slicedName(name)}
      plateOverlay={plateOverlay}
      onRemove={onRemove}
      compact={compact}
      raised={raised}
      className={className}
    />
  );
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
  const upload = useUpload(file.id);
  const state = modelState(file, job, upload);
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
  const details: DetailsOpener | undefined =
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
      <ModelCard
        name={file.name}
        state={state}
        thumbSrc={file.hasThumb || job?.picture ? fileThumbSrc(file.id) : undefined}
        // Until the server has the slice, what this device's job said.
        prefill={job?.outcome?.ok ? job.outcome.prefill : file.prefill}
        // On a phone an idea's card keeps its width for "About 36 min · 10.6 g": the sliced file is in its details.
        download={saved && (isDesktop || !raised) ? fileUrl(file.id, "sliced") : undefined}
        plateOverlay={
          saved && canView3d(file) ? (
            <ThreeDButton
              file={file}
              fallbackColors={filaments?.map((f) => f.colorHex)}
              printing={printing}
              glyph={compact}
            />
          ) : undefined
        }
        onRemove={onRemove}
        onSlice={slice}
        details={details}
        phone={!isDesktop}
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
              sliced={saved && raised ? fileUrl(file.id, "sliced") : undefined}
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
  return (
    <ModelCard
      name={file.name}
      state={modelState(file, job)}
      thumbSrc={job?.picture || draft.picture ? fileThumbSrc(draft.id) : undefined}
      prefill={job?.outcome?.ok ? job.outcome.prefill : undefined}
      onRemove={onRemove}
      onSlice={onSlice}
      phone={!isDesktop}
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

/** "Sliced here with the X2D's usual settings.": what a slice's details say first, in plain words. */
export function slicedWith(settings: Pick<SliceSettings, "machine" | "project">): string {
  const printer = printerName(settings.machine);
  if (settings.project === "own") return "Sliced here with the file's own settings.";
  if (settings.project === "some") {
    return `Sliced here with the ${printer}'s usual settings, and the file's layer height, walls, infill and supports.`;
  }
  return `Sliced here with the ${printer}'s usual settings.`;
}

/**
 * How a model was sliced: in plain words first, then the printer, layers, filaments, plate, supports and scale, the
 * engine's licence (with a link to its source, as the licence asks), the original to download, and "Slice again".
 */
export function SliceDetails({
  file,
  slice,
  sliced,
  onSlice,
  heading,
  close,
  size = "sm",
}: {
  file: Pick<AttemptFileView, "id" | "name">;
  slice: FileSlice;
  /** The sliced file's address, where the card has no download of its own (an idea's card on a phone). */
  sliced?: string;
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
        <p className="text-small text-ink-soft">{slicedWith(settings)}</p>
      </div>
      <dl className="text-small flex flex-col gap-1.5">
        <Fact label="Printer">{settings.machine.replace(/\s+([\d.]+)\s*nozzle$/i, ", $1 mm nozzle")}</Fact>
        <Fact label="Layers">{layersDetail(settings)}</Fact>
        <Fact label={settings.filaments.length > 1 ? "Filaments" : "Filament"}>
          {settings.filaments.map(shortPreset).join(", ")}
        </Fact>
        <Fact label="Plate">{plateName(settings.bedType)}</Fact>
        <Fact label="Supports">{settings.supports ? "Tree supports, where needed" : "Off"}</Fact>
        {settings.scale !== 100 && <Fact label="Size">{settings.scale}% of the model</Fact>}
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
        {sliced && (
          <ButtonLink
            href={sliced}
            download={slicedName(file.name)}
            size={size}
            icon={DownloadIcon}
            fullWidth={size === "md"}
          >
            Download the sliced file
          </ButtonLink>
        )}
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
