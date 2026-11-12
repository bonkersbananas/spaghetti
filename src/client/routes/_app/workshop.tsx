import { amsUnitLetters, unitSlots } from "@shared/spools";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/PageHeader";
import { HubTile } from "@/components/ui/HubTile";
import { PrinterIcon, ShoppingIcon, TwistIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { printerQuery, spoolsQuery } from "@/lib/pantry-queries";
import { photoSrc } from "@/lib/previews";
import { useRunningLow } from "@/lib/running-low";
import { useShopping } from "@/lib/shopping";
import { useTwists } from "@/lib/twists";
import { useDueUpkeep } from "@/lib/upkeep";

export const Route = createFileRoute("/_app/workshop")({
  component: Workshop,
});

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What needs attention, in the ink "due" uses on a print's progress. */
const Attention = ({ children }: { children: string }) => (
  <span className="text-semolina-ink font-semibold">{children}</span>
);

/** The most pictures the shopping tile shows; the rest are counted. */
const PICTURES = 3;

/**
 * The phone's fourth tab: the places that are not a tab of their own, each drawn with what is in it. On desktop the
 * sidebar lists the same three, so this page is only a way in for phones. The tiles flow to as many columns as fit,
 * so a fourth place (twists) joins without a new layout.
 */
function Workshop() {
  const spools = useQuery(spoolsQuery).data;
  const printer = useQuery(printerQuery).data;
  const { low } = useRunningLow();
  const due = useDueUpkeep();
  const { toBuy, isPending: shoppingPending } = useShopping();
  const { twists } = useTwists();

  // The first AMS unit as the printer has it, drawn as the unit: four bays, an empty ring in a free one (the printer's
  // slots hold only the loaded ones). Nothing without an AMS.
  const unit = printer ? amsUnitLetters(printer.setup.amsUnits)[0] : undefined;
  const slots = unit ? unitSlots(unit) : [];
  const pictured = toBuy.filter((thing) => thing.picture);
  const shown = pictured.slice(0, PICTURES);

  const pantryLine = spools ? (
    spools.length === 0 ? (
      "No spools yet"
    ) : (
      <>
        {plural(spools.length, "spool")}
        {low.length > 0 && (
          <>
            {" · "}
            <Attention>{`${low.length} running low`}</Attention>
          </>
        )}
      </>
    )
  ) : null;
  const printerLine = printer ? (
    due.length ? (
      <Attention>{`${plural(due.length, "chore")} due`}</Attention>
    ) : (
      "All in order"
    )
  ) : null;
  // The newest twist says how things stand; its picture (and the one before it) lean on each other like prints on a desk.
  const newest = twists?.[0];
  const twistPictures = (twists ?? []).flatMap((twist) => (twist.source.photo ? [twist.source.photo] : [])).slice(0, 2);
  const twistsLine = twists ? (newest ? `Latest: ${newest.name}` : "Nothing twisted yet") : null;
  const shoppingLine = shoppingPending ? null : toBuy.length ? `${toBuy.length} to buy` : "Nothing to buy";

  return (
    <>
      <PageHeader title="Workshop" subtitle="The spools, the printer, what to buy and the models we twist." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] md:gap-5">
        <HubTile
          to="/pantry"
          title="Pantry"
          summary={pantryLine}
          visual={
            <span className="flex">
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
            slots.length > 0 ? (
              <span className="grid w-full max-w-72 grid-cols-4 gap-2">
                {slots.map((slot) => {
                  const spoolId = printer?.slots[slot];
                  return (
                    <span
                      key={slot}
                      className="bg-cream shadow-soft flex flex-col items-center gap-1 rounded-md px-1 pt-2.5 pb-1.5"
                    >
                      <SpoolDisc
                        size="md"
                        color={spools?.find((spool) => spool.id === spoolId)?.colorHex}
                        empty={!spoolId}
                      />
                      <span className="text-caption text-ink-faint tabular font-semibold tracking-wider uppercase">
                        {slot}
                      </span>
                    </span>
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
            shown.length > 0 ? (
              <span className="flex items-center">
                {shown.map((thing) =>
                  thing.picture ? (
                    <Photo
                      key={thing.id}
                      src={thing.picture.url}
                      alt=""
                      className="ring-cream -ml-3 size-16 rounded-md ring-2 first:ml-0"
                    />
                  ) : null,
                )}
                {toBuy.length > shown.length && (
                  <span className="bg-cream text-ink-soft shadow-soft ring-cream tabular text-small -ml-3 flex size-16 items-center justify-center rounded-md font-semibold ring-2">
                    +{toBuy.length - shown.length}
                  </span>
                )}
              </span>
            ) : (
              <ShoppingIcon size={44} className="text-ink-faint" />
            )
          }
        />
        <HubTile
          to="/twists"
          title="Twists"
          summary={twistsLine}
          visual={
            twistPictures.length > 0 ? (
              <span className="flex items-center justify-center">
                {twistPictures.map((photo, index) => (
                  <Photo
                    key={photo.id}
                    src={photoSrc(photo.id, "thumb")}
                    alt=""
                    color={photo.color || undefined}
                    className={cn(
                      "ring-cream shadow-raised h-20 w-28 rounded-md ring-4",
                      index === 0 ? "z-10 -rotate-3" : "-ml-8 rotate-6 opacity-90",
                    )}
                  />
                ))}
              </span>
            ) : (
              <TwistIcon size={44} className="text-ink-faint" />
            )
          }
        />
      </div>
    </>
  );
}
