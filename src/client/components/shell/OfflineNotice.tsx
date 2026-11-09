import { OfflineIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useOnline } from "@/lib/connection";
import { useOutbox } from "@/lib/outbox";

/**
 * The one place the app says there is no connection: a quiet strip at the
 * top of the page. Everything else keeps working (captures wait on this
 * device), so nothing else needs to complain. The live region stays mounted
 * so screen readers hear it appear.
 */
export function OfflineNotice() {
  const online = useOnline();
  const waiting = useOutbox().entries.length;
  return (
    <div
      role="status"
      className={cn(
        "duration-base grid transition-[grid-template-rows,opacity] ease-out",
        online ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
      )}
    >
      <div className="overflow-hidden">{!online && <OfflineBanner waiting={waiting} className="mt-3 md:mt-6" />}</div>
    </div>
  );
}

/** The strip itself: what the offline notice says, and how many captures are waiting. */
export function OfflineBanner({ waiting, className }: { waiting: number; className?: string }) {
  return (
    <p
      className={cn(
        "bg-semolina-soft text-semolina-ink text-small rounded-pill flex w-fit max-w-full items-center gap-2 px-3.5 py-2 font-medium",
        className,
      )}
    >
      <OfflineIcon size={18} weight="bold" className="shrink-0" aria-hidden />
      <span>
        {waiting
          ? `Offline. ${waiting === 1 ? "1 capture is" : `${waiting} captures are`} waiting on this device.`
          : "Offline. Captures wait on this device until you're back."}
      </span>
    </p>
  );
}
