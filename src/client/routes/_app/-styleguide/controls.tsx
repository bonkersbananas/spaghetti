import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { DurationField, NumberField } from "@/components/ui/Field";
import * as Icons from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Swatch, SwatchPicker } from "@/components/ui/Swatch";
import { Label, Panel, SAMPLE_COLOR, Section } from "./shared";

export function ControlSection() {
  const [nozzle, setNozzle] = useState<"main" | "auxiliary">("main");
  const [bed, setBed] = useState<number | undefined>(60);
  const [layer, setLayer] = useState<number | undefined>(0.2);
  const [minutes, setMinutes] = useState<number | undefined>(130);
  const [color, setColor] = useState<string | undefined>(SAMPLE_COLOR);
  const [open, setOpen] = useState(false);
  return (
    <Section
      id="controls"
      title="Controls"
      note="For print settings: choices side by side, numbers with their units, a filament's color, and detail tucked behind one tap."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <Label>Segmented control (arrow keys move)</Label>
          <SegmentedControl
            label="Nozzle"
            options={[
              { value: "main", label: "Main" },
              { value: "auxiliary", label: "Auxiliary" },
            ]}
            value={nozzle}
            onChange={setNozzle}
            className="w-full"
          />
          <Label>Number, decimal and duration fields</Label>
          <div className="grid grid-cols-3 gap-2.5">
            <NumberField size="sm" label="Bed" suffix="°C" min={0} max={150} value={bed} onChange={setBed} />
            <NumberField size="sm" label="Layer" suffix="mm" decimal value={layer} onChange={setLayer} />
            <DurationField size="sm" label="Time" placeholder="2h 10" value={minutes} onChange={setMinutes} />
          </div>
          <Label>Filament color: a swatch, and a picker to tap</Label>
          <div className="flex items-center gap-3">
            <SwatchPicker value={color} onChange={setColor} />
            <SwatchPicker value={undefined} onChange={setColor} label="No color yet" />
            <span className="text-small text-ink-soft inline-flex items-center gap-1.5">
              <Swatch color={color} /> Jade white PLA
            </span>
          </div>
        </Panel>
        <Panel className="flex flex-col gap-5">
          <Label>Disclosure</Label>
          <Disclosure
            open={open}
            onOpenChange={setOpen}
            title="Settings"
            icon={Icons.SettingsIcon}
            summary="Same as attempt 2 · PLA · 0.20 mm · bed 60 °C"
          >
            <p className="text-body text-ink-soft">The optional detail lives here, out of the way of the quick path.</p>
          </Disclosure>
          <Label>Action bar (phones)</Label>
          <p className="text-body text-ink-soft">
            <code className="text-small">ActionBar</code> puts a screen's main action within thumb reach, on top of the
            tab bar, such as "Log attempt" on a build. Hidden on desktop, where the action sits in the page; toasts move
            up above it.
          </p>
          <div className="bg-paper-deep rounded-md p-3">
            <Button variant="primary" size="lg" icon={Icons.PlusIcon} fullWidth>
              Log attempt
            </Button>
          </div>
        </Panel>
      </div>
    </Section>
  );
}
