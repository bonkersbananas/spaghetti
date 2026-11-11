import { LiveStatus } from "@/components/ui/LiveStatus";
import { Step, Steps } from "@/components/ui/Steps";
import { Label, Panel, Section } from "./shared";

/** Steps and the live status that closes them. */
export function StepsSection() {
  return (
    <Section
      id="steps"
      title="Steps and live status"
      note="Things to do in order, each saying where you are; and a status that changes by itself when it happens."
    >
      <Panel className="flex flex-col gap-8 md:max-w-2xl">
        <Steps>
          <Step n={1} title="On the printer" state="done">
            <p>Turn on LAN Only mode.</p>
          </Step>
          <Step n={2} title="On your Mac" state="active">
            <p>Paste the command into Terminal.</p>
          </Step>
          <Step n={3} title="Wait for it" state="todo" />
        </Steps>
        <div className="flex flex-col gap-3">
          <Label>Live status: waiting, connected, needs a person</Label>
          <LiveStatus state="waiting">Waiting for the bridge…</LiveStatus>
          <LiveStatus state="connected">Connected to the X2D</LiveStatus>
          <LiveStatus state="problem">Can't reach the printer. Is it on?</LiveStatus>
        </div>
      </Panel>
    </Section>
  );
}
