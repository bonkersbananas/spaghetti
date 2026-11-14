import { OpenInStudio } from "@/components/builds/OpenInStudio";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import * as Icons from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Panel, Section } from "./shared";

export function ButtonSection() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      note="Primary (tomato) for the one main action on a screen; secondary for the rest; quiet in toolbars and lists. ButtonLink is the same face on a link (a download). Tap targets are 44 px on phones."
    >
      <Panel className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Icons.PlusIcon} shortcut={["C"]}>
            New idea
          </Button>
          <Button variant="secondary" icon={Icons.CameraIcon}>
            Add photo
          </Button>
          <Button variant="quiet">Cancel</Button>
          <Button variant="danger" icon={Icons.TrashIcon}>
            Delete
          </Button>
          <Button variant="floating" size="lg" icon={Icons.PlusIcon}>
            Floating (phone ActionBar)
          </Button>
          <ButtonLink href="#buttons" variant="secondary" icon={Icons.DownloadIcon}>
            Download the original
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary">Medium</Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton icon={Icons.CloseIcon} label="Close" />
          <IconButton icon={Icons.CameraIcon} label="Take photo" variant="secondary" />
          <IconButton icon={Icons.PlusIcon} label="New idea" variant="primary" size="lg" />
          <span className="text-small text-ink-faint hidden items-center gap-2 md:flex">
            Keyboard hints: <Kbd keys={["G", "I"]} /> <Kbd keys={["/"]} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Computers only: "Open in Bambu Studio" on a card (icon) and beside a page's quiet actions (button). */}
          <OpenInStudio icon file={SAMPLE_FILE} />
          <OpenInStudio size="md" file={SAMPLE_FILE} />
          <span className="text-small text-ink-faint">
            Open in Bambu Studio: an icon among a card's actions, a quiet button on the page. Absent on phones and
            tablets.
          </span>
        </div>
      </Panel>
    </Section>
  );
}

const SAMPLE_FILE = { id: "00000000-0000-4000-8000-000000000000", name: "fusilli-knob.gcode.3mf", stored: true };
