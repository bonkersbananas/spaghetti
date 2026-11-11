import type { Spool } from "@shared/api";
import { OUTCOME_LABELS } from "@shared/attempts";
import { gramsText } from "@shared/ledger";
import { daysAgo } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { MetaList } from "@/components/ui/MetaList";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { Section } from "@/components/ui/Section";
import { spoolUsageQuery } from "@/lib/pantry-queries";

/**
 * Grams left as the page's one big figure, with the two things to do about it: weigh the spool, or
 * change what it held when new. "About" because prints come off by the slicer's estimate.
 */
export function GramsHero({
  spool,
  disabled,
  onWeigh,
  onSetWeight,
}: {
  spool: Spool;
  disabled?: boolean;
  onWeigh: () => void;
  onSetWeight: () => void;
}) {
  const { gramsLeft, netGrams } = spool;
  if (gramsLeft === null) return null;
  const since = spool.weighedAt ? `weighed ${daysAgo(spool.weighedAt)}` : "since new";
  return (
    <section
      aria-labelledby="grams-left"
      className="bg-cream shadow-soft flex flex-col gap-4 rounded-xl p-5 md:max-w-md"
    >
      <div className="flex flex-col gap-1">
        <span id="grams-left" className="text-small text-ink-soft font-semibold">
          Left on the spool
        </span>
        <span className="text-display text-ink tabular leading-none">
          <span className="text-small text-ink-faint mr-1.5 font-sans font-medium">about</span>
          {gramsText(gramsLeft)}
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-x-3">
          <RemainingMeter remaining={spool.remaining} showLabel />
          <MetaList className="text-small text-ink-faint">
            {[netGrams ? `of ${gramsText(netGrams)}` : "", since].filter(Boolean).map((piece) => (
              <span key={piece}>{piece}</span>
            ))}
          </MetaList>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={disabled} onClick={onWeigh}>
          Weigh it
        </Button>
        <Button variant="quiet" size="sm" disabled={disabled} onClick={onSetWeight}>
          Set the weight
        </Button>
      </div>
    </section>
  );
}

/** What used the spool, newest first, quietly: "Bath tugboat, attempt 3 · 66 g". */
export function UsedBy({ spool }: { spool: Spool }) {
  const { data } = useQuery(spoolUsageQuery(spool.id));
  if (spool.gramsLeft === null || !data) return null;
  const rows = [
    ...data.usage.map((entry) => ({ at: entry.at, kind: "used" as const, entry })),
    ...data.weighings.map((weighing) => ({ at: weighing.at, kind: "weighed" as const, weighing })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  if (!rows.length) return null;
  return (
    <Section id="used-by" title="What used it">
      <ul className="flex flex-col gap-2.5 md:max-w-md">
        {rows.map((row) => (
          <li
            key={row.kind === "used" ? row.entry.attemptId : row.weighing.id}
            className="text-body flex items-baseline justify-between gap-4"
          >
            {row.kind === "used" ? (
              <>
                <Link
                  to="/builds/$buildId"
                  params={{ buildId: row.entry.itemId }}
                  className="focus-ring text-ink min-w-0 truncate rounded-sm hover:underline"
                >
                  {row.entry.title || "Untitled build"}, attempt {row.entry.number}
                  <span className="text-ink-faint"> · {OUTCOME_LABELS[row.entry.outcome].toLowerCase()}</span>
                </Link>
                <span className="text-ink-soft tabular shrink-0">
                  {row.entry.approximate ? "about " : ""}
                  {gramsText(row.entry.grams)}
                  {!row.entry.counted && <span className="sr-only"> (before the last weighing)</span>}
                </span>
              </>
            ) : (
              <>
                <span className="text-ink-soft">Weighed {daysAgo(row.weighing.at)}</span>
                <span className="text-ink tabular shrink-0 font-semibold">
                  {gramsText(row.weighing.gramsLeft)} left
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
