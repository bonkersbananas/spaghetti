import { CommandBlock } from "@/components/ui/CommandBlock";
import { Panel, Section } from "./shared";

/** A line to paste into Terminal: wraps on a phone, copies with one tap. */
export function CommandBlockSection() {
  return (
    <Section
      id="command-block"
      title="Command block"
      note="A line to copy and paste somewhere else. It wraps instead of scrolling, so a phone can read all of it."
    >
      <Panel className="md:max-w-2xl">
        <CommandBlock
          label="Terminal command"
          command="curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- ABCD-EFGH"
        />
      </Panel>
    </Section>
  );
}
