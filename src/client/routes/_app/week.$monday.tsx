import type { Person } from "@shared/api";
import { addWeeks, isMonday, mondayOf, mondayOfDay, weekName, weekRangeLabel } from "@shared/week";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { WeekLines } from "@/components/week/WeekLines";
import { WeekNav } from "@/components/week/WeekNav";
import { WeekPhotos } from "@/components/week/WeekPhotos";
import { somethingWaiting, WeekWaiting } from "@/components/week/WeekWaiting";
import { useCapture } from "@/lib/capture";
import { useHotkeys } from "@/lib/hotkeys";
import { peopleQuery } from "@/lib/queries";
import { useScoutEnabled } from "@/lib/scout";
import { prefetchNeighbours, weekQuery } from "@/lib/week";

const ScoutSection = lazy(() => import("@/components/scout/ScoutSection"));

export const Route = createFileRoute("/_app/week/$monday")({
  component: WeekRoute,
});

/** A day that isn't a Monday opens its own week; something that isn't a day opens this one. */
function WeekRoute() {
  const { monday } = Route.useParams();
  if (isMonday(monday)) return <WeekPage monday={monday} />;
  const own = mondayOfDay(monday) ?? mondayOf(Date.now());
  return <Navigate to="/week/$monday" params={{ monday: own }} replace />;
}

/**
 * One week, as a page turned in the notebook: the week's prints as photos, large, then a few quiet lines of what
 * happened and, for this week, what is waiting. Claude's paragraph, when there is one, comes first and says what the
 * numbers don't. Everything but that paragraph is computed and works without the key.
 */
function WeekPage({ monday }: { monday: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: week } = useQuery(weekQuery(monday));
  const { data: peopleList } = useQuery(peopleQuery);
  const people = useMemo(() => new Map<string, Person>((peopleList ?? []).map((p) => [p.id, p])), [peopleList]);
  const { setOpen: openCapture } = useCapture();
  const scoutOn = useScoutEnabled();

  const previous = addWeeks(monday, -1);
  const next = monday < mondayOf(Date.now()) ? addWeeks(monday, 1) : null;
  const go = (to: string) => void navigate({ to: "/week/$monday", params: { monday: to } });
  useHotkeys({ weekPrevious: () => go(previous), weekNext: next ? () => go(next) : undefined });

  // The weeks either side, once this one is up: ← and → then answer at once.
  const loaded = !!week;
  useEffect(() => {
    if (loaded) prefetchNeighbours(queryClient, previous, next);
  }, [loaded, queryClient, previous, next]);

  const named = weekName(monday);
  const dated = named === weekRangeLabel(monday);
  return (
    <>
      <PageHeader title={named} subtitle={dated ? undefined : weekRangeLabel(monday)} />
      <div className="flex flex-col gap-10 pb-10 md:gap-12 md:pb-16">
        <WeekNav monday={monday} />
        {!week ? (
          <Loading />
        ) : (
          <>
            {week.note && <Note note={week.note} />}
            {week.empty ? (
              <EmptyState
                className="py-6 md:py-12"
                illustration={<EmptyPot />}
                title={week.current ? "Nothing simmering yet" : "Not a strand this week"}
                action={
                  week.current ? (
                    <Button variant="secondary" onClick={() => openCapture(true)}>
                      Capture an idea
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => go(mondayOf(Date.now()))}>
                      Back to this week
                    </Button>
                  )
                }
              >
                {week.current
                  ? "No prints, ideas or comments so far this week. The first one lands here."
                  : "No prints, ideas or comments between Monday and Sunday. Sometimes the pot just sits."}
              </EmptyState>
            ) : (
              <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-x-16">
                <WeekPhotos prints={week.made} people={people} />
                <div className="flex min-w-0 flex-col gap-10 lg:col-start-2 lg:row-start-1">
                  <WeekLines week={week} people={people} />
                </div>
              </div>
            )}
            {scoutOn && week.current && (
              <Suspense fallback={null}>
                <ScoutSection where="week" showEmpty={!week.empty} />
              </Suspense>
            )}
            {somethingWaiting(week.waiting) && <WeekWaiting waiting={week.waiting} />}
          </>
        )}
      </div>
    </>
  );
}

/** Claude's paragraph, or the quiet line that says it is being written. Only says; never changes anything. */
function Note({ note }: { note: { status: "thinking" | "done"; text: string | null } }) {
  if (note.status === "thinking") return <ClaudeLine working>Looking back at the week…</ClaudeLine>;
  return (
    <section aria-label="Claude on the week" className="max-w-content flex flex-col gap-2.5">
      <ClaudeLine>Claude on the week</ClaudeLine>
      <p className="font-display text-title text-ink text-pretty">{note.text}</p>
    </section>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <Skeleton className="aspect-4/3 w-full max-w-xl rounded-lg" />
      <Skeleton className="h-5 w-72 max-w-full" />
      <Skeleton className="h-5 w-56 max-w-full" />
    </div>
  );
}
