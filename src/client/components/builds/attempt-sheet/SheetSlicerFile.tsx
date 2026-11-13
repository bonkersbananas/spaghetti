import { type AttemptFile, fileUrl, MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { keepOwnFilaments } from "@shared/slicing/filaments.ts";
import { slicedName } from "@shared/slicing/files.ts";
import type { SliceOptions } from "@shared/slicing/types.ts";
import { filamentFromSpool, spoolFromFilament } from "@shared/spools";
import { applyFileSettings, printablePlates } from "@shared/threemf/prefill.ts";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { SlicerFileIcon } from "@/components/ui/icons";
import { useFilePicker } from "@/components/ui/PhotoTiles";
import { toast } from "@/components/ui/Toast";
import { addSpool } from "@/lib/pantry";
import { spoolsQuery } from "@/lib/pantry-queries";
import { sessionQuery } from "@/lib/queries";
import { SLICER_ACCEPT, useSlicerDropTarget } from "@/lib/slicer-drop";
import {
  fileSettings,
  formatBytes,
  linkSpools,
  plateOf,
  readSlicerFile,
  type SlicerFileDraft,
} from "@/lib/slicer-files";
import type { SliceOutcome } from "@/lib/slicing/slice-model";
import { useIsDesktop } from "@/lib/use-media-query";
import { AddSlicerFile, FileCard, PlateChooser, UnknownFilaments, usePlateThumbUrl } from "../SlicerFile";
import { formatMinutes } from "../settings";

/** A slicer file being read into the sheet: which plate, what it said, which filaments aren't in the pantry. */
export interface SlicerState {
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
export function useSlicerFile({
  open,
  settings,
  onSettings,
  onReady,
  onObjects,
  incomingFile,
}: {
  open: boolean;
  settings: AttemptSettings;
  onSettings: (settings: AttemptSettings) => void;
  onReady?: (draft: SlicerFileDraft, plate: number | null, prefill: AttemptSettings) => void;
  /** The object names on the plate that was read: the build's parts it prints. */
  onObjects?: (objects: string[]) => void;
  incomingFile?: { file: File; key: number } | null;
}) {
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const { data: spools = [] } = useQuery(spoolsQuery);
  const [state, setState] = useState<SlicerState | null>(null);
  const [settingsKey, setSettingsKey] = useState(0);
  const latest = useRef(settings);
  latest.current = settings;

  /**
   * Lays what a file says over the attempt. `given` is a sliced model's own reading (lib/slicing), whose filaments may
   * be stand-ins: the attempt then keeps its own.
   */
  const apply = (draft: SlicerFileDraft, plate: number | null, ready = true, given?: AttemptSettings) => {
    const prefill = given ?? fileSettings(draft, plate);
    const linked = linkSpools(prefill, spools);
    const model = draft.kind === "model" || given !== undefined;
    onSettings(
      applyFileSettings(latest.current, model ? keepOwnFilaments(latest.current, linked.settings) : linked.settings),
    );
    // A stand-in filament (no colour: nobody chose it) isn't a spool to add to the pantry.
    const unknown = model ? linked.unknown.filter((index) => !!prefill.filaments?.[index]?.colorHex) : linked.unknown;
    setState({ draft, plate, prefill, unknown });
    setSettingsKey((key) => key + 1);
    if (ready) onReady?.(draft, plate, prefill);
    onObjects?.((plateOf(draft, plate)?.objects ?? []).map((object) => object.name));
  };
  const current = useRef<SlicerState | null>(null);
  current.current = state;
  /** Slices a model in the sheet, in the background (lib/slicing/jobs.ts); it goes on where the attempt goes. */
  const sliceDraft = async (draft: SlicerFileDraft, options: SliceOptions = {}) => {
    const jobs = await import("@/lib/slicing/jobs");
    return jobs.startSlice(queryClient, {
      fileId: draft.id,
      name: draft.file.name,
      source: draft.file,
      options,
      target: null,
    });
  };
  /** Once sliced, the model fills in the attempt as a sliced file would (if the sheet still holds it). */
  const follow = async (draft: SlicerFileDraft, done: Promise<SliceOutcome | null>) => {
    const outcome = await done;
    if (current.current?.draft.id !== draft.id || !outcome) return;
    const picture = outcome.png ?? undefined;
    if (!outcome.ok) {
      setState((now) => (now?.draft.id === draft.id ? { ...now, draft: { ...now.draft, picture } } : now));
      return;
    }
    const { readThreeMf } = await import("@shared/threemf/read.ts");
    const result = readThreeMf(new Uint8Array(await outcome.sliced.arrayBuffer()));
    if (current.current?.draft.id !== draft.id) return;
    apply({ ...draft, result, plates: printablePlates(result), picture }, 1, false, outcome.prefill);
  };
  /**
   * A model (.stl or plain .3mf): it is sliced here and fills in the attempt once it is; the settings stay as they
   * are until then. An attempt that exists keeps the model at once (onReady), and its slice follows it.
   */
  const receiveModel = async (draft: SlicerFileDraft) => {
    setState({ draft, plate: 1, prefill: null, unknown: [] });
    const done = await sliceDraft(draft);
    onReady?.(draft, 1, {});
    await follow(draft, Promise.resolve(done));
  };
  /** Slices the sheet's model again ("Slice with supports", "Scale to 80% and slice"). */
  const reslice = async (options: SliceOptions) => {
    const draft = current.current?.draft;
    if (draft?.kind !== "model") return;
    await follow(draft, sliceDraft(draft, options));
  };
  /** `sliced`: what Spaghetti's slice of a kept model said, for its .gcode.3mf (fetchKeptFile). */
  const receive = async (file: File, sliced?: AttemptSettings) => {
    const draft = await readSlicerFile(file);
    if (!draft) return;
    if (draft.kind === "model") void receiveModel(draft);
    else if (draft.plates.length > 1) setState({ draft, plate: null, prefill: null, unknown: [] });
    else apply(draft, draft.plates[0]?.index ?? null, true, sliced);
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
    take: receive,
    choosePlate: (plate: number) => state && apply(state.draft, plate),
    /** Forgets the file in the sheet (it was saved, or the sheet starts afresh); a model's slicing goes on. */
    clear: () => setState(null),
    reslice: (options: SliceOptions) => void reslice(options),
    /** Takes the file off: a model's slicing stops. */
    remove: () => {
      const draft = state?.draft;
      if (draft?.kind === "model") void import("@/lib/slicing/jobs").then(({ cancelSlice }) => cancelSlice(draft.id));
      setState(null);
    },
    addUnknown,
    unknownFilaments,
    settingsKey,
  };
}

/** A model's card in the sheet: its code (and the slicing jobs') loads with the first model. */
const ModelDraftCard = lazy(() => import("../ModelFile").then((m) => ({ default: m.ModelDraftCard })));

/** A file read into a new attempt, before it is logged. */
export function DraftFile({
  state,
  onRemove,
  onSlice,
}: {
  state: SlicerState;
  onRemove: () => void;
  /** A model: slice it again, differently. */
  onSlice?: (options: SliceOptions) => void;
}) {
  if (state.draft.kind === "model") {
    return (
      <Suspense fallback={<FileCard name={state.draft.file.name} meta={[formatBytes(state.draft.file.size)]} />}>
        <ModelDraftCard draft={state.draft} onRemove={onRemove} onSlice={onSlice} />
      </Suspense>
    );
  }
  return <SlicerDraftFile state={state} onRemove={onRemove} />;
}

function SlicerDraftFile({ state, onRemove }: { state: SlicerState; onRemove: () => void }) {
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

/** The sheet's slicer file: a plate to pick, the file's card (and filaments to add to the pantry), or the well to add one. */
export function SlicerFileSection({
  state,
  card,
  onPick,
  onPlate,
  onAddUnknown,
  unknown,
  ideaFiles = [],
  onUseIdeaFile,
}: {
  /** Files kept with the idea: offered to the first attempt, one tap each. */
  ideaFiles?: AttemptFile[];
  onUseIdeaFile?: (file: AttemptFile) => void;
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
  return (
    <div className="flex flex-col gap-2">
      <AddSlicerFile onClick={onPick} desktop={isDesktop} />
      {ideaFiles.length > 0 && onUseIdeaFile && <IdeaFileOffer files={ideaFiles} onUse={onUseIdeaFile} />}
    </div>
  );
}

/** "From the idea": the files kept with the idea, to print this attempt from (the file's bytes come from the server). */
function IdeaFileOffer({ files, onUse }: { files: AttemptFile[]; onUse: (file: AttemptFile) => void }) {
  return (
    <div className="flex flex-col gap-1.5 px-0.5">
      <span className="text-small text-ink-faint">Kept with the idea:</span>
      <div className="flex flex-wrap gap-2">
        {files
          .filter((file) => file.stored && (file.kind !== "model" || file.slice?.status === "sliced"))
          .map((file) => (
            <ToggleChip key={file.id} icon={SlicerFileIcon} onClick={() => onUse(file)}>
              <span className="max-w-48 truncate">{file.name}</span>
            </ToggleChip>
          ))}
      </div>
    </div>
  );
}

/**
 * Fetches a kept file's bytes as a File, so the sheet reads it like a dropped one. A model gives its sliced
 * .gcode.3mf: that is what an attempt prints from.
 */
export async function fetchKeptFile(file: AttemptFile): Promise<File | null> {
  const model = file.kind === "model";
  try {
    const response = await fetch(fileUrl(file.id, model ? "sliced" : "file"), { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return new File([await response.blob()], model ? slicedName(file.name) : file.name);
  } catch {
    toast.error("Couldn't get that file", "It needs a connection.");
    return null;
  }
}
