import { actionsFor, answerHint, nudgeMessage } from "@shared/push";
import { useState } from "react";
import { AddToHomeScreenHint, NotificationsSheet } from "@/components/shell/NotificationsSheet";
import { Button } from "@/components/ui/Button";
import { BellIcon } from "@/components/ui/icons";
import { NotificationPreview } from "@/components/ui/NotificationPreview";
import { Toggle } from "@/components/ui/Toggle";
import { Label, Panel, Section } from "./shared";

const attempt = { id: "a", itemId: "i" };

export function NotificationSection() {
  const [on, setOn] = useState(true);
  const [also, setAlso] = useState(false);
  const [open, setOpen] = useState(false);
  const off = nudgeMessage("off_the_bed", attempt, "Tugboat");
  const late = nudgeMessage("overdue", attempt, "Desk tidy-up");
  return (
    <Section
      id="notifications"
      title="Notifications"
      note="A nudge when a print is off the bed or past its estimate. Settings are switches that take effect at once; the notification itself is drawn by the system, and this is a picture of it."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-3">
          <Label>Toggle</Label>
          <p className="text-small text-ink-faint">
            The whole row is the switch. A reason it can't be turned on goes in the hint.
          </p>
          <Toggle
            label="Notify this device"
            hint="Quiet from 22:00 to 07:00: those wait until morning."
            checked={on}
            onChange={setOn}
          />
          <Toggle label="Also tell me about Sam's prints" checked={also} onChange={setAlso} />
          <Toggle
            label="Can't be turned on"
            hint="Notifications are blocked for Spaghetti in this browser's settings."
            checked={false}
            disabled
            onChange={() => undefined}
          />
          <Label>iPhone in Safari: the switch is a hint</Label>
          <AddToHomeScreenHint />
          <Button icon={BellIcon} className="mt-2 self-start" onClick={() => setOpen(true)}>
            Open the settings sheet
          </Button>
          <NotificationsSheet open={open} onOpenChange={setOpen} />
        </Panel>
        <Panel className="flex flex-col gap-4">
          <Label>Notification preview</Label>
          <p className="text-small text-ink-faint">
            The buttons follow the device: three on Android, two on desktop Chrome, none on iPhone.
          </p>
          {(["android", "desktop", "ios"] as const).map((platform) => (
            <div key={platform} className="flex flex-col gap-1.5">
              <NotificationPreview
                title={platform === "ios" ? late.title : off.title}
                body={platform === "ios" ? late.body : off.body}
                actions={actionsFor(platform)}
              />
              <p className="text-small text-ink-faint px-0.5">{answerHint(platform)}</p>
            </div>
          ))}
        </Panel>
      </div>
    </Section>
  );
}
