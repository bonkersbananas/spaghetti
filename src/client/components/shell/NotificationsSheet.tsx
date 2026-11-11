import { actionsFor, answerHint, nudgeMessage, QUIET_FROM_HOUR, QUIET_TO_HOUR } from "@shared/push";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { BellIcon } from "@/components/ui/icons";
import { NotificationPreview } from "@/components/ui/NotificationPreview";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { ApiError } from "@/lib/api";
import { notificationPlatform } from "@/lib/push";
import { type PushStatus, usePushDevice } from "@/lib/push-device";
import { peopleQuery, sessionQuery } from "@/lib/queries";

const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

const reasons: Partial<Record<PushStatus, string>> = {
  unsupported: "This browser can't show notifications from Spaghetti.",
  blocked: "Notifications are blocked for Spaghetti in this browser's settings. Allow them there, then come back.",
};

/** iOS only allows web push for a site added to the Home Screen: in Safari the switch is this, instead. */
export function AddToHomeScreenHint() {
  return (
    <p className="text-small text-ink-soft bg-paper rounded-md p-3.5">
      On iPhone, add Spaghetti to your Home Screen first: Share → Add to Home Screen, then open it from there.
    </p>
  );
}

const example = nudgeMessage("off_the_bed", { id: "example", itemId: "example" }, "Tugboat");

/**
 * Notifications for this device: a nudge when a print is off the bed or past its estimate, answerable in a
 * tap. Permission is only asked for when the switch is turned on, never before.
 */
export function NotificationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const device = usePushDevice(open);
  const { data: user } = useQuery({ ...sessionQuery, enabled: open });
  const { data: people } = useQuery({ ...peopleQuery, enabled: open });
  const other = people?.find((person) => person.id !== user?.id);
  const { status } = device;
  const platform = notificationPlatform();
  const on = status === "on";
  const reason = reasons[status];
  const canTurnOn = status === "off" || status === "on";

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Notifications"
      description="A nudge when a print is done, a note when the other person comments, now and then when the printer needs care, and a look back on Sunday."
    >
      <div className="flex flex-col gap-3">
        {status === "install" ? (
          <AddToHomeScreenHint />
        ) : (
          <Toggle
            label="Notify this device"
            checked={on}
            disabled={!canTurnOn || device.turnOn.isPending || device.turnOff.isPending}
            hint={
              reason ??
              (status === "off" && device.permission === "default"
                ? "Your browser will ask for permission when you turn this on."
                : `Quiet from ${pad(QUIET_FROM_HOUR)} to ${pad(QUIET_TO_HOUR)}: those wait until morning.`)
            }
            onChange={(next) => {
              if (next) {
                device.turnOn.mutate(undefined, {
                  onSuccess: (made) => made && toast.success("Notifications are on"),
                  onError: () => toast.error("Couldn't turn notifications on", "Check the connection and try again."),
                });
              } else {
                device.turnOff.mutate(undefined, {
                  onError: () => toast.error("Couldn't turn notifications off", "Check the connection and try again."),
                });
              }
            }}
          />
        )}
        {on && (
          <>
            <Toggle
              label={
                other ? `Also tell me about ${other.name}'s prints` : "Also tell me about the other person's prints"
              }
              checked={device.alsoOthers}
              onChange={(next) => device.setAlsoOthers.mutate(next)}
            />
            <Toggle
              label="Tell me when upkeep is due"
              hint="One gentle nudge a day at most: a dirty plate, a worn filter."
              checked={device.upkeepNudges}
              onChange={(next) => device.setUpkeepNudges.mutate(next)}
            />
            <Toggle
              label="Your week, on Sunday evening"
              hint="One look back at 19:00 when there was a print or an idea."
              checked={device.weekNudges}
              onChange={(next) => device.setWeekNudges.mutate(next)}
            />
            <Button
              variant="secondary"
              icon={BellIcon}
              loading={device.sendTest.isPending}
              className="mt-1 self-start"
              onClick={() =>
                device.sendTest.mutate(undefined, {
                  onSuccess: () => toast.success("Sent", "It should arrive in a moment."),
                  onError: (error) =>
                    toast.error(
                      "Couldn't send it",
                      error instanceof ApiError ? error.message : "Check the connection and try again.",
                    ),
                })
              }
            >
              Send a test notification
            </Button>
          </>
        )}
        <div className="mt-2">
          <p className="text-caption text-ink-faint mb-2 font-semibold tracking-wider uppercase">What you'll get</p>
          <NotificationPreview title={example.title} body={example.body} actions={actionsFor(platform)} />
          <p className="text-small text-ink-faint mt-2">{answerHint(platform)}</p>
        </div>
      </div>
    </Sheet>
  );
}
