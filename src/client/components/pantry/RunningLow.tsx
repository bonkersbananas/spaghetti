import { gramsText } from "@shared/ledger";
import { spoolName } from "@shared/spools";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CopyIcon } from "@/components/ui/icons";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { Section } from "@/components/ui/Section";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { toast } from "@/components/ui/Toast";
import { type LowSpool, shoppingList } from "@/lib/running-low";
import { useIsDesktop } from "@/lib/use-media-query";

/** The phone's share sheet where there is one (so the list can go straight to a message), else the clipboard. */
async function shareList(text: string, canShare: boolean) {
  if (canShare && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Filament to buy", text });
      return;
    } catch (error) {
      // Closing the share sheet is not an error; anything else falls back to copying.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("List copied", "Paste it wherever you keep your shopping.");
  } catch {
    toast.error("Couldn't copy the list", "Select the spools by hand instead.");
  }
}

/**
 * Spools to restock, under a threshold or short for a print on the bed, with the list to take to the shop.
 * One quiet surface; each row opens the spool.
 */
export function RunningLow({ low }: { low: readonly LowSpool[] }) {
  const isDesktop = useIsDesktop();
  if (!low.length) return null;
  return (
    <Section
      id="running-low"
      title="Running low"
      count={low.length}
      className="md:max-w-2xl xl:has-[li+li]:max-w-none"
      aside={
        <Button
          variant="secondary"
          size="sm"
          icon={CopyIcon}
          onClick={() => void shareList(shoppingList(low), !isDesktop)}
        >
          {isDesktop ? "Copy list" : "Share list"}
        </Button>
      }
    >
      <ul
        className="bg-cream shadow-soft overflow-hidden rounded-lg xl:has-[li+li]:grid xl:has-[li+li]:grid-cols-2"
        aria-label="Spools running low"
      >
        {low.map(({ spool, needs }) => {
          const name = spoolName(spool);
          return (
            <li
              key={spool.id}
              className="after:bg-hairline relative list-none after:absolute after:inset-x-4 after:bottom-0 after:h-px last:after:hidden xl:nth-last-2:odd:after:hidden"
            >
              <Link
                to="/pantry/$spoolId"
                params={{ spoolId: spool.id }}
                className="focus-ring hover:bg-ink/4 duration-fast flex min-h-16 items-center gap-3.5 px-4 py-2.5 transition-colors"
              >
                <SpoolDisc color={spool.colorHex} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="text-body text-ink block truncate font-semibold">{name.title}</span>
                  <span className="text-small text-ink-faint block truncate">{name.detail || spool.material}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <RemainingMeter remaining={spool.remaining} gramsLeft={spool.gramsLeft} showLabel />
                  {needs !== null && (
                    <Chip tone="semolina" className="tabular">
                      Print needs {gramsText(needs)}
                    </Chip>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
