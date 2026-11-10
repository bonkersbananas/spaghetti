import type { Spool } from "@shared/api";
import { amsUnitLetters, EXTERNAL_SLOT, type PrinterSetup, slotPlace, spoolName, unitSlots } from "@shared/spools";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { Overline } from "@/components/ui/Overline";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";

interface InThePrinterProps {
  setup: PrinterSetup;
  /** Slot → spool id, as the printer says. */
  slots: Record<string, string>;
  spools: Spool[];
}

/** What is loaded, as a spool in each slot, in the order the AMS holds them, then the external spool. */
export function loadedSlots(setup: PrinterSetup, slots: Record<string, string>, spools: Spool[]) {
  const byId = new Map(spools.map((spool) => [spool.id, spool]));
  const groups = [...amsUnitLetters(setup.amsUnits).map(unitSlots), [EXTERNAL_SLOT]];
  return groups.map((group) => group.map((slot) => ({ slot, spool: byId.get(slots[slot] ?? "") })));
}

/**
 * A quiet, read-only look at what is loaded: a disc per slot with its slot under it, and up to two sentences
 * about spools that are running low. The strip leads to the Pantry, where it can be changed. Nothing is
 * drawn when no spool is loaded at all.
 */
export function InThePrinter({ setup, slots, spools }: InThePrinterProps) {
  const groups = loadedSlots(setup, slots, spools);
  const loaded = groups.flat().filter((entry) => entry.spool);
  if (loaded.length === 0) return null;
  const running = loaded
    .filter((entry) => entry.spool && (entry.spool.remaining === "low" || entry.spool.remaining === "empty"))
    .slice(0, 2);

  return (
    <section aria-labelledby="today-printer" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Overline as="h2" id="today-printer">
          In the printer
        </Overline>
        <Link to="/pantry" className="focus-ring rounded-sm">
          <Button variant="quiet" size="sm" tabIndex={-1} className="-my-2 -mr-3">
            Pantry
          </Button>
        </Link>
      </div>
      <Link
        to="/pantry"
        className="pressable focus-ring hover:bg-ink/4 no-scrollbar -mx-1.5 flex items-start gap-3 overflow-x-auto rounded-lg p-1.5"
      >
        {groups.map((group, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the groups are the AMS units, in order.
          <span key={index} className="flex shrink-0 items-start gap-3">
            {index > 0 && <span aria-hidden className="bg-hairline mt-1.5 h-8 w-px shrink-0" />}
            {group.map(({ slot, spool }) => (
              <span key={slot} className="flex w-11 shrink-0 flex-col items-center gap-1">
                <SpoolDisc color={spool?.colorHex} empty={!spool} />
                <span className="text-caption text-ink-faint tabular">{slot}</span>
                <span className="sr-only">{spool ? spoolName(spool).title : "empty"}</span>
              </span>
            ))}
          </span>
        ))}
      </Link>
      {running.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {running.map(({ slot, spool }) =>
            spool ? (
              <li key={slot} className="text-small text-ink-soft flex items-center gap-2">
                <RemainingMeter remaining={spool.remaining} />
                <span>
                  {spoolName(spool).title} {slotPlace(slot)} is {spool.remaining === "empty" ? "empty" : "running low"}
                </span>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </section>
  );
}
