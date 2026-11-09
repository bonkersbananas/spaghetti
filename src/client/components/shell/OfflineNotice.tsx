import { inlineTime } from "@shared/time";
import { useEffect, useState } from "react";
import { OfflineIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useOnline } from "@/lib/connection";
import { useOutbox } from "@/lib/outbox";
import { useLastSeen } from "@/lib/persist";

/**
 * The one place the app says there is no connection: a quiet strip at the
 * top of the page. Everything else keeps working (captures wait on this
 * device), so nothing else needs to complain. When the screen shows what was
 * last fetched, the strip says how old that is and that it is read-only.
 * The live region stays mounted so screen readers hear it appear.
 */
export function OfflineNotice() {
  const online = useOnline();
  const waiting = useOutbox().entries.length;
  const seenAt = useLastSeen();
  return (
    <div
      role="status"
      className={cn(
        "duration-base grid transition-[grid-template-rows,opacity] ease-out",
        online ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
      )}
    >
      <div className="overflow-hidden">
        {!online && <OfflineBanner waiting={waiting} seenAt={seenAt} className="mt-3 md:mt-6" />}
      </div>
    </div>
  );
}

/** "2 h ago" stays right while the strip is open. */
function useMinuteClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The strip itself: what the offline notice says, how many captures are
 * waiting and, over data kept from earlier, when it was last fetched. That
 * marker stays until the server answers again.
 */
export function OfflineBanner({
  waiting,
  seenAt,
  className,
}: {
  waiting: number;
  /** When the data on screen last came from the server. */
  seenAt?: number | null;
  className?: string;
}) {
  const now = useMinuteClock();
  const captures = waiting
    ? `${waiting === 1 ? "1 capture is" : `${waiting} captures are`} waiting on this device.`
    : "Captures wait on this device until you're back.";
  return (
    <div
      className={cn(
        "bg-semolina-soft text-semolina-ink text-small flex w-fit max-w-full items-start gap-2.5 px-3.5 py-2",
        seenAt ? "rounded-lg" : "rounded-pill items-center",
        className,
      )}
    >
      <OfflineIcon size={18} weight="bold" className={cn("shrink-0", !!seenAt && "mt-0.5")} aria-hidden />
      {seenAt ? (
        <p>
          <span className="font-medium">Offline. Showing what you saw {inlineTime(seenAt, now)}.</span>{" "}
          <span>Saved things are read-only. {captures}</span>
        </p>
      ) : (
        <p className="font-medium">Offline. {captures}</p>
      )}
    </div>
  );
}
