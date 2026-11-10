import type { Spool } from "@shared/api";
import { DRY_IT, needsDrying } from "@shared/drying";
import { slotPlace, spoolName } from "@shared/spools";
import { useDryingDays } from "@/lib/drying";

/** One sentence, at most, about the first loaded spool past its drying window. */
export default function DryMention({ loaded }: { loaded: Array<{ slot: string; spool?: Spool }> }) {
  const days = useDryingDays();
  const damp = loaded.find((entry) => entry.spool && needsDrying(entry.spool, Date.now(), days));
  if (!damp?.spool) return null;
  return (
    <p className="text-small text-ink-soft">
      {spoolName(damp.spool).title} {slotPlace(damp.slot)}: {DRY_IT.toLowerCase()}.
    </p>
  );
}
