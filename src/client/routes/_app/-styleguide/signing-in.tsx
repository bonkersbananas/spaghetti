import type { PersonColor } from "@shared/people";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { CodeDisplay } from "@/components/ui/CodeDisplay";
import { InfoRow } from "@/components/ui/InfoRow";
import { InviteIcon, LaptopIcon, PhoneIcon, RenameIcon, TrashIcon } from "@/components/ui/icons";
import { PersonColorPicker } from "@/components/ui/PersonColorPicker";
import { QrCard } from "@/components/ui/QrCard";
import { Label, Panel, Section } from "./shared";

/** Signing in: the pieces the passkey, "sign in on another device" and invite screens are built from. */
export function SigningInSection() {
  const [color, setColor] = useState<PersonColor>("plum");
  return (
    <Section
      id="signing-in"
      title="Signing in"
      note="A QR card and a short code for the other device, rows for what you own (a passkey, a signed-in device, a waiting invite), and the six person colors as swatches."
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel>
          <Label>QR card and code</Label>
          <div className="flex flex-col items-center gap-5">
            <QrCard value="https://spaghetti.day/link#specimen" label="QR code specimen" />
            <CodeDisplay code="K7QM-3XRD" />
          </div>
          <p className="text-small text-ink-faint mt-4 text-center">
            The QR is dark on light in both themes, so any camera reads it.
          </p>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel>
            <Label>Info rows</Label>
            <ul>
              <InfoRow
                icon={PhoneIcon}
                title="iPhone"
                meta="Added 3 days ago · used yesterday"
                actions={
                  <>
                    <IconButton icon={RenameIcon} label="Rename iPhone" />
                    <IconButton icon={TrashIcon} label="Remove iPhone" />
                  </>
                }
              />
              <InfoRow icon={LaptopIcon} title="Mac · Chrome" meta="This device" />
              <InfoRow
                icon={InviteIcon}
                title="Invite for one person"
                meta="Made by Alex · expires in 6 days"
                actions={
                  <Button variant="quiet" size="sm">
                    Withdraw
                  </Button>
                }
              />
            </ul>
          </Panel>
          <Panel>
            <Label>Person colors</Label>
            <PersonColorPicker value={color} onChange={setColor} />
          </Panel>
        </div>
      </div>
    </Section>
  );
}
