import { useState } from "react";
import { ChangePasswordSheet } from "@/components/shell/ChangePasswordSheet";
import { Button } from "@/components/ui/Button";
import * as Icons from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
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
        <Button onClick={() => toast.success("Saved to Ideas")}>Success toast</Button>
        <Button onClick={() => toast.action("Saved to Ideas", { label: "View", onClick: () => undefined })}>
          Toast with an action
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
