import type { Spool } from "@shared/api";
import { EXTERNAL_SLOT, spoolName } from "@shared/spools";
import { Button } from "@/components/ui/Button";
import { PlusIcon } from "@/components/ui/icons";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { Sheet } from "@/components/ui/Sheet";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";

interface SlotSheetProps {
  slot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spools: Spool[];
  current: Spool | undefined;
  onPick: (spoolId: string | null) => void;
  onAddSpool?: () => void;
}

/** What goes in a slot: any spool from the pantry (one loaded elsewhere moves here), or nothing. */
export function SlotSheet({ slot, open, onOpenChange, spools, current, onPick, onAddSpool }: SlotSheetProps) {
  const sorted = [...spools]
    .filter((spool) => spool.remaining !== "empty" || spool.id === current?.id)
    // What's in it now first, then spools that aren't loaded, then ones in other slots.
    .sort(
      (a, b) =>
        Number(b.id === current?.id) - Number(a.id === current?.id) ||
        Number(!!a.slot) - Number(!!b.slot) ||
        a.material.localeCompare(b.material),
    );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={slot ? (slot === EXTERNAL_SLOT ? "External spool" : `Slot ${slot}`) : "Slot"}
      description={current ? "Swap in another spool, or take this one out." : "Pick the spool that's in it."}
      footer={
        <>
          {onAddSpool && (
            <Button variant="quiet" icon={PlusIcon} onClick={onAddSpool} className="mr-auto">
              New spool
            </Button>
          )}
          {current && (
            <Button variant="secondary" onClick={() => onPick(null)}>
              Take it out
            </Button>
          )}
        </>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-body text-ink-faint py-4">The pantry is empty. Add a spool first, then load it here.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {sorted.map((spool) => {
            const name = spoolName(spool);
            const here = spool.id === current?.id;
            return (
              <li key={spool.id}>
                <button
                  type="button"
                  onClick={() => onPick(spool.id)}
                  aria-current={here || undefined}
                  className={cn(
                    "pressable focus-ring flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left",
                    here ? "bg-semolina-soft/60" : "hover:bg-ink/4",
                  )}
                >
                  <SpoolDisc color={spool.colorHex} size="md" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink truncate font-semibold">{name.title}</span>
                    {name.detail && <span className="text-small text-ink-faint truncate">{name.detail}</span>}
                  </span>
                  {spool.slot && (
                    <span className="text-small text-ink-faint tabular shrink-0">
                      {here ? "Here now" : spool.slot === "Ext" ? "External" : `In ${spool.slot}`}
                    </span>
                  )}
                  <RemainingMeter remaining={spool.remaining} gramsLeft={spool.gramsLeft} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
