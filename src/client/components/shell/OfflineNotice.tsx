import { AnimatePresence, motion } from "motion/react";
import { OfflineIcon } from "@/components/ui/icons";
import { useOnline } from "@/lib/connection";
import { useOutbox } from "@/lib/outbox";

/**
 * The one place the app says there is no connection: a quiet strip at the
 * top of the page. Everything else keeps working (captures wait on this
 * device), so nothing else needs to complain.
 */
export function OfflineNotice() {
  const online = useOnline();
  const waiting = useOutbox().entries.length;
  return (
    <AnimatePresence initial={false}>
      {!online && (
        <motion.div
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <p className="bg-semolina-soft text-semolina-ink text-small rounded-pill mt-3 flex w-fit max-w-full items-center gap-2 px-3.5 py-2 font-medium md:mt-6">
            <OfflineIcon size={18} weight="bold" className="shrink-0" aria-hidden />
            <span>
              {waiting
                ? `Offline. ${waiting === 1 ? "1 capture is" : `${waiting} captures are`} waiting on this device.`
                : "Offline. Captures wait on this device until you're back."}
            </span>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
