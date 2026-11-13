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
      </Panel>
    </Section>
  );
}
