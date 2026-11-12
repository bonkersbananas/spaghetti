import { useState } from "react";
import { ChangePasswordSheet } from "@/components/shell/ChangePasswordSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import * as Icons from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { PickRow } from "@/components/ui/PickRow";
import { Sheet } from "@/components/ui/Sheet";
import { RowSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { Label, Panel, Section } from "./shared";

export function SheetSection() {
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState(false);
  const [password, setPassword] = useState(false);
  return (
    <Section
      id="sheets"
      title="Sheets & toasts"
      note="One overlay: a bottom sheet on phones, a dialog or side panel on desktop. Deletes happen at once and offer Undo in a toast, never an “are you sure?”."
    >
      <Panel className="flex flex-wrap gap-3">
        <Button onClick={() => setDialog(true)}>Open sheet (dialog)</Button>
        <Button onClick={() => setPanel(true)}>Open sheet (panel)</Button>
        <Button icon={Icons.KeyIcon} onClick={() => setPassword(true)}>
          Form sheet (change password)
        </Button>
        <Button
          icon={Icons.TrashIcon}
          onClick={() =>
            toast.undo("Idea deleted", {
              onUndo: () => toast.success("Restored"),
            })
          }
        >
          Delete with undo
        </Button>
        <Button
          onClick={() =>
            toast.undo("Moved to Towel hook, attempt 2", {
              view: { label: "View", onClick: () => undefined },
              onUndo: () => toast.success("Back in Ideas"),
            })
          }
        >
          Undo with a View
        </Button>
        <Button onClick={() => toast.success("Saved to Ideas")}>Success toast</Button>
        <Button onClick={() => toast.action("Saved to Ideas", { label: "View", onClick: () => undefined })}>
          Toast with an action
        </Button>
        <Button
          onClick={() => toast.update(() => undefined, "You can react to comments now. Photos open faster on phones.")}
        >
          Update toast (with a note)
        </Button>
        <Button
          onClick={() =>
            toast.delight(
              "First one in the pot",
              "Every print starts as an idea like this. Add more whenever they come.",
            )
          }
        >
          First idea (delight)
        </Button>
      </Panel>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Panel>
          <Label>Menu rows in a sheet (phones)</Label>
          <MenuGroup>
            <MenuItem icon={Icons.AgentIcon}>Agents</MenuItem>
            <MenuItem icon={Icons.BellIcon}>Notifications</MenuItem>
            <MenuItem icon={Icons.KeyIcon}>Change password</MenuItem>
          </MenuGroup>
        </Panel>
        <Panel>
          <Label>Menu rows in a popover (desktop)</Label>
          <MenuGroup size="sm" className="max-w-64">
            <MenuItem icon={Icons.AgentIcon}>Agents</MenuItem>
            <MenuItem icon={Icons.BellIcon}>Notifications</MenuItem>
            <MenuItem icon={Icons.SignOutIcon}>Sign out</MenuItem>
          </MenuGroup>
        </Panel>
      </div>
      <div className="mt-6">
        <Panel className="max-w-md">
          <Label>
            Pick rows (a list to choose from in a sheet: a picture or a glyph tile, status in its own ink, quiet for
            what is rarely the answer)
          </Label>
          <PickRow glyph={{ icon: Icons.BuildsIcon }} title="Towel hook" meta="2 attempts" onSelect={() => undefined} />
          <PickRow
            glyph={{ icon: Icons.SpaghettiIcon, tone: "bg-tomato-soft text-tomato-ink" }}
            title="Attempt 2"
            mark={<Chip>Latest</Chip>}
            meta={<span className="text-tomato-ink font-semibold">Spaghetti</span>}
            onSelect={() => undefined}
          />
          <PickRow
            quiet
            glyph={{ icon: Icons.BuildsIcon }}
            title="Cable comb"
            meta="Done · Sep 27"
            onSelect={() => undefined}
          />
        </Panel>
      </div>
      <ChangePasswordSheet open={password} onOpenChange={setPassword} />
      <Sheet
        open={dialog}
        onOpenChange={setDialog}
        title="A sheet"
        description="Bottom sheet on phones, centered dialog on desktop."
        footer={
          <Button variant="primary" fullWidth onClick={() => setDialog(false)}>
            Done
          </Button>
        }
      >
        <p className="text-body text-ink-soft">Drag down to dismiss on a phone. Escape closes it on desktop.</p>
      </Sheet>
      <Sheet
        open={panel}
        onOpenChange={setPanel}
        title="A side panel"
        desktop="panel"
        description="For detail views on desktop."
      >
        <div className="flex flex-col gap-3">
          <Skeleton className="aspect-4/3 w-full rounded-md" />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </Sheet>
    </Section>
  );
}
