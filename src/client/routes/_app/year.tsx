import { OUTCOME_LABELS } from "@shared/attempts";
import { fixSentence, type Insights, type RateRow } from "@shared/insights";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { OpenNotebook } from "@/components/illustrations";
import { MonthBars } from "@/components/insights/MonthBars";
import { RateRows } from "@/components/insights/RateRows";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Overline } from "@/components/ui/Overline";
import { Skeleton } from "@/components/ui/Skeleton";
import { insightsQuery } from "@/lib/insights";

export const Route = createFileRoute("/_app/year")({
  validateSearch: (search: Record<string, unknown>): { year?: number } => {
    const year = Number(search.year);
    return Number.isInteger(year) && year >= 2000 && year <= 2200 ? { year } : {};
  },
  component: Year,
});

function Year() {
  const { year: asked } = Route.useSearch();
  const year = asked ?? new Date().getFullYear();
  const { data } = useQuery(insightsQuery(year));
  const current = year === new Date().getFullYear();
  return (
    <>
      <PageHeader
        title={`${year}${current ? " so far" : ""}`}
        subtitle="What the prints add up to, and what has helped when they went wrong."
        actions={
          <Link to="/journal" className="text-small text-ink-soft hover:text-ink focus-ring rounded-md">
            Back to the journal
          </Link>
        }
      />
      {!data ? (
        <div className="flex flex-col gap-8" aria-hidden>
          <Skeleton className="h-16 w-72 max-w-full" />
          <Skeleton className="h-44 w-full rounded-xl md:max-w-3xl" />
        </div>
      ) : data.prints === 0 ? (
        <EmptyState className="py-10 md:py-20" illustration={<OpenNotebook />} title="Nothing printed yet this year">
          Once there are prints with a verdict, this page adds them up.
        </EmptyState>
      ) : (
        <Story insights={data} current={current} />
      )}
    </>
  );
}

const percent = (insights: Insights) => Math.round((insights.outcomes.success / insights.prints) * 100);

function Story({ insights, current }: { insights: Insights; current: boolean }) {
  const { outcomes } = insights;
  const through = current ? new Date().getMonth() : 11;
  return (
    <div className="flex flex-col gap-12 pb-10 md:gap-16 md:pb-16">
      <section aria-label="In numbers" className="flex flex-col gap-6 md:flex-row md:items-end md:gap-16">
        <Figure value={String(insights.prints)} words={insights.prints === 1 ? "print" : "prints"} />
        <Figure value={`${percent(insights)}%`} words="worked" tone="basil" />
        <p className="text-lead text-ink-soft max-w-sm md:pb-2">
          {outcomes.partial} came out {OUTCOME_LABELS.partial.toLowerCase()}, and{" "}
          <Link
            to="/journal"
            search={{ outcome: "failed" }}
            className="text-ink decoration-ink/30 hover:decoration-ink underline underline-offset-4"
          >
            {outcomes.failed} turned to spaghetti
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="by-month" className="flex flex-col gap-4 md:max-w-3xl">
        <Overline as="h2" id="by-month">
          Prints by month
        </Overline>
        <MonthBars months={insights.months} through={through} />
      </section>

      {(insights.byMaterial.length > 0 || insights.byPlate.length > 0) && (
        <div className="grid gap-12 md:max-w-4xl md:grid-cols-2 md:gap-16">
          {insights.byMaterial.length > 0 && (
            <Rates title="By material" id="by-material" rows={insights.byMaterial} link="material" />
          )}
          {insights.byPlate.length > 0 && <Rates title="By plate" id="by-plate" rows={insights.byPlate} />}
        </div>
      )}

      {insights.failures.length > 0 && (
        <section aria-labelledby="went-wrong" className="flex flex-col gap-5 md:max-w-3xl">
          <Overline as="h2" id="went-wrong">
            What went wrong, and what helped
          </Overline>
          <ul className="m-0 flex list-none flex-col gap-5 p-0">
            {insights.failures.map((failure) => {
              const fixed = fixSentence(failure.fixes);
              return (
                <li key={failure.slug} className="flex flex-col gap-0.5">
                  <Link
                    to="/search"
                    search={{ tag: failure.slug }}
                    className="font-display text-title text-ink focus-ring w-fit rounded-md"
                  >
                    {failure.label}
                    <span className="text-ink-faint tabular text-lead ml-2 font-sans">
                      {failure.count} {failure.count === 1 ? "time" : "times"}
                    </span>
                  </Link>
                  <p className="text-body text-ink-soft">
                    {fixed ? `It ${fixed}.` : "Nothing has fixed it yet: that is still to find."}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {insights.longestBuilds.length > 0 && (
        <section aria-labelledby="long-builds" className="flex flex-col gap-4 md:max-w-3xl">
          <Overline as="h2" id="long-builds">
            Took the most tries
          </Overline>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {insights.longestBuilds.map((build) => (
              <li key={build.itemId}>
                <Link
                  to="/builds/$buildId"
                  params={{ buildId: build.itemId }}
                  className="text-body text-ink focus-ring flex items-baseline gap-3 rounded-md font-semibold hover:underline"
                >
                  <span className="min-w-0 truncate">{build.title?.trim() || "Untitled build"}</span>
                  <span className="text-ink-faint tabular font-normal">{build.attempts} attempts</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Figure({ value, words, tone }: { value: string; words: string; tone?: "basil" }) {
  return (
    <p className="flex items-baseline gap-3">
      <span
        className={`font-display tabular text-[4.5rem] leading-none md:text-[6rem] ${tone === "basil" ? "text-basil-ink" : "text-ink"}`}
      >
        {value}
      </span>
      <span className="text-lead text-ink-soft">{words}</span>
    </p>
  );
}

function Rates({ title, id, rows, link }: { title: string; id: string; rows: RateRow[]; link?: "material" }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <Overline as="h2" id={id}>
        {title}
      </Overline>
      <RateRows
        rows={rows}
        label={
          link
            ? (row) => (
                <Link to="/journal" search={{ material: row.label }} className="focus-ring rounded-sm hover:underline">
                  {row.label}
                </Link>
              )
            : undefined
        }
      />
    </section>
  );
}
