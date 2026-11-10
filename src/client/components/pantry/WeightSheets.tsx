import type { Spool } from "@shared/api";
import { gramsFromScale, gramsText, MAX_SPOOL_GRAMS } from "@shared/ledger";
import { spoolName } from "@shared/spools";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { NumberField } from "@/components/ui/Field";
import { CheckIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { setSpoolWeight, weighSpool } from "@/lib/pantry";
import { useIsDesktop } from "@/lib/use-media-query";
import { WeightPicker } from "./WeightPicker";

/**
 * "Weigh it": one big number, the spool on the scale. The empty spool's weight is taken off, and what
 * is left becomes the new baseline. Done saves it, and so does closing the sheet with a number in it
 * (nothing typed is ever lost); the toast undoes it.
 */
export function WeighSheet({
  spool,
  open,
  onOpenChange,
}: {
  spool: Spool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [onScale, setOnScale] = useState<number | undefined>(undefined);
  const [tare, setTare] = useState<number | undefined>(spool.tareGrams ?? undefined);
  const saved = useRef(false);
  const name = spoolName(spool);

  useEffect(() => {
    if (!open) return;
    saved.current = false;
    setOnScale(undefined);
    setTare(spool.tareGrams ?? undefined);
  }, [open, spool.tareGrams]);

  const left = onScale === undefined ? null : gramsFromScale(onScale, tare);
  const commit = () => {
    if (saved.current || onScale === undefined) return;
    saved.current = true;
    void weighSpool(queryClient, spool, {
      onScale,
      ...(tare !== (spool.tareGrams ?? undefined) ? { tareGrams: tare ?? null } : {}),
    });
  };
  const close = (next: boolean) => {
    if (!next) commit();
    onOpenChange(next);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title="Weigh it"
      description={`Put ${[name.title, name.detail].filter(Boolean).join(", ")} on the scale.`}
      footer={
        <Button
          variant="primary"
          size={isDesktop ? "md" : "lg"}
          icon={CheckIcon}
          disabled={onScale === undefined}
          onClick={() => close(false)}
          className="max-md:flex-1"
        >
          Save weighing
        </Button>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          close(false);
        }}
      >
        <NumberField
          size="lg"
          label="On the scale"
          suffix="g"
          autoFocus
          min={0}
          max={MAX_SPOOL_GRAMS * 2}
          placeholder={spool.gramsLeft !== null ? String((spool.tareGrams ?? 0) + spool.gramsLeft) : "812"}
          value={onScale}
          onChange={setOnScale}
          hint={
            left !== null
              ? `About ${gramsText(left)} of filament left.`
              : spool.gramsLeft !== null
                ? `Now about ${gramsText(spool.gramsLeft)} left.`
                : "Spool and filament together."
          }
        />
        <NumberField
          size="sm"
          label="The empty spool weighs"
          suffix="g"
          min={0}
          max={MAX_SPOOL_GRAMS}
          placeholder="250"
          value={tare}
          onChange={setTare}
          hint="Taken off, and remembered for next time."
          className="max-w-56"
        />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** "Set the weight": what the spool held when new. Every change is saved at once. */
export function SetWeightSheet({
  spool,
  open,
  onOpenChange,
}: {
  spool: Spool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Set the weight"
      description="What this spool held when new. Prints and weighings count it down from there."
    >
      <div className="flex flex-col gap-6">
        <WeightPicker
          value={spool.netGrams}
          onChange={(netGrams) => void setSpoolWeight(queryClient, spool, { netGrams })}
        />
        <p className="text-small text-ink-faint">Without a weight, the level stays the one you set by hand.</p>
      </div>
    </Sheet>
  );
}
