import { amsUnitLetters, unitSlots } from "@shared/spools";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/PageHeader";
import { HubTile } from "@/components/ui/HubTile";
import { PrinterIcon, ShoppingIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { printerQuery, spoolsQuery } from "@/lib/pantry-queries";
import { useRunningLow } from "@/lib/running-low";
import { useShopping } from "@/lib/shopping";
import { useDueUpkeep } from "@/lib/upkeep";

export const Route = createFileRoute("/_app/workshop")({
  component: Workshop,
});

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * The phone's fourth tab: the places that are not a tab of their own, each drawn with what is in it. On desktop the
 * sidebar lists the same three, so this page is only a way in for phones.
 */
function Workshop() {
  const spools = useQuery(spoolsQuery).data;
  const printer = useQuery(printerQuery).data;
  const { low } = useRunningLow();
  const due = useDueUpkeep();
  const { toBuy, isPending: shoppingPending } = useShopping();

  // The first AMS unit as the printer has it: all four slots, an empty ring for a free one (slots holds only the loaded).
  const unit = printer ? amsUnitLetters(printer.setup.amsUnits)[0] : undefined;
  const slots = unit ? unitSlots(unit) : [];
  const pantryLine = spools
    ? spools.length === 0
      ? "No spools yet"
      : [plural(spools.length, "spool"), low.length ? `${low.length} running low` : null].filter(Boolean).join(" · ")
    : null;
  const printerLine = printer ? (due.length ? `${plural(due.length, "chore")} due` : "All in order") : null;
  const shoppingLine = shoppingPending ? null : toBuy.length ? `${toBuy.length} to buy` : "Nothing to buy";

  return (
    <>
      <PageHeader title="Workshop" subtitle="The spools, the printer and what to buy for it." />
      <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-5">
        <HubTile
          to="/pantry"
          title="Pantry"
          summary={pantryLine}
          visual={
            <span className="flex pl-4">
              {(spools ?? []).slice(0, 5).map((spool) => (
                <SpoolDisc key={spool.id} color={spool.colorHex} size="lg" className="-ml-4 first:ml-0" />
              ))}
              {spools?.length === 0 && <SpoolDisc empty size="lg" />}
            </span>
          }
        />
        <HubTile
          to="/printer"
          title="Printer"
          summary={printerLine}
          visual={
            slots.length ? (
              <span className="flex gap-2.5">
                {slots.map((slot) => {
                  const spoolId = printer?.slots[slot];
                  return (
                    <SpoolDisc
                      key={slot}
                      size="lg"
                      color={spools?.find((spool) => spool.id === spoolId)?.colorHex}
                      empty={!spoolId}
                    />
                  );
                })}
              </span>
            ) : (
              <PrinterIcon size={44} className="text-ink-faint" />
            )
          }
        />
        <HubTile
          to="/shopping"
          title="Shopping list"
          summary={shoppingLine}
          visual={
            toBuy.length ? (
              <span className="flex pl-3">
                {toBuy.slice(0, 4).map((thing) =>
                  thing.picture ? (
                    <Photo
                      key={thing.id}
                      src={thing.picture.url}
                      alt=""
                      className="ring-cream -ml-3 size-16 rounded-md ring-2 first:ml-0"
                    />
                  ) : (
                    <span
                      key={thing.id}
                      className="bg-semolina-soft text-semolina-ink ring-cream -ml-3 flex size-16 items-center justify-center rounded-md ring-2 first:ml-0"
                    >
                      <ShoppingIcon size={26} />
                    </span>
                  ),
                )}
              </span>
            ) : (
              <ShoppingIcon size={44} className="text-ink-faint" />
            )
          }
        />
      </div>
    </>
  );
}
