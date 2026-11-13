import { fileUrl } from "@shared/api";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CubeIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { AttemptFileView } from "@/lib/items";

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

/** A sliced file (one with G-code) that the server kept can be opened in 3D: a model once it is sliced. */
export function canView3d(file: AttemptFileView | undefined): file is AttemptFileView {
  if (!file?.stored || file.pending) return false;
  if (file.kind === "model") return file.slice?.status === "sliced";
  return /\.gcode\.3mf$/i.test(file.name) || file.prefill.estimatedMinutes !== undefined;
}

/** The attempt a file belongs to while it prints: what the viewer needs to follow it. */
export interface PrintingAttempt {
  id: string;
}

/** What opens a file in 3D, given to a card whose plate picture can show it (`FileCard`'s `view3d`). */
export interface View3d {
  file: AttemptFileView;
  fallbackColors?: (string | null | undefined)[];
  /** Set while the attempt is printing: the viewer shows the layers printed so far solid and the rest as a ghost. */
  printing?: PrintingAttempt;
}

/**
 * A plate picture that opens the 3D view: the whole picture is the button ("See benchy.stl in 3D"), and it gives way
 * under the finger like any tile. A quiet "3D" pill on its corner says so, or on a small picture (a story card's)
 * only its cube, a corner glyph on the veil that leaves the model in view. The viewer's code is fetched as a finger
 * or the pointer nears it.
 */
export function ThreeDButton({
  file,
  fallbackColors,
  printing,
  glyph,
  children,
  className,
}: View3d & {
  /** Only the cube, in the corner: for a picture too small for the pill. */
  glyph?: boolean;
  /** The plate picture. */
  children: ReactNode;
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
        className={cn("pressable focus-ring group/plate relative block rounded-md", className)}
      >
        {children}
        <span
          aria-hidden
          className={cn(
            "bg-veil text-on-veil group-hover/plate:bg-veil-strong duration-fast pointer-events-none absolute flex items-center rounded-full transition-colors",
            glyph
              ? "right-0.5 bottom-0.5 size-5 justify-center backdrop-blur-sm"
              : "text-caption right-1 bottom-1 gap-1 py-0.5 pr-2 pl-1.5 font-semibold",
          )}
        >
          <CubeIcon size={glyph ? 11 : 12} weight="bold" />
          {!glyph && "3D"}
        </span>
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
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="3D view"
      description={file.plateCount > 1 ? `${file.name}, plate ${file.plate}` : file.name}
      desktop="dialog"
      fill
    >
      <LoadedViewer
        url={fileUrl(file.id, file.kind === "model" ? "sliced" : "file")}
        fileId={file.id}
        plate={file.plate}
        fallbackColors={fallbackColors}
        printing={printing}
      />
    </Sheet>
  );
}
