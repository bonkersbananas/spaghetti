import ErrorScreen from "@/components/ui/ErrorScreen";
import { Panel, Section } from "./shared";

export function ErrorSection() {
  return (
    <Section
      id="error"
      title="Error screen"
      note="What the router shows when a screen fails: calm words, Reload as the one action, the technical message behind Details with Copy. When a newer version caused it, it says so and reloads itself."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="py-4">
          <ErrorScreen
            className="flex flex-col items-center px-4 py-8 text-center"
            error={new Error("Cannot read properties of undefined (reading 'title')")}
            reset={() => undefined}
          />
        </Panel>
        <Panel className="py-4">
          <ErrorScreen
            className="flex flex-col items-center px-4 py-8 text-center"
            updating
            error={new Error("Loading chunk _app-DoVEUgHK.js failed (404)")}
          />
        </Panel>
      </div>
    </Section>
  );
}
