import { bridgeLine } from "@shared/bridge";
import { relativeTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useDisconnectBridge } from "@/lib/bridge-setup";
import { cn } from "@/lib/cn";
import { printerQuery } from "@/lib/pantry-queries";
import { useReadOnly } from "@/lib/read-only";
import { useNow } from "@/lib/use-now";

// Only after a tap: the guide is its own chunk, not part of the first load.
const ConnectBridge = lazy(() => import("./ConnectBridge").then((m) => ({ default: m.ConnectBridge })));

/**
 * The printer bridge on the Printer page: one quiet line (connected · last seen · version, or what is wrong in plain
 * words) and the way to set it up, fix it or disconnect it. The app works the same without a bridge.
 */
export function BridgeCard({ className }: { className?: string }) {
  const printer = useQuery(printerQuery);
  const now = useNow();
  const disconnect = useDisconnectBridge();
  const readOnly = useReadOnly();
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  if (!printer.data) return null;
  const bridge = printer.data.bridge;
  const { state, text } = bridgeLine(bridge, now, (time) => relativeTime(time, now));
  const details = bridge
    ? [bridge.version && `Version ${bridge.version}`, bridge.platform].filter(Boolean).join(" · ")
    : "";
  const show = () => {
    setAsked(true);
    setOpen(true);
  };
  return (
    <div className={cn("flex flex-col gap-3", className)} data-bridge={state}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-2 size-2 shrink-0 rounded-full",
            state === "connected" ? "bg-basil" : state === "problem" ? "bg-semolina" : "bg-ink/20",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink">{state === "none" ? "No printer bridge yet." : text}</p>
          <p className="text-small text-ink-faint">
            {state === "none"
              ? "Connect one and prints sent from Bambu Studio start their attempts here by themselves."
              : details || "Listening to the printer."}
          </p>
        </div>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2 pl-5">
          <Button variant={state === "none" ? "secondary" : "quiet"} size="sm" onClick={show}>
            {state === "none" ? "Connect the bridge" : "Set it up again"}
          </Button>
          {state !== "none" && (
            <Button variant="quiet" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          )}
        </div>
      )}
      {asked && (
        <Suspense fallback={null}>
          <ConnectBridge open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </div>
  );
}
