import { AnimatePresence, motion } from "motion/react";
import { DropIcon } from "@/components/ui/icons";
import { duration, ease } from "@/lib/motion";

/** Shown while photos are dragged over the window: let go anywhere to capture them. */
export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.fast, ease: ease.out }}
          className="bg-scrim pointer-events-none fixed inset-0 z-60 flex items-center justify-center p-6"
          aria-hidden
        >
          <motion.div
            initial={{ scale: 0.96, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: duration.base, ease: ease.out }}
            className="bg-lifted shadow-float flex flex-col items-center gap-3 rounded-xl px-12 py-10 text-center"
          >
            <span className="bg-semolina-soft text-semolina-ink flex size-14 items-center justify-center rounded-full">
              <DropIcon size={28} aria-hidden />
            </span>
            <p className="font-display text-title text-ink font-semibold">Drop to capture</p>
            <p className="text-small text-ink-faint">The photos start a new idea.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
