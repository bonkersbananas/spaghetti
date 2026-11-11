import { LiveStatus } from "@/components/ui/LiveStatus";
import { Panel, Section } from "./shared";

/** Live status: see Steps for it in place. Alone here so each state can be read next to the others. */
export function LiveStatusSection() {
  return (
    <Section
      id="live-status"
      title="Live status"
      note="Something that will change by itself: a pulse while we wait, a check when it has happened, a warning when it needs a person."
    >
      <Panel className="flex flex-col gap-3 md:max-w-2xl">
        <LiveStatus state="waiting">Waiting for the bridge…</LiveStatus>
        <LiveStatus state="connected">Connected to the X2D</LiveStatus>
        <LiveStatus state="problem">Can't reach the printer. Is it on?</LiveStatus>
      </Panel>
    </Section>
  );
}
