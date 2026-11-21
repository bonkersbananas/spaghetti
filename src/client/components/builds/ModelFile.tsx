import { fileUrl } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { gramsWords, perPiece, sizePiece, sliceLead } from "@shared/slicing/card.ts";
import { isStlName, slicedName } from "@shared/slicing/files.ts";
import { materialMismatch } from "@shared/slicing/material.ts";
import { changeWords, modelSlicing, slicingAhead, slicingOfSlice } from "@shared/slicing/model.ts";
import { workshopDefaults } from "@shared/slicing/pantry.ts";
import { recipesFor } from "@shared/slicing/recipe.ts";
import {
  type Copies,
  type SlicingSettings,
  sameSlicing,
  slicingFor,
  slicingSummary,
  withNozzle,
} from "@shared/slicing/settings.ts";
import { nameParts, slicedBy } from "@shared/slicing/slicers.ts";
import type { FileSlice, SliceOptions } from "@shared/slicing/types.ts";
import {
  finishesOnComputer,
  nozzleSentence,
  problemSentence,
  sliceSummary,
  standInSentence,
  worthRetrying,
} from "@shared/slicing/words.ts";
import { DEFAULT_PRINTER } from "@shared/spools";
import { formatDuration } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Children,
  type ComponentPropsWithRef,
  isValidElement,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BeforeAfter, type Change } from "@/components/ui/BeforeAfter";
import { Button } from "@/components/ui/Button";
import { Caution } from "@/components/ui/Caution";
import { CopiesRow } from "@/components/ui/CopiesRow";
import { NextIcon, SettingsIcon, UndoIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { MetaList } from "@/components/ui/MetaList";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { type UploadState, useUpload } from "@/lib/big-upload";
import { cn } from "@/lib/cn";
import { siteName } from "@/lib/drafts";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { type AttemptFileView, itemQuery } from "@/lib/items";
import { printerQuery, spoolsQuery } from "@/lib/pantry-queries";
import { fileThumbSrc } from "@/lib/previews";
import { recipesQuery } from "@/lib/recipes-query";
import type { SlicerFileDraft } from "@/lib/slicer-files";
import {
  changeSlicing,
  fetchOriginal,
  figuresOf,
  keepSlice,
  onPhone,
  type SliceChange,
  type SliceJob,
  startSlice,
  undoSlice,
  useSliceChange,
  useSliceJob,
} from "@/lib/slicing/jobs";
import { comparePlates, comparisonKey, dropStaleComparison, usePlateComparison } from "@/lib/slicing/plate-compare";
import { useIsDesktop } from "@/lib/use-media-query";
import { useWarmSoon } from "@/lib/warm-soon";
import { canView3d, type View3d } from "../viewer/ThreeDButton";
import { FileCard, PlateThumb, type SavedFileCardProps } from "./SlicerFile";
import { formatMinutes } from "./settings";

/**
 * A model (.stl or plain .3mf) kept as it is and sliced in the browser (decisions 0046 and 0047): the card of a
 * slicer file, led by the print once it is sliced. While it waits, a pulsing dot; while it slices, a ring and
 * "Slicing 42%"; once sliced, the plate picture with its 3D control, "About 36 min · 10.6 g" with the file's name
 * quieter under it, the sliced file to download, "Sliced by Spaghetti · Fine · PLA Basic orange", and "Slice with…",
 * which opens its settings. Changed, it slices again in the background with the slice there kept in view, then says
 * what changed ("1 h 12 min → 48 min · 14 g → 11 g") with an undo. When it can't be sliced, one short sentence and
 * the one thing that helps ("Scale to 80% and slice").
 */

/** Slicing a model again over the slice there, which stays until the new one is saved. */
export interface Reslicing {
  /** 0-1, or null while it waits its turn. */
  fraction: number | null;
  /** What it slices with: "Fine", "supports where needed". */
  words: string;
}

/** Where a model's slicing is, from its row and this device's job. */
export type ModelState =
  /** On its way to the server; a big file shows how far (`fraction`, 0-1). */
  | { kind: "saving"; fraction?: number }
  /** A big file stopped on the way: one tap sends it again. */
  | { kind: "notSaved"; retry: () => void }
  | { kind: "waiting" }
  | { kind: "slicing"; fraction: number }
  | {
      kind: "sliced";
      slice: FileSlice;
      saved: boolean;
      /** Being sliced again with other settings. */
      again?: Reslicing;
      /** What the last change on this device did. */
      change?: SliceChange;
      /** Settings were changed that it isn't sliced with yet (elsewhere, or the tab closed while slicing). */
      ahead?: boolean;
    }
  | { kind: "failed"; slice: FileSlice; change?: SliceChange }
  | { kind: "unsliced" };

export function modelState(
  file: AttemptFileView,
  job: SliceJob | undefined,
  change?: SliceChange,
  upload?: UploadState,
): ModelState {
  // A big file still on its way, in parts (decision 0048): how far it is, or that it stopped.
  if (file.pending && upload) {
    return upload.failed && upload.retry
      ? { kind: "notSaved", retry: upload.retry }
      : { kind: "saving", fraction: upload.fraction };
  }
  const kept = file.slice;
  if (job?.again && kept?.status === "sliced") {
    const made = slicingOfSlice(kept);
    const fraction = job.status === "waiting" ? null : job.status === "slicing" ? job.fraction : 1;
    return {
      kind: "sliced",
      slice: kept,
      saved: !file.pending,
      again: { fraction, words: changeWords(made, slicingFor(job.chosen, made)) },
    };
  }
  if (job?.status === "waiting") return { kind: "waiting" };
  if (job?.status === "slicing") return { kind: "slicing", fraction: job.fraction };
  const outcome = job?.outcome;
  if (outcome) {
    return outcome.ok
      ? { kind: "sliced", slice: outcome.slice, saved: false }
      : { kind: "failed", slice: outcome.slice };
  }
  if (kept?.status === "sliced") {
    return {
      kind: "sliced",
      slice: kept,
      saved: !file.pending,
      ...(change && !change.failed ? { change } : {}),
      ...(slicingAhead(file) ? { ahead: true } : {}),
    };
  }
  if (kept?.status === "failed") return { kind: "failed", slice: kept, ...(change?.failed ? { change } : {}) };
  return file.pending ? { kind: "saving" } : { kind: "unsliced" };
}

/** The one thing that helps a slice that failed, if there is one: a change of settings, or none to try again. */
export function remedy(slice: FileSlice, phone: boolean): { label: string; change: SliceOptions } | null {
  if (slice.fitCopies && slice.problem === "too-many") {
    return {
      label: slice.fitCopies > 1 ? `Only ${slice.fitCopies} fit: slice ${slice.fitCopies}` : "Only one fits: slice one",
      change: { copies: slice.fitCopies > 1 ? slice.fitCopies : undefined },
    };
  }
  if (slice.fitScale && (slice.problem === "too-big" || slice.problem === "too-tall" || slice.problem === "too-many")) {
    return { label: `Scale to ${slice.fitScale}% and slice`, change: { scale: slice.fitScale } };
  }
  if (slice.problem === "nozzle") return { label: "Slice for the 0.4 mm nozzle", change: { nozzle: 0.4 } };
  if (worthRetrying(slice) && !(slice.problem === "memory" && phone)) return { label: "Try again", change: {} };
  return null;
}

/** The card's words are shared with the shared page's (worker/guest): one place says them. */
export { perPiece, sizePiece, sliceLead };

const grams = gramsWords;

/** "1 h 12 min → 48 min", "14 g → 11 g": a change's figures, where both slices have them. */
export function changeFigures(change: SliceChange): Change[] {
  const { before, after } = change;
  return [
    ...(before.minutes !== undefined && after.minutes !== undefined
      ? [{ label: "time", before: formatMinutes(before.minutes), after: formatMinutes(after.minutes) }]
      : []),
    ...(before.grams !== undefined && after.grams !== undefined
      ? [{ label: "filament", before: grams(before.grams), after: grams(after.grams) }]
      : []),
  ];
}

/** A duration or weight that never breaks across lines: "1 h 48 min", "2.7 g". */
const tight = (figure: string) => figure.replace(/ /g, "\u00A0");

/**
 * What a change did, in words: "Fine: 26 min longer, 0.4 g lighter". `what` is the change itself ("Fine", "supports
 * where needed", from `changeWords`), left out when several things changed. A figure that stayed the same isn't said.
 */
export function changeSentence(change: SliceChange, what?: string): string {
  const { before, after } = change;
  const said: string[] = [];
  if (before.minutes !== undefined && after.minutes !== undefined) {
    const minutes = Math.round(after.minutes - before.minutes);
    if (minutes !== 0) said.push(`${tight(formatMinutes(Math.abs(minutes)))} ${minutes > 0 ? "longer" : "shorter"}`);
  }
  if (before.grams !== undefined && after.grams !== undefined) {
    const delta = Math.round((after.grams - before.grams) * 10) / 10;
    if (delta !== 0) said.push(`${tight(grams(Math.abs(delta)))} ${delta > 0 ? "heavier" : "lighter"}`);
  }
  const effect = said.length ? said.join(", ") : "the same time and filament";
  return what
    ? `${what.charAt(0).toUpperCase()}${what.slice(1)}: ${effect}`
    : `${effect.charAt(0).toUpperCase()}${effect.slice(1)}`;
}

/**
 * "Sliced by Spaghetti · Fine · PLA Basic orange" (or "Sliced by Spaghetti's own slicer · …", decision 0055), where no
 * settings row says the rest.
 */
const slicedPieces = (slice: FileSlice) => [slicedBy(slice, { short: true }), ...sliceSummary(slice.settings)];

/** Words that may wrap, a slicer's name in them kept whole: "our own / slicer" never splits. */
function NamesWhole({ words }: { words: string }) {
  return (
    <span>
      {nameParts(words).map((part) =>
        part.name ? (
          <span key={part.text} className="whitespace-nowrap">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}

/**
 * A story card's "Sliced by Spaghetti" (or by which slicer, when it isn't the usual one), under the file's name, that
 * opens the settings: a quiet button, its glyph in line with the name, taking a text line's height (and 44 px to tap on
 * touch screens).
 */
const SlicedOpener = ({ words, ...props }: ComponentPropsWithRef<"button"> & { words: string }) => (
  <Button
    variant="quiet"
    size="sm"
    icon={SettingsIcon}
    aria-label={`${words}: how to slice it`}
    className="-my-1.5 -ml-3 self-start"
    {...props}
  >
    {words}
  </Button>
);

/**
 * What a model is sliced with, in one tappable row across its card ("Standard · Everyday strength · No supports ·
 * Jade white"), which opens its settings: tall enough for a thumb, and the same in every state, so it keeps its place
 * while the card changes under it.
 */
function SettingsRow({
  summary,
  shortcut,
  className,
  ...props
}: ComponentPropsWithRef<"button"> & { summary: string[]; shortcut?: string[] }) {
  return (
    <button
      type="button"
      aria-label={`Slice with… ${summary.join(", ")}`}
      aria-haspopup="dialog"
      data-keeps-panel
      {...props}
      className={cn(
        "pressable focus-ring bg-ink/4 hover:bg-ink/6 text-small text-ink-soft flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2.5 pl-3 text-left md:max-w-full md:flex-none",
        className,
      )}
    >
      <MetaList className="min-w-0 flex-1">
        {summary.map((piece) => (
          <span key={piece} className="whitespace-nowrap">
            {piece}
          </span>
        ))}
      </MetaList>
      {shortcut && <Kbd keys={shortcut} />}
      <NextIcon size={14} weight="bold" className="text-ink-ghost shrink-0" aria-hidden />
    </button>
  );
}

/** A slice under way, as a progressbar that says where it is (not a live region that reads out every percent). */
function SliceProgress({ fraction, words }: { fraction: number | null; words: string }) {
  const percent = fraction === null ? null : Math.round(fraction * 100);
  // "Slicing 42%", "Slicing with Fine · 42%".
  const text = percent === null ? words : `${words}${words === "Slicing" ? " " : " · "}${percent}%`;
  return (
    <span
      className="text-small text-ink-soft tabular inline-flex items-center gap-1.5"
      role="progressbar"
      aria-label="Slicing"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { "aria-valuenow": percent })}
      aria-valuetext={text}
    >
      {/* Waiting is a pulse (it starts by itself), not a spinner that looks stuck. */}
      {percent === null ? (
        <PulseDot className="m-0.5" />
      ) : (
        <ProgressRing value={percent / 100} className="text-semolina" />
      )}
      {text}
    </span>
  );
}

export interface ModelActions {
  /** Slices it with a change of its settings ("Supports where needed", "Scale to 80% and slice"); absent where it only shows. */
  onSlice?: (change: SliceOptions) => void;
  /** Takes back the last change (its slice comes back). */
  onUndo?: () => void;
  /** Stops slicing it again: the slice there stays, and so do the settings it was made with. */
  onStop?: () => void;
  /** The settings row, as it opens the settings here; absent where they don't open. */
  settings?: ReactNode;
  /**
   * The size of the main nozzle fitted, which the engine prints every slice with (decision 0056): a slice for another
   * size says so, with the way to slice for this one.
   */
  mainNozzle?: number;
  /** The page of the model names another material than the slice uses ("The page says PETG; A1 holds PLA."). */
  materialNote?: { site: string; page: string; material: string } | null;
  /** The nozzle size was the model's own pick: the way back is Undo, or More's Nozzle, not a button of its own. */
  nozzlePicked?: boolean;
}

/** The lines under a model's name: its slicing, and what can be done about it. */
export function ModelStatus({
  state,
  phone,
  line,
  quiet,
  onSlice,
  onUndo,
  onStop,
  settings,
  mainNozzle,
  materialNote,
  nozzlePicked,
}: ModelActions & {
  state: ModelState;
  /** Says it about a phone ("ran out of memory on this phone"). */
  phone: boolean;
  /** Once sliced, how it was ("Sliced by Spaghetti · Fine"), unless the card's meta line says it. */
  line?: ReactNode;
  /** Only where it stands and its undo: the settings below it say the rest (their sheet's result). */
  quiet?: boolean;
}) {
  const {
    lines,
    primary,
    quiet: aside,
  } = statusOf(state, {
    phone,
    line,
    quiet,
    onSlice,
    onUndo,
    onStop,
    mainNozzle,
    materialNote,
    nozzlePicked,
  });
  // The lines change with the state; the actions keep their places. What helps (the filled buttons) sits above the
  // settings row, which every state renders, with a quiet Undo beside it, so the row keeps its place while the card
  // changes under it.
  return (
    <>
      {lines}
      <div className="flex w-full min-w-0 flex-col gap-2 empty:hidden">
        <div className="flex flex-wrap items-center gap-2 empty:hidden">{primary}</div>
        <div className="flex items-center gap-1 empty:hidden">
          {settings}
          {aside}
        </div>
      </div>
    </>
  );
}

/** What a model's status says in each state, what helps there (`primary`) and what only takes a step back (`quiet`). */
function statusOf(
  state: ModelState,
  {
    phone,
    line,
    quiet,
    onSlice,
    onUndo,
    onStop,
    mainNozzle,
    materialNote,
    nozzlePicked,
  }: Omit<ModelActions, "settings"> & {
    phone: boolean;
    line?: ReactNode;
    quiet?: boolean;
  },
): { lines: ReactNode; primary: ReactNode; quiet?: ReactNode } {
  // What helps is the filled button; going back is a quiet one.
  const button = (
    label: ReactNode,
    onClick: () => void,
    icon?: typeof UndoIcon,
    variant: "primary" | "quiet" = "primary",
  ) => (
    <Button
      variant={variant}
      size="sm"
      icon={icon}
      onClick={onClick}
      className={variant === "quiet" ? "shrink-0" : undefined}
    >
      {label}
    </Button>
  );
  switch (state.kind) {
    case "saving": {
      if (state.fraction === undefined) {
        return { lines: <span className="text-small text-ink-faint">Saving the model…</span>, primary: null };
      }
      // A big file in parts (decision 0048): how far it is.
      const percent = Math.round(state.fraction * 100);
      return {
        lines: (
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
        ),
        primary: null,
      };
    }
    case "notSaved":
      return {
        lines: <Caution className="px-0">Didn't finish saving. Your file is still here.</Caution>,
        primary: button("Try again", state.retry),
      };
    case "waiting":
      return { lines: <SliceProgress fraction={null} words="Waiting to slice" />, primary: null };
    case "slicing":
      return { lines: <SliceProgress fraction={state.fraction} words="Slicing" />, primary: null };
    case "sliced": {
      const { again, change, ahead } = state;
      const floating = !quiet && !again && !!state.slice.cautions?.includes("floating");
      // A filament its nozzle has no preset for was sliced as its nearest kin: said once, quietly.
      const standIn = !quiet && !again ? standInSentence(slicingOfSlice(state.slice)) : null;
      // Sliced for a size the main nozzle doesn't have: the file needs that nozzle fitted as the main one to print.
      const sliced = slicingOfSlice(state.slice);
      const elsewhere = !again && mainNozzle !== undefined ? nozzleSentence(sliced, mainNozzle) : null;
      return {
        lines: (
          <>
            {/* Slicing again, over the line that says how it was sliced, which keeps its room (one line or two): the
                card keeps its height, and the settings row stays where it is. */}
            {again ? (
              <span className="grid min-w-0 self-stretch">
                {line && (
                  <span className="invisible col-start-1 row-start-1 min-w-0" aria-hidden>
                    {line}
                  </span>
                )}
                <span className="col-start-1 row-start-1 flex flex-wrap items-center gap-x-2 self-center">
                  <SliceProgress fraction={again.fraction} words={`Slicing with ${again.words}`} />
                  {onStop && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={onStop}
                      aria-label="Stop, and keep the slice there"
                      className="-my-1.5 md:-my-2"
                    >
                      Stop
                    </Button>
                  )}
                </span>
              </span>
            ) : change && onUndo && line ? (
              // What the change did, with its way back at the end of that line: quiet, and apart from the settings row.
              <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2">
                <span className="min-w-0 basis-full md:flex-1 md:basis-0">{line}</span>
                {button("Undo", onUndo, UndoIcon, "quiet")}
              </span>
            ) : (
              line
            )}
            {!again && ahead && <span className="text-small text-ink-soft">Not sliced with its new settings yet.</span>}
            {!again && !ahead && quiet && !change && (
              <span className="text-small text-ink-faint max-md:sr-only">Sliced with these settings.</span>
            )}
            {standIn && <span className="text-small text-ink-soft">{standIn}</span>}
            {floating && <Caution className="px-0">Parts of it float in the air.</Caution>}
            {elsewhere && <Caution className="px-0">{elsewhere}</Caution>}
            {materialNote && !again && !quiet && (
              <span className="text-small text-ink-soft">
                {materialNote.site} says <b className="text-ink font-semibold">{materialNote.page}</b>; this is sliced
                with <b className="text-ink font-semibold">{materialNote.material}</b>.
              </span>
            )}
          </>
        ),
        primary: (
          <>
            {elsewhere &&
              !nozzlePicked &&
              !state.change &&
              onSlice &&
              mainNozzle !== undefined &&
              // Quiet: the filled button is Print it's or the page's one; the way back is also More's Nozzle.
              button(
                `Slice for the ${mainNozzle} mm`,
                () => {
                  const { nozzle, layerHeight } = withNozzle(sliced, mainNozzle);
                  // The main nozzle's size is no pick of the model's own: it follows the main nozzle again.
                  onSlice({ nozzle, layerHeight, nozzlePicked: false });
                },
                undefined,
                "quiet",
              )}
            {floating && onSlice && button("Supports where needed", () => onSlice({ supports: "where-needed" }))}
            {ahead && !again && onSlice && button("Slice it", () => onSlice({}))}
          </>
        ),
        quiet: change && !again && onUndo && !line ? button("Undo", onUndo, UndoIcon, "quiet") : null,
      };
    }
    case "failed": {
      const help = remedy(state.slice, phone);
      return {
        lines: <Caution className="px-0">{problemSentence(state.slice, { phone })}</Caution>,
        primary: onSlice && help ? button(help.label, () => onSlice(help.change)) : null,
        quiet: state.change?.failed && onUndo ? button("Back to the last slice", onUndo, UndoIcon, "quiet") : null,
      };
    }
    case "unsliced":
      return {
        lines: <span className="text-small text-ink-faint">Not sliced yet</span>,
        primary: onSlice ? button("Slice it", () => onSlice({})) : null,
      };
  }
}

/** How a model's settings open from its card: a tap (a sheet on a phone, a panel on desktop). */
export interface SettingsOpener {
  open?: () => void;
  /** The key that opens it, shown on the row on desktop. */
  shortcut?: string[];
  /** What it is sliced with, in words: the row says it. */
  summary: string[];
}

/** The trigger of a model's settings as it opens here: the settings row, or on a story card "Sliced by Spaghetti". */
function opener(details: SettingsOpener | undefined, inline: string | false): ReactNode {
  if (!details) return null;
  const trigger = inline ? (
    <SlicedOpener words={inline} onClick={details.open} />
  ) : (
    <SettingsRow summary={details.summary} shortcut={details.shortcut} onClick={details.open} />
  );
  return trigger;
}

/**
 * A model's card as it shows, from where its slicing is: what the saved card, the attempt sheet's draft and the
 * styleguide share. Once sliced it leads with the print ("About 36 min · 10.6 g"), or what a change did to it
 * ("1 h 12 min → 48 min · 14 g → 11 g"), and the file's name follows, quieter; a model's size says nothing about
 * the print, so it isn't shown. On a story card (`compact`) the attempt's settings line already gives the estimate
 * and weight: the card says only "Sliced by Spaghetti", in its meta line, which opens the settings.
 */
export function ModelCard({
  name,
  state,
  thumbSrc,
  prefill,
  download,
  openFile,
  view3d,
  onRemove,
  draft,
  inSheet,
  details,
  phone,
  compact,
  raised,
  className,
  changed,
  plateNote,
  ...actions
}: Omit<ModelActions, "settings"> & {
  name: string;
  /** What the last change was ("Fine"), to say what it did in words. */
  changed?: string;
  /**
   * The last change was to another plate of the project: a different model on the bed, so no before and after, only
   * the new plate's own figures and this line ("Now plate 3 of 3, the 58 mm bin").
   */
  plateNote?: string;
  state: ModelState;
  thumbSrc?: string;
  /** What the slice said: its estimate and weight lead the card. */
  prefill?: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams">;
  /** The sliced file's address, once it is saved. */
  download?: string;
  /** The kept file: its "Open in Bambu Studio" (a sliced model opens its sliced file). */
  openFile?: AttemptFileView;
  /** Once sliced and saved: the plate picture opens the 3D view. */
  view3d?: View3d;
  onRemove?: () => void;
  /** Not saved yet (a new attempt's sheet): its X removes at once, where a saved model's Remove is in its "…" menu. */
  draft?: boolean;
  /** In a sheet: its menu is a popover on phones too. */
  inSheet?: boolean;
  /** How the settings open; without it they don't, and the line is only words. */
  details?: SettingsOpener;
  phone: boolean;
  compact?: boolean;
  raised?: boolean;
  className?: string;
}) {
  const slice = state.kind === "sliced" ? state.slice : null;
  const change = state.kind === "sliced" ? state.change : undefined;
  const figures = change && !plateNote ? changeFigures(change) : [];
  const again = state.kind === "sliced" && !!state.again;
  const busy = state.kind === "sliced" && (again || !!state.ahead);
  // Under the print: what the last change did, else who sliced it (and why OrcaSlicer's engine did, where it stepped
  // in for ours: decision 0055), with the rest of how where no settings row says it. Balanced, so a sentence that
  // wraps on a phone doesn't leave a word or two alone.
  const line =
    slice && !compact ? (
      <MetaList className="text-small text-ink-faint text-pretty">
        {change && !change.failed
          ? [plateNote ?? changeSentence(change, changed)]
          : details
            ? [
                ...(perPiece(prefill, slice.copies) ? [perPiece(prefill, slice.copies)] : []),
                ...(sizePiece(slice) ? [sizePiece(slice)] : []),
                <NamesWhole key="by" words={slicedBy(slice)} />,
              ]
            : slicedPieces(slice)}
      </MetaList>
    ) : null;
  const quiet = !!slice && compact && !busy && !change && !slice.cautions?.includes("floating");
  return (
    <FileCard
      name={name}
      thumbSrc={thumbSrc}
      lead={slice && !compact && !figures.length ? sliceLead(prefill, slice.copies) : undefined}
      leadNode={slice && !compact && figures.length ? <BeforeAfter changes={figures} size="md" /> : undefined}
      leadStale={again}
      // A story card says only who sliced it (its attempt's line says the rest): a button that opens the settings, on
      // its own line under the name, or the words where they don't open.
      meta={slice && compact && !details ? [slicedBy(slice, { short: true })] : []}
      opener={slice && compact ? opener(details, slicedBy(slice, { short: true })) : null}
      status={
        quiet ? undefined : (
          <>
            {compact && figures.length > 0 && <BeforeAfter changes={figures} />}
            <ModelStatus
              state={state}
              phone={phone}
              line={compact ? null : line}
              settings={compact ? null : opener(details, false)}
              {...actions}
            />
          </>
        )
      }
      download={download}
      openFile={openFile}
      downloadName={slicedName(name)}
      view3d={view3d}
      onRemove={onRemove}
      draft={draft}
      inSheet={inSheet}
      compact={compact}
      raised={raised}
      className={className}
    />
  );
}

/**
 * Where a model's slice stands, at the top of its settings (at the bottom of a phone's sheet, where the thumb is):
 * the plate, its figures or what the last change did, progress while it slices again, and the undo.
 */
export function SliceResult({
  state,
  thumbSrc,
  prefill,
  phone,
  plateNote,
  copies,
  ...actions
}: Omit<ModelActions, "settings"> & {
  state: ModelState;
  /** The copies asked for, and how to change them: a stepper above the figures (a model's, not the styleguide's plain ones). */
  copies?: { value: Copies | undefined; onChange: (next: Copies | undefined) => void };
  /** The last change was to another plate: its own figures, not a before and after (see ModelCard). */
  plateNote?: string;
  thumbSrc?: string;
  prefill?: Pick<AttemptSettings, "estimatedMinutes" | "weightGrams">;
  phone: boolean;
}) {
  const change = state.kind === "sliced" ? state.change : undefined;
  const figures = change && !plateNote ? changeFigures(change) : [];
  const made = state.kind === "sliced" ? state.slice.copies : undefined;
  const lead = state.kind === "sliced" ? sliceLead(prefill, made) : [];
  const each = state.kind === "sliced" ? perPiece(prefill, made) : "";
  // Sliced again, the figures are the slice being replaced: quieter, so they don't read as the new settings'.
  const stale = state.kind === "sliced" && !!state.again;
  // A phone's width puts the button that helps at the right of the row, so the tray stays two rows (the media
  // query, not `phone`, which says what the device can slice).
  const narrow = !useIsDesktop();
  const parts = statusOf(state, { phone, quiet: true, ...actions });
  const helps = isValidElement<{ children?: ReactNode }>(parts.primary)
    ? Children.toArray(parts.primary.props.children).length > 0
    : !!parts.primary;
  return (
    // A tray of its own, apart from the choices: what they give.
    <div className="bg-ink/4 flex flex-col gap-2.5 rounded-lg p-2.5">
      {copies && (
        <CopiesRow
          value={copies.value}
          {...(made ? { made } : {})}
          onChange={copies.onChange}
          disabled={state.kind === "saving"}
        />
      )}
      <div className="flex items-start gap-3">
        <PlateThumb src={thumbSrc} alt="The plate, as sliced" className="size-12" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1 self-center">
          {figures.length > 0 ? (
            <BeforeAfter changes={figures} size="md" />
          ) : lead.length > 0 ? (
            <MetaList className={cn("text-body tabular font-semibold", stale ? "text-ink-faint" : "text-ink")}>
              {lead}
            </MetaList>
          ) : null}
          {each && !stale && <p className="text-small text-ink-soft tabular">{each}</p>}
          {narrow ? (
            <>
              {parts.lines}
              {!helps && parts.quiet}
            </>
          ) : (
            <ModelStatus state={state} phone={phone} quiet {...actions} />
          )}
        </div>
        {/* On a phone the button that helps sits at the right of the same row, so the tray stays two rows. */}
        {narrow && helps && (
          <div className="flex shrink-0 flex-col items-end gap-1 self-center">
            {parts.primary}
            {parts.quiet}
          </div>
        )}
      </div>
    </div>
  );
}

/** What a slice says of its plate, "1 h 20 · 34 g", for the plate picker. */
function plateFigures(prefill: { estimatedMinutes?: number; weightGrams?: number } | undefined): string | undefined {
  if (!prefill?.estimatedMinutes) return undefined;
  return [formatDuration(prefill.estimatedMinutes), prefill.weightGrams ? grams(prefill.weightGrams) : ""]
    .filter(Boolean)
    .join(" · ");
}

/** The settings, loaded the first time they open: a phone's sheet, or a desktop's panel. */
const loadSettings = () => import("./SliceSettings");

const SliceSettingsSheet = lazy(loadSettings);

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
  const change = useSliceChange(file.id);
  const isDesktop = useIsDesktop();
  const [sheet, setSheet] = useState(false);
  const { data: spools = [] } = useQuery(spoolsQuery);
  const { data: printer } = useQuery(printerQuery);
  // Recipes to slice with, once the settings can open (decision 0051).
  const { data: recipes = [] } = useQuery({ ...recipesQuery, enabled: !!owner });
  const setup = printer?.setup ?? DEFAULT_PRINTER;
  // The page this model came from may name a material the slice doesn't use. Only an idea's or build's own files:
  // an attempt's file has the slice it was printed with, and a twist's has no page.
  const pageItemId = owner && !owner.twistId && owner.attemptId === null ? owner.itemId : undefined;
  const { data: pageItem } = useQuery({ ...itemQuery(pageItemId ?? ""), enabled: !!pageItemId });
  const defaults = useMemo(() => workshopDefaults({ spools, setup }), [spools, setup]);
  const upload = useUpload(file.id);
  const state = modelState(file, job, change, upload);
  // While a slice runs here, the settings it slices with: what the card was asked for, whatever a refetch says.
  const kept = modelSlicing(file, defaults);
  const settings = job && Object.keys(job.chosen).length ? slicingFor(job.chosen, kept) : kept;
  const target = owner && !file.pending ? owner : undefined;
  const mismatch =
    file.slice?.status === "sliced"
      ? materialMismatch(pageItem?.draft?.findings?.material, slicingOfSlice(file.slice).filaments)
      : null;
  const materialNote = mismatch
    ? {
        site: pageItem?.draft ? siteName(pageItem.draft) : "The model's page",
        page: mismatch.page,
        material: mismatch.material,
      }
    : null;
  useWarmSoon(() => (target ? loadSettings() : Promise.resolve()));
  // Ordered for the filament it has when they arrive, and kept so: picking a recipe for another filament doesn't
  // move its chip to the front under the finger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ordered once for each list of recipes.
  const offered = useMemo(() => recipesFor(recipes, settings.filaments[0] ?? { material: "" }), [recipes]);

  /** Slices it as it is set up now, over the slice there (kept for an undo) if it has one. */
  const sliceNow = () => {
    if (!target) return;
    // Settings that follow the main nozzle moved on from what is saved: keep them with this slice, so the card isn't
    // left "ahead" of it.
    if (file.slicing && !sameSlicing(file.slicing, settings)) {
      changeSlicing(queryClient, { target, file, next: settings });
      return;
    }
    const again = file.slice?.status === "sliced";
    void startSlice(queryClient, {
      fileId: file.id,
      name: file.name,
      source: () => fetchOriginal(file.id),
      chosen: file.slicing || file.slice ? settings : {},
      target,
      again,
      ...(again ? { before: figuresOf(file.prefill) } : {}),
    });
  };
  const change_ = (next: SlicingSettings) => target && changeSlicing(queryClient, { target, file, next });
  // Back to the usual settings (what a new model gets): kept as an undo toast, since the settings were work.
  const resettable = !!file.slicing && (!sameSlicing(file.slicing, defaults) || !!file.slicing.nozzlePicked);
  const reset = () => {
    const before = settings;
    change_(defaults);
    toast.undo("Back to the usual settings", { onUndo: () => change_(before) });
  };
  const actions: Omit<ModelActions, "settings"> = target
    ? {
        onSlice: (asked) => (Object.keys(asked).length ? change_(slicingFor(asked, settings)) : sliceNow()),
        ...(file.previous ? { onUndo: () => void undoSlice(queryClient, target, file) } : {}),
        onStop: () => keepSlice(queryClient, target, file),
      }
    : {};

  // A phone ran out of memory slicing it: a laptop or desktop that shows it finishes it, by itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per failed slice.
  useEffect(() => {
    if (target && !job && !onPhone() && finishesOnComputer(file.slice)) sliceNow();
  }, [file.slice?.at]);

  const saved = state.kind === "sliced" && state.saved;
  const thumbSrc = file.hasThumb || job?.picture ? fileThumbSrc(file) : undefined;
  const prefill = job?.outcome?.ok && !job.again ? job.outcome.prefill : file.prefill;
  const jobShown = !!job?.outcome?.ok && !job.again;
  const figuresPlate = jobShown
    ? settings.modelPlate
    : file.slice?.status === "sliced"
      ? slicingOfSlice(file.slice).modelPlate
      : undefined;
  // "Slice every plate": the figures of each plate with these settings, for the plate tiles (nothing is saved).
  const comparison = usePlateComparison(file.id, settings);
  // Settings that change under a comparison going stop it, so the model's own slice isn't kept waiting for it.
  const comparisonSettings = comparisonKey(settings);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when what the figures hold for changes.
  useEffect(() => dropStaleComparison(file.id, settings), [file.id, comparisonSettings]);
  const sliceNowFigures =
    file.slice?.status === "sliced" && comparisonKey(slicingOfSlice(file.slice)) === comparisonKey(settings)
      ? { [figuresPlate ?? 1]: figuresOf(prefill) }
      : undefined;
  const panel = target && {
    file: { id: file.id, name: file.name, url: fileUrl(file.id), size: file.size },
    compare: {
      state: comparison,
      run: (plates: number[]) =>
        void comparePlates(queryClient, {
          fileId: file.id,
          name: file.name,
          settings,
          plates,
          ...(sliceNowFigures ? { known: sliceNowFigures } : {}),
        }),
    },
    settings,
    onChange: (next: SlicingSettings) => change_(next),
    spools,
    plates: setup.plates,
    nozzles: setup.nozzles,
    ...(resettable ? { onReset: reset } : {}),
    slice: file.slice,
    scalable: isStlName(file.name),
    recipes: offered,
    ...(saved ? { sliced: fileUrl(file.id, "sliced") } : {}),
    ...(plateFigures(prefill) ? { figures: plateFigures(prefill) } : {}),
    // The figures are of the plate they were made for: the job's, when it is the one shown, else the saved slice's.
    ...(figuresPlate ? { figuresPlate } : {}),
  };
  // Its settings: a sheet on phones, a panel beside the page on desktop (but not over the attempt's sheet).
  const plate = file.slice?.status === "sliced" ? file.slice.plate : undefined;
  // A change of plate is no saving: the new plate's own figures and which it is, not a before and after.
  const plateNote =
    change && file.previous && file.slice?.status === "sliced" && plate
      ? (slicingOfSlice(file.previous.slice).modelPlate ?? 1) !== (slicingOfSlice(file.slice).modelPlate ?? 1)
        ? `Now plate ${plate.index} of ${plate.count} · ${Math.round(plate.height)} mm tall`
        : undefined
      : undefined;
  // A project with several plates says which this is of how many, first (the settings' own "Plate 3" gives way).
  const summary = plate
    ? [
        // The note of a change of plate says it already, for now.
        ...(plateNote ? [] : [`Plate ${plate.index} of ${plate.count}`]),
        ...slicingSummary(settings).filter((piece) => !/^Plate \d/.test(piece)),
      ]
    : slicingSummary(settings);
  const details: SettingsOpener | undefined =
    !panel || inSheet
      ? undefined
      : {
          summary,
          open: () => setSheet(true),
          ...(isDesktop ? { shortcut: shortcutCaps("sliceSettings") } : {}),
        };
  // "S" opens them on desktop, on an idea and on a twist (the first model on the page takes it).
  const openSettings = details?.open && isDesktop ? details.open : undefined;
  useHotkeys({ sliceSettings: openSettings, sliceSettingsTwist: openSettings });
  // What the last change was, to say what it did ("Fine: 26 min longer"): from the slice it replaced.
  const changed =
    change && file.previous && file.slice?.status === "sliced"
      ? (() => {
          const words = changeWords(slicingOfSlice(file.previous.slice), slicingOfSlice(file.slice));
          return words === "the new settings" ? undefined : words;
        })()
      : undefined;
  const card = (
    <ModelCard
      name={file.name}
      state={state}
      thumbSrc={thumbSrc}
      // Until the server has the slice, what this device's job said.
      prefill={prefill}
      // On a phone an idea's card keeps its width for "About 36 min · 10.6 g": the sliced file is in its settings.
      download={saved && (isDesktop || !raised) ? fileUrl(file.id, "sliced") : undefined}
      openFile={file}
      view3d={
        saved && canView3d(file) ? { file, fallbackColors: filaments?.map((f) => f.colorHex), printing } : undefined
      }
      onRemove={onRemove}
      inSheet={inSheet}
      details={details}
      changed={changed}
      plateNote={plateNote}
      phone={!isDesktop}
      compact={compact}
      raised={raised}
      className={className}
      mainNozzle={setup.nozzles.main.diameter}
      materialNote={materialNote}
      nozzlePicked={!!settings.nozzlePicked}
      {...actions}
    />
  );
  return (
    <>
      {card}
      {sheet && panel && (
        <Suspense fallback={null}>
          <SliceSettingsSheet
            open={sheet}
            onOpenChange={setSheet}
            {...panel}
            // The result is its foot: under the thumb on a phone, where the sheet covers the card; on desktop the
            // panel's foot says it too, beside the card, with its Undo and Stop.
            result={
              <SliceResult
                state={state}
                thumbSrc={thumbSrc}
                prefill={prefill}
                phone
                plateNote={plateNote}
                copies={{
                  value: settings.copies,
                  onChange: (next) => change_(slicingFor({ copies: next }, settings)),
                }}
                {...actions}
              />
            }
          />
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
  /** Slices it again with these settings. */
  onSlice?: (chosen: SliceOptions) => void;
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
  // What it was sliced with, so a remedy changes only what it says ("Scale to 80% and slice").
  const made = job?.outcome?.slice.settings.slicing;
  return (
    <ModelCard
      name={file.name}
      state={modelState(file, job)}
      thumbSrc={job?.picture || draft.picture ? fileThumbSrc({ id: draft.id }) : undefined}
      prefill={job?.outcome?.ok ? job.outcome.prefill : undefined}
      onRemove={onRemove}
      draft
      {...(onSlice ? { onSlice: (change: SliceOptions) => onSlice({ ...made, ...change }) } : {})}
      phone={!isDesktop}
    />
  );
}
