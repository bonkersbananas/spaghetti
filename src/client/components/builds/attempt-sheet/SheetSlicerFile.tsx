import { type AttemptFile, fileUrl, MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { filamentFromSpool, spoolFromFilament } from "@shared/spools";
import { applyFileSettings } from "@shared/threemf/prefill.ts";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { SlicerFileIcon } from "@/components/ui/icons";
import { useFilePicker } from "@/components/ui/PhotoTiles";
import { toast } from "@/components/ui/Toast";
import { addSpool } from "@/lib/pantry";
import { spoolsQuery } from "@/lib/pantry-queries";
import { sessionQuery } from "@/lib/queries";
import {
  fileSettings,
  formatBytes,
  linkSpools,
  plateOf,
  readSlicerFile,
  SLICER_ACCEPT,
  type SlicerFileDraft,
  useSlicerDropTarget,
} from "@/lib/slicer-files";
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

  const apply = (draft: SlicerFileDraft, plate: number | null) => {
    const prefill = fileSettings(draft, plate);
    const linked = linkSpools(prefill, spools);
    onSettings(applyFileSettings(latest.current, linked.settings));
    setState({ draft, plate, prefill, unknown: linked.unknown });
    setSettingsKey((key) => key + 1);
    onReady?.(draft, plate, prefill);
    onObjects?.((plateOf(draft, plate)?.objects ?? []).map((object) => object.name));
  };
  const receive = async (file: File) => {
    const draft = await readSlicerFile(file);
    if (!draft) return;
    if (draft.plates.length > 1) setState({ draft, plate: null, prefill: null, unknown: [] });
    else apply(draft, draft.plates[0]?.index ?? null);
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
    clear: () => setState(null),
    addUnknown,
    unknownFilaments,
    settingsKey,
  };
}

/** A file read into a new attempt, before it is logged. */
export function DraftFile({ state, onRemove }: { state: SlicerState; onRemove: () => void }) {
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
          .filter((file) => file.stored)
          .map((file) => (
            <ToggleChip key={file.id} icon={SlicerFileIcon} onClick={() => onUse(file)}>
              <span className="max-w-48 truncate">{file.name}</span>
            </ToggleChip>
          ))}
      </div>
    </div>
  );
}

/** Fetches a kept file's bytes as a File, so the sheet reads it like a dropped one. */
export async function fetchKeptFile(file: AttemptFile): Promise<File | null> {
  try {
    const response = await fetch(fileUrl(file.id), { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return new File([await response.blob()], file.name);
  } catch {
    toast.error("Couldn't get that file", "It needs a connection.");
    return null;
  }
}
