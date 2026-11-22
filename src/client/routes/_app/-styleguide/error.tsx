import ErrorScreen from "@/components/ui/ErrorScreen";
import { SectionBoundary } from "@/components/ui/SectionBoundary";
import { Panel, Section } from "./shared";

function Broken(): never {
  throw new Error("Cannot read properties of undefined (reading 'toLowerCase')");
}

export function ErrorSection() {
  return (
    <Section
      id="error"
      title="Error screen"
      note="What the router shows when a screen fails: calm words, Reload as the one action, the technical message behind Details with Copy. When a newer version caused it, it says so and reloads itself. A part of a screen that fails to draw (SectionBoundary, last) says so in place and leaves the rest of the screen working."
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
        <Panel className="py-4 md:col-span-2">
          <SectionBoundary name="The summary">
            <Broken />
          </SectionBoundary>
        </Panel>
      </div>
    </Section>
  );
}
