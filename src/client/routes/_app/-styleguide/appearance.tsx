import { OfflineBanner } from "@/components/shell/OfflineNotice";
import { ThemeSwitch } from "@/components/shell/ThemeSwitch";
import { Label, Panel, Section } from "./shared";

export function AppearanceSection() {
  return (
    <Section
      id="appearance"
      title="Dark & offline"
      note="Every token has a dark value, so every screen has a night version. Switch here to check a component in both. In the dark, elevation comes from lighter surfaces and a lit top edge rather than shadow."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-6">
          <ThemeSwitch />
          <p className="text-small text-ink-faint">
            Light, dark or follow the system, remembered per device. It lives in the account sheet on phones and the
            sidebar's account menu on desktop.
          </p>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Offline notice</Label>
          <OfflineBanner waiting={0} />
          <OfflineBanner waiting={2} />
          <OfflineBanner waiting={0} seenAt={Date.now() - 2 * 60 * 60 * 1000} />
          <p className="text-small text-ink-faint">
            The one quiet place that says there is no connection. Captures wait in the outbox on this device. Over data
            kept from an earlier visit it also says how old that is (the last row); saved things are read-only until the
            connection is back.
          </p>
        </Panel>
      </div>
    </Section>
  );
}
