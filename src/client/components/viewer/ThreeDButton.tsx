import { fileUrl } from "@shared/api";
import { lazy, Suspense, useState } from "react";
import { CubeIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { AttemptFileView } from "@/lib/items";

/** The viewer's code (three.js and the scene) loads on first use, or when a finger comes near the control. */
const importViewer = () => import("./PrintViewer");
const PrintViewer = lazy(importViewer);

/** A sliced file (one with G-code) that the server kept can be opened in 3D. */
export function canView3d(file: AttemptFileView | undefined): file is AttemptFileView {
  return (
    !!file &&
    file.stored &&
    !file.pending &&
    (/\.gcode\.3mf$/i.test(file.name) || file.prefill.estimatedMinutes !== undefined)
  );
}

/** A quiet "3D" pill on the plate picture. Opens the viewer; its code is fetched as a finger or the pointer nears it. */
export function ThreeDButton({
  file,
  fallbackColors,
  className,
}: {
  file: AttemptFileView;
  fallbackColors?: (string | null | undefined)[];
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
      {open && <ViewerSheet open={open} onOpenChange={setOpen} file={file} fallbackColors={fallbackColors} />}
    </>
  );
}

export function ViewerSheet({
  open,
  onOpenChange,
  file,
  fallbackColors,
  live,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: AttemptFileView;
  fallbackColors?: (string | null | undefined)[];
  live?: { layer: number; totalLayers: number | null } | null;
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
      <Suspense fallback={<div className="sg-stage size-full" />}>
        <PrintViewer
          url={fileUrl(file.id)}
          fileId={file.id}
          plate={file.plate}
          fallbackColors={fallbackColors}
          live={live}
        />
      </Suspense>
    </Sheet>
  );
}
