import { dateFormat } from "@shared/date-format";
import { ShareChoices } from "@/components/ui/ShareChoices";
import { Panel, Section } from "./shared";

const noop = () => {};
const URL = "https://spaghetti.day/s/k3J9tQwZ_rVh0pLmN8xYc2Ae";
/** Written as the share panel writes it, in the reader's own way. */
const SINCE = `Since ${dateFormat({ day: "numeric", month: "short" }).format(Date.UTC(2026, 10, 21, 12))}`;

export function SharingSection() {
  return (
    <Section
      id="sharing"
      title="Sharing"
      note="The share button on an idea, build or twist opens two ways to share it (decision 0075): the private link, the page itself for the two of you, and a public link anyone with it can look at, read-only. A popover from the button on desktop, a sheet on phones, where Share hands either link to the system's share sheet. While a public link is live the button is a basil globe; Stop sharing ends it at once, with Undo. What a guest sees is the shared page (/s/<token>): HTML from the Worker on the same tokens, no script (src/guest/guest.css)."
    >
      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        <Panel>
          <ShareChoices state="off" canShare={false} onPrivate={noop} onMake={noop} onPublic={noop} onStop={noop} />
        </Panel>
        <Panel>
          <ShareChoices state="making" canShare={false} onPrivate={noop} onMake={noop} onPublic={noop} onStop={noop} />
        </Panel>
        <Panel>
          <ShareChoices
            state="on"
            publicUrl={URL}
            since={SINCE}
            canShare={false}
            onPrivate={noop}
            onMake={noop}
            onPublic={noop}
            onStop={noop}
          />
        </Panel>
        <Panel>
          <ShareChoices
            state="on"
            publicUrl={URL}
            since={SINCE}
            canShare
            onPrivate={noop}
            onMake={noop}
            onPublic={noop}
            onStop={noop}
          />
        </Panel>
      </div>
    </Section>
  );
}
