import type { AttemptSettings } from "@shared/attempts";
import { notEnough, notEnoughText } from "@shared/ledger";
import { useQuery } from "@tanstack/react-query";
import { Caution } from "@/components/ui/Caution";
import { spoolsQuery } from "@/lib/pantry-queries";

/**
 * "Sunflower yellow has about 40 g left; this plate needs 66 g." A calm heads-up beside the filaments of a
 * print that hasn't used anything yet; the person decides, nothing is blocked.
 */
export function NotEnoughNote({
  settings,
  what = "this plate",
  className,
}: {
  settings: AttemptSettings;
  what?: string;
  className?: string;
}) {
  const { data: spools } = useQuery(spoolsQuery);
  const found = notEnough(settings, spools ?? []);
  if (!found.length) return null;
  return (
    <div className={className} data-testid="not-enough">
      {found.map((entry) => (
        <Caution key={entry.spoolId}>{notEnoughText(entry, what)}</Caution>
      ))}
    </div>
  );
}
