import { type BridgeStatus, bridgeLine } from "@shared/bridge";
import { relativeTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { printerQuery } from "@/lib/pantry";
import { useNow } from "@/lib/use-now";

export const BRIDGE_DOCS = "https://github.com/bonkersbananas/spaghetti/blob/main/docs/bridge.md";

/**
 * One quiet line about the printer bridge: connected, last heard a while ago, or not set up (with the way to set
 * it up). The app works the same without it, so "not set up" is information, never a warning.
 */
export function BridgeLine({ status, className }: { status?: BridgeStatus | null; className?: string }) {
  const now = useNow();
  const { state, text } = bridgeLine(status, now, (time) => relativeTime(time, now));
  return (
    <p className={cn("text-small text-ink-faint mt-1 flex items-center gap-2", className)} data-bridge={state}>
      <span
        className={cn("size-2 shrink-0 rounded-full", state === "connected" ? "bg-basil" : "bg-ink/20")}
        aria-hidden
      />
      <span>
        {text}{" "}
        {state === "none" && (
          <a
            href={BRIDGE_DOCS}
            target="_blank"
            rel="noreferrer"
            className="focus-ring text-ink-soft hover:text-ink rounded-xs font-semibold underline underline-offset-2"
          >
            How to set one up
          </a>
        )}
      </span>
    </p>
  );
}

/** The same line, reading the printer from the cache. */
export function PrinterBridgeLine({ className }: { className?: string }) {
  const printer = useQuery(printerQuery);
  if (!printer.data) return null;
  return <BridgeLine status={printer.data.bridge} className={className} />;
}
