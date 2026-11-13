import { AnimatePresence, m } from "motion/react";
import { useSyncExternalStore } from "react";
import { DropIcon } from "@/components/ui/icons";
import { duration, ease } from "@/lib/motion";
import { hasSlicerDropTarget, subscribeSlicerDropTargets } from "@/lib/slicer-drop";

/** Shown while photos are dragged over the window: let go anywhere to capture them. */
export function DropOverlay({ visible }: { visible: boolean }) {
  // On a build (or with an attempt open), a slicer file can be dropped too.
  const slicer = useSyncExternalStore(subscribeSlicerDropTargets, hasSlicerDropTarget);
  return (
    <AnimatePresence>
      {visible && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.fast, ease: ease.out }}
          className="bg-scrim pointer-events-none fixed inset-0 z-60 flex items-center justify-center p-6"
          aria-hidden
        >
          <m.div
            initial={{ scale: 0.96, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: duration.base, ease: ease.out }}
            className="bg-lifted shadow-float flex flex-col items-center gap-3 rounded-xl px-12 py-10 text-center"
          >
            <span className="bg-semolina-soft text-semolina-ink flex size-14 items-center justify-center rounded-full">
              <DropIcon size={28} aria-hidden />
            </span>
            <p className="font-display text-title text-ink font-semibold">
              {slicer ? "Drop it here" : "Drop to capture"}
            </p>
            <p className="text-small text-ink-faint max-w-64">
              {slicer
                ? "A .3mf from Bambu Studio or Orca fills in an attempt. Photos are captured as usual."
                : "The photos start a new idea."}
            </p>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
