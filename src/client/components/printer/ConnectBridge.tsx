import { BRIDGE_CONNECTED_MS, type BridgePrinterState, isFresh, PAIRING_MINUTES } from "@shared/bridge";
import { spoolName } from "@shared/spools";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CommandBlock } from "@/components/ui/CommandBlock";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { Sheet } from "@/components/ui/Sheet";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Step, Steps } from "@/components/ui/Steps";
import { installCommand, useMakeCode } from "@/lib/bridge-setup";
import { printerQuery, spoolsQuery } from "@/lib/pantry-queries";
import { useNow } from "@/lib/use-now";

const STATE_WORDS: Record<BridgePrinterState, string> = {
  idle: "The printer is idle.",
  printing: "It is printing right now.",
  paused: "A print is paused.",
  finished: "The last print has finished.",
  failed: "The last print failed.",
  offline: "The printer isn't answering yet.",
};

/**
 * "Connect the bridge": the guided setup, a bottom sheet on phones and a panel on desktop. Three steps (the printer,
 * the Mac, wait) and a live line that turns from "Waiting for the bridge…" into "Connected to the X2D" by itself
 * when the bridge first checks in with the new code.
 */
export function ConnectBridge({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const makeCode = useMakeCode();
  const asked = useRef(false);
  const now = useNow(1_000);
  const printer = useQuery({ ...printerQuery, refetchInterval: open ? 3_000 : false });
  const spools = useQuery({ ...spoolsQuery, enabled: open });

  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    makeCode.mutate();
  }, [open, makeCode]);

  const code = makeCode.data;
  // The bridge only counts once it has checked in after the code was made (by the server's clock, which the code's
  // expiry carries): an older bridge doesn't fake "connected".
  const since = code ? code.expiresAt - PAIRING_MINUTES * 60_000 : Number.POSITIVE_INFINITY;
  const left = code ? code.expiresAt - now : 0;
  const expired = Boolean(code) && left <= 0;
  const bridge = printer.data?.bridge ?? null;
  const heard = Boolean(bridge && bridge.lastSeenAt >= since && isFresh(bridge.lastSeenAt, now, BRIDGE_CONNECTED_MS));
  const problem = heard ? bridge?.problems?.[0] : undefined;
  const connected = heard && !problem && bridge?.printerState !== "offline";

  const slots = Object.entries(printer.data?.slots ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const loaded = slots.flatMap(([slot, id]) => {
    const spool = spools.data?.find((candidate) => candidate.id === id);
    return spool ? [{ slot, spool }] : [];
  });

  const fresh = () => {
    asked.current = true;
    makeCode.mutate();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      desktop="panel"
      title="Connect the bridge"
      description="A small program on a Mac that's usually on. It listens to the X2D, so prints sent from Bambu Studio show up here by themselves. It never sends the printer a command."
    >
      <Steps className="pb-4">
        <Step n={1} title="On the printer" state={connected ? "done" : "todo"}>
          <p>
            Turn on <strong className="text-ink">LAN Only mode</strong>, then{" "}
            <strong className="text-ink">Developer mode</strong> (it sits under the access code, in Settings → General).
          </p>
          <p>Keep three things from its screen to hand: the IP address, the serial number and the access code.</p>
          <p className="text-small text-ink-faint">
            LAN Only turns off Bambu's cloud, so Bambu Handy and remote monitoring stop. You can switch it back.
          </p>
        </Step>
        <Step n={2} title="On your Mac" state={connected ? "done" : "active"}>
          <p>
            Open Terminal (press <span className="text-ink font-semibold">⌘ Space</span>, type Terminal), paste this and
            answer what it asks. It takes a couple of minutes.
          </p>
          {code && !expired ? (
            <>
              <CommandBlock label="Terminal command" command={installCommand(code.code, window.location.origin)} />
              <p className="text-small text-ink-faint">
                The code {code.code} works once and for about{" "}
                {Math.min(PAIRING_MINUTES, Math.max(1, Math.ceil(left / 60_000)))} more min.
              </p>
            </>
          ) : makeCode.isError ? (
            <Button variant="secondary" size="sm" className="self-start" onClick={fresh}>
              Couldn't make a code. Try again
            </Button>
          ) : expired ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-small text-ink-faint">That code has run out.</p>
              <Button variant="secondary" size="sm" onClick={fresh}>
                Make a new code
              </Button>
            </div>
          ) : (
            <p className="text-small text-ink-faint">Making a code…</p>
          )}
        </Step>
        <Step n={3} title="Wait for it" state={connected ? "done" : heard ? "active" : "todo"}>
          {problem ? (
            <LiveStatus state="problem">{problem.message}</LiveStatus>
          ) : connected ? (
            <>
              <LiveStatus state="connected">Connected to the X2D</LiveStatus>
              <p>{bridge?.printerState ? STATE_WORDS[bridge.printerState] : "It is listening."}</p>
              {loaded.length > 0 ? (
                <ul className="flex flex-wrap gap-x-4 gap-y-3" aria-label="Spools it sees in the AMS">
                  {loaded.map(({ slot, spool }) => (
                    <li key={slot} className="flex items-center gap-2">
                      <SpoolDisc color={spool.colorHex} size="sm" />
                      <span className="text-small">
                        <span className="text-ink font-semibold">{slot}</span> {spoolName(spool).title}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-ink-faint">It hasn't seen any spools in the AMS yet.</p>
              )}
              <Button variant="primary" className="self-start" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <LiveStatus state="waiting">Waiting for the bridge…</LiveStatus>
          )}
        </Step>
      </Steps>
    </Sheet>
  );
}
