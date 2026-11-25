import type { Person } from "@shared/api";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { BuildCard, BuildRow, BuildTile } from "@/components/builds/BuildCard";
import { LazyStartBuildSheet } from "@/components/builds/LazyStartBuildSheet";
import { SpoolStrand } from "@/components/illustrations/SpoolStrand";
import { PageHeader } from "@/components/shell/PageHeader";
import { RecentlyDeletedLink } from "@/components/shell/RecentlyDeletedLink";
import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { printTileGrid } from "@/components/ui/PrintTile";
import { Reflow } from "@/components/ui/Reflow";
import { Section as PageSection } from "@/components/ui/Section";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { createBuild, lastActivity, printingAttempts } from "@/lib/builds";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { type ItemView, sweepUntouched, useBuilds } from "@/lib/items";
import { useListPicker } from "@/lib/list-picker";
import { useArrived } from "@/lib/live";
import { printerQuery } from "@/lib/pantry-queries";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { unreadQuery } from "@/lib/unread-comments";
import { useIsDesktop } from "@/lib/use-media-query";
import { useNow } from "@/lib/use-now";

// The printing cards come with their own code (progress, outcome buttons, the camera): only a list with something on
// the bed loads it, so the first load stays as light as the grid.
const BedCards = lazy(() =>
  import("@/components/builds/PrintingCard").then((module) => ({ default: module.BedCards })),
);

export const Route = createFileRoute("/_app/builds/")({
  component: Builds,
});

/** The same grid as the ideas inbox: two columns on phones, more on desktop. */
const grid = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4";

/** The newest three finished builds lead, large (the grid decides how many show so by width). */
const LEADING = [0, 1, 2] as const;

/** Done shows this many, then "N more": a long list of finished prints stays a calm field, not a wall. */
const DONE_SHOWN = 11;

/** What was worked on most recently first. */
const byActivity = (a: ItemView, b: ItemView) => lastActivity(b) - lastActivity(a);

const byFinished = (a: ItemView, b: ItemView) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt);

/**
 * Builds, in the order you'd look standing at the printer: what is on the bed (printing, or off the bed and waiting
 * for "how did it go?") as the same big cards as Today, then the builds in progress between prints, then the
 * quieter Done and On the shelf.
 */
function Builds() {
  useListPicker();
  const { items, isPending } = useBuilds();
  const { data: people } = useQuery(peopleQuery);
  const byId = useMemo(() => new Map<string, Person>(people?.map((person) => [person.id, person])), [people]);
  const arrived = useArrived();
  const via = useVia();
  const queryClient = useQueryClient();
  const fromScratch = useNewBuild();
  const [picking, setPicking] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const newBuild = () => setPicking(true);
  useHotkeys({ buildStart: isPending ? undefined : newBuild });
  // A blank build left by closing the tab on it is cleared at the next visit.
  useEffect(() => {
    if (!isPending) sweepUntouched(queryClient, items);
  }, [isPending, items, queryClient]);
  const isDesktop = useIsDesktop();
  const now = useNow(60_000);
  const live = useQuery(printerQuery).data?.bridge?.progress;
  // The grid's cards show unread comments on their corner, and so do the prints on the bed (BuildCard has the module).
  const threads = useQuery(unreadQuery).data?.threads;
  const unread = (itemId: string) => threads?.find((thread) => thread.itemId === itemId)?.count ?? 0;

  const onBed = useMemo(() => printingAttempts(items, now, live), [items, now, live]);
  const onBedIds = new Set(onBed.map(({ item }) => item.id));
  const inProgress = items.filter((item) => item.stage === "building" && !onBedIds.has(item.id)).sort(byActivity);
  const done = items.filter((item) => item.stage === "done").sort(byFinished);
  // A few over the limit are all shown: "2 more" would hide less than the button costs.
  const shownDone = allDone || done.length <= DONE_SHOWN + 3 ? done : done.slice(0, DONE_SHOWN);
  const hiddenDone = done.length - shownDone.length;
  const shelved = items.filter((item) => item.stage === "shelved").sort(byFinished);

  return (
    <>
      <PageHeader
        title="Builds"
        subtitle="From idea to finished print, attempt by attempt."
        actions={
          // An empty list has its own "Start a build": one way to start, not two.
          (isPending || items.length > 0) && (
            <Button variant="secondary" icon={PlusIcon} onClick={newBuild} shortcut={shortcutCaps("buildStart")}>
              New build
            </Button>
          )
        }
      />
      {isPending ? (
        <div className={grid} aria-hidden>
          {Array.from({ length: 4 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <CardSkeleton key={index} aspect="portrait" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <BuildsEmpty onNew={newBuild} onScratch={fromScratch} />
      ) : (
        <div className="flex flex-col gap-12 md:gap-16">
          {/* Only what is physically on the plate; with nothing there the section isn't drawn. */}
          {onBed.length > 0 && (
            <Section title="On the bed" count={onBed.length > 1 ? onBed.length : undefined}>
              <Suspense fallback={<Skeleton className="h-44 rounded-lg" />}>
                {/* J and K walk these too, before the In progress grid. */}
                <div data-picks>
                  <BedCards prints={onBed} people={byId} via={via} unread={unread} spread />
                </div>
              </Suspense>
            </Section>
          )}
          {/* Everything in progress on the bed: no section for nothing, as with an empty bed. */}
          {(inProgress.length > 0 || onBed.length === 0) && (
            <Section
              title="In progress"
              count={inProgress.length || undefined}
              description={
                inProgress.length === 0 && <p className="text-body text-ink-soft">Nothing in progress right now.</p>
              }
            >
              <ul data-picks className={`${grid} relative empty:hidden`} aria-label="In progress">
                <Reflow>
                  {inProgress.map((item) => (
                    <BuildCard
                      key={item.id}
                      item={item}
                      person={byId.get(item.createdBy)}
                      via={via(item.createdVia)}
                      landing={arrived.has(item.id)}
                    />
                  ))}
                </Reflow>
              </ul>
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Done" count={done.length} quiet>
              <ul data-picks className={printTileGrid} aria-label="Done">
                {shownDone.map((item, index) => (
                  <BuildTile key={item.id} item={item} lead={LEADING[index]} />
                ))}
              </ul>
              {hiddenDone > 0 && (
                <Button variant="quiet" size="sm" className="mt-4" onClick={() => setAllDone(true)}>
                  {hiddenDone} more
                </Button>
              )}
            </Section>
          )}
          {shelved.length > 0 && (
            <Section title="On the shelf" count={shelved.length} quiet>
              <ul
                data-picks
                className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-x-6 xl:grid-cols-3"
                aria-label="On the shelf"
              >
                {shelved.map((item) => (
                  <BuildRow key={item.id} item={item} />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
      {!isPending && <RecentlyDeletedLink />}
      <LazyStartBuildSheet open={picking} onOpenChange={setPicking} onFromScratch={fromScratch} />
      {/* The list's add-action on phones, as on every list: a floating button over the tab bar. */}
      {!isPending && items.length > 0 && !isDesktop && (
        <ActionBar>
          <Button variant="floating" size="lg" icon={PlusIcon} onClick={newBuild} className="mx-auto">
            New build
          </Button>
        </ActionBar>
      )}
    </>
  );
}

function Section({
  title,
  count,
  quiet,
  description,
  children,
}: {
  title: string;
  count?: number;
  quiet?: boolean;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageSection
      id={`builds-${title.toLowerCase().replace(/\W+/g, "-")}`}
      title={title}
      size={quiet ? "title" : "headline"}
      count={count}
      description={description}
    >
      {children}
    </PageSection>
  );
}

/** Starts an empty build and opens it (From scratch, here and in the picker), with the title ready to type. */
function useNewBuild() {
  const navigate = useNavigate();
  const { data: user } = useSuspenseQuery(sessionQuery);
  return () => {
    if (!user) return;
    const id = createBuild(user.id);
    void navigate({ to: "/builds/$buildId", params: { buildId: id }, search: { new: true } });
  };
}

function BuildsEmpty({ onNew, onScratch }: { onNew: () => void; onScratch: () => void }) {
  const isDesktop = useIsDesktop();
  return (
    <EmptyState
      illustration={<SpoolStrand />}
      title="Nothing cooking yet"
      action={
        <div className="flex flex-col items-center gap-2">
          <Button variant={isDesktop ? "secondary" : "primary"} onClick={onNew}>
            Pick an idea to print
          </Button>
          <Button variant="quiet" size="sm" onClick={onScratch}>
            From scratch
          </Button>
        </div>
      }
    >
      A build follows one print from the first try to the one that worked: every attempt, setting and photo.
    </EmptyState>
  );
}
