import { OUTCOME_LABELS, type Outcome } from "@shared/attempts";
import { fixSentence, type Insights, type LongBuild, type RateRow } from "@shared/insights";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { outcomeDots } from "@/components/builds/Outcome";
import { OutcomeStrip } from "@/components/builds/OutcomeStrip";
import { OpenNotebook } from "@/components/illustrations";
import { MonthBars } from "@/components/insights/MonthBars";
import { Mosaic } from "@/components/insights/Mosaic";
import { RateRows } from "@/components/insights/RateRows";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Overline } from "@/components/ui/Overline";
import { Photo } from "@/components/ui/Photo";
import { Skeleton } from "@/components/ui/Skeleton";
import { insightsQuery } from "@/lib/insights";
import { photoSrc } from "@/lib/previews";

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

const sentenceLink = "whitespace-nowrap text-ink decoration-ink/30 hover:decoration-ink underline underline-offset-4";

const percent = (insights: Insights) => Math.round((insights.outcomes.success / insights.prints) * 100);

function Story({ insights, current }: { insights: Insights; current: boolean }) {
  const { outcomes } = insights;
  const through = current ? new Date().getMonth() : 11;
  return (
    <div className="grid gap-12 pb-10 md:pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-x-20 lg:gap-y-16">
      <section
        aria-label="In numbers"
        className="flex flex-row flex-wrap items-end gap-x-8 gap-y-5 md:gap-16 lg:col-span-2"
      >
        <Figure value={String(insights.prints)} words={insights.prints === 1 ? "print" : "prints"} />
        <Figure value={`${percent(insights)}%`} words="worked" tone="basil" dot="success" />
        <p className="text-lead text-ink-soft w-full text-balance">
          <Link to="/journal" search={{ outcome: "partial" }} className={sentenceLink}>
            <Dot outcome="partial" />
            {outcomes.partial} came out {OUTCOME_LABELS.partial.toLowerCase()}
          </Link>
          , and{" "}
          <Link to="/journal" search={{ outcome: "failed" }} className={sentenceLink}>
            <Dot outcome="failed" />
            {outcomes.failed} turned to spaghetti
          </Link>
          .
        </p>
      </section>

      {insights.made.length > 0 && (
        <div className="contents lg:col-start-2 lg:row-start-3 lg:flex lg:flex-col lg:gap-12">
          <section aria-labelledby="made" className="flex flex-col gap-4">
            <Overline as="h2" id="made">
              What got made
            </Overline>
            <Mosaic builds={insights.made} total={insights.madeTotal} />
          </section>
          {insights.longestBuilds.length > 0 && <Tries builds={insights.longestBuilds} />}
        </div>
      )}

      <section aria-labelledby="by-month" className="flex flex-col gap-4 lg:col-span-2 lg:row-start-2">
        <Overline as="h2" id="by-month">
          Prints by month
        </Overline>
        <MonthBars months={insights.months} through={through} />
      </section>

      <div className="contents lg:col-start-1 lg:row-start-3 lg:flex lg:flex-col lg:gap-16">
        {(insights.byMaterial.length > 0 || insights.byPlate.length > 0) && (
          <div className="grid gap-12 md:grid-cols-2 md:gap-12">
            {insights.byMaterial.length > 0 && (
              <Rates title="By material" id="by-material" rows={insights.byMaterial} link="material" />
            )}
            {insights.byPlate.length > 0 && <Rates title="By plate" id="by-plate" rows={insights.byPlate} />}
          </div>
        )}

        {insights.failures.length > 0 && (
          <section aria-labelledby="went-wrong" className="flex flex-col gap-5">
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
                      {fixed
                        ? `${fixed.charAt(0).toUpperCase()}${fixed.slice(1)}.`
                        : "Nothing has fixed it yet: that is still to find."}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {insights.made.length === 0 && insights.longestBuilds.length > 0 && (
        <div className="lg:col-start-2 lg:row-start-3">
          <Tries builds={insights.longestBuilds} />
        </div>
      )}
    </div>
  );
}

/** The builds that took the most attempts: their picture, name and how each attempt went. */
function Tries({ builds }: { builds: LongBuild[] }) {
  return (
    <div className="flex flex-col gap-3">
      <Overline as="h3">Took the most tries</Overline>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {builds.map((build) => (
          <li key={build.itemId}>
            <Link
              to="/builds/$buildId"
              params={{ buildId: build.itemId }}
              className="pressable focus-ring hover:bg-ink/4 -mx-2 flex items-center gap-3.5 rounded-lg p-2"
            >
              {build.photo ? (
                <Photo
                  src={photoSrc(build.photo.id, "thumb")}
                  alt=""
                  color={build.photo.color}
                  className="size-14 shrink-0 rounded-md"
                />
              ) : (
                <span className="bg-well size-14 shrink-0 rounded-md" aria-hidden />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-body text-ink truncate font-semibold">
                  {build.title?.trim() || "Untitled build"}
                </span>
                <span className="flex items-center gap-2.5">
                  <OutcomeStrip
                    attempts={build.outcomes.map((outcome, index) => ({
                      id: String(index),
                      number: index + 1,
                      outcome,
                    }))}
                  />
                  <span className="text-small text-ink-faint tabular">{build.attempts} attempts</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small outcome dot in the color the bars use, so a sentence explains the chart. Decorative: the words say it. */
function Dot({ outcome }: { outcome: Outcome }) {
  return (
    <span aria-hidden className={`${outcomeDots[outcome]} mr-2 inline-block size-2.5 rounded-full align-middle`} />
  );
}

function Figure({ value, words, tone, dot }: { value: string; words: string; tone?: "basil"; dot?: Outcome }) {
  return (
    <p className="flex items-baseline gap-3">
      <span className={`font-display tabular text-figure ${tone === "basil" ? "text-basil-ink" : "text-ink"}`}>
        {value}
      </span>
      <span className="text-lead text-ink-soft">
        {dot && <Dot outcome={dot} />}
        {words}
      </span>
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
