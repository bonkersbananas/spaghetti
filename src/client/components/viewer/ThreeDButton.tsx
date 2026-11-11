import { fileUrl } from "@shared/api";
import { LIVE_FRESH_MS } from "@shared/print-progress";
import { useQuery } from "@tanstack/react-query";
import { type ComponentType, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CubeIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { AttemptFileView } from "@/lib/items";
import { printerQuery } from "@/lib/pantry-queries";
import { useNow } from "@/lib/use-now";

/** The viewer's code (three.js and the scene) loads on first use, or when a finger comes near the control. */
const importViewer = () => import("./PrintViewer");

type ViewerComponent = ComponentType<import("./PrintViewer").PrintViewerProps>;

/**
 * Loads the viewer's code and shows it. The chunk isn't precached, so offline (or in a tab left open across a deploy)
 * the import can fail: that says so here instead of throwing the whole page into its error screen.
 */
function LoadedViewer(props: import("./PrintViewer").PrintViewerProps) {
  const [Viewer, setViewer] = useState<ViewerComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger
  useEffect(() => {
    let live = true;
    setFailed(false);
    importViewer().then(
      (module) => live && setViewer(() => module.default),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  if (Viewer) return <Viewer {...props} />;
  if (failed) {
    return (
      <div className="sg-stage flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-body text-ink-soft max-w-xs">
          The 3D view needs a connection to load. Try again once you're online.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  return <div className="sg-stage size-full" />;
}

/** A sliced file (one with G-code) that the server kept can be opened in 3D. */
export function canView3d(file: AttemptFileView | undefined): file is AttemptFileView {
  return (
    !!file &&
    file.stored &&
    !file.pending &&
    (/\.gcode\.3mf$/i.test(file.name) || file.prefill.estimatedMinutes !== undefined)
  );
}

/** The attempt a file belongs to while it prints: what the viewer needs to follow it. */
export interface PrintingAttempt {
  id: string;
  startedAt: number;
  estimatedMinutes?: number;
}

/** A quiet "3D" pill on the plate picture. Opens the viewer; its code is fetched as a finger or the pointer nears it. */
export function ThreeDButton({
  file,
  fallbackColors,
  printing,
  className,
}: {
  file: AttemptFileView;
  fallbackColors?: (string | null | undefined)[];
  /** Set while the attempt is printing: the viewer shows the layers printed so far solid and the rest as a ghost. */
  printing?: PrintingAttempt;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onPointerEnter={() => void importViewer()}
        onPointerDown={() => void importViewer()}
        onFocus={() => void importViewer()}
        onClick={() => setOpen(true)}
        aria-label={`See ${file.name} in 3D`}
        className={cn(
          "pressable focus-ring bg-veil text-on-veil text-caption touch-target absolute right-1 bottom-1 flex items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 font-semibold",
          className,
        )}
      >
        <CubeIcon size={12} weight="bold" aria-hidden />
        3D
      </button>
      {open && (
        <ViewerSheet
          open={open}
          onOpenChange={setOpen}
          file={file}
          fallbackColors={fallbackColors}
          printing={printing}
        />
      )}
    </>
  );
}

export function ViewerSheet({
  open,
  onOpenChange,
  file,
  fallbackColors,
  printing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: AttemptFileView;
  fallbackColors?: (string | null | undefined)[];
  printing?: PrintingAttempt;
}) {
  // The printer's own layer while the bridge reports it for this attempt and the report is fresh; nothing otherwise.
  // (Read here, in the viewer's own code, so nothing is added to the shared progress helpers every screen loads.)
  const now = useNow();
  const report = useQuery({ ...printerQuery, enabled: !!printing }).data?.bridge?.progress;
  const live =
    printing && report?.attemptId === printing.id && now - report.at <= LIVE_FRESH_MS && report.layer
      ? { layer: report.layer, totalLayers: report.totalLayers }
      : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="3D view"
      description={
        live
          ? `Printing now · layer ${live.layer}${live.totalLayers ? ` of ${live.totalLayers}` : ""}`
          : file.plateCount > 1
            ? `${file.name}, plate ${file.plate}`
            : file.name
      }
      desktop="dialog"
      fill
    >
      <LoadedViewer
        url={fileUrl(file.id)}
        fileId={file.id}
        plate={file.plate}
        fallbackColors={fallbackColors}
        live={live}
      />
    </Sheet>
  );
}
