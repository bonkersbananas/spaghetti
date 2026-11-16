import type { Person } from "@shared/api";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useMemo } from "react";
import { BuildCard, BuildRow } from "@/components/builds/BuildCard";
import { SpoolStrand } from "@/components/illustrations/SpoolStrand";
import { PageHeader } from "@/components/shell/PageHeader";
import { RecentlyDeletedLink } from "@/components/shell/RecentlyDeletedLink";
import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { Reflow } from "@/components/ui/Reflow";
import { Section as PageSection } from "@/components/ui/Section";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { createBuild, lastActivity, printingAttempts } from "@/lib/builds";
import { type ItemView, useBuilds } from "@/lib/items";
import { useListPicker } from "@/lib/list-picker";
import { useArrived } from "@/lib/live";
import { printerQuery } from "@/lib/pantry-queries";
import { peopleQuery, sessionQuery } from "@/lib/queries";
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
  const newBuild = useNewBuild();
  const isDesktop = useIsDesktop();
  const now = useNow(60_000);
  const live = useQuery(printerQuery).data?.bridge?.progress;

  const onBed = useMemo(() => printingAttempts(items, now, live), [items, now, live]);
  const onBedIds = new Set(onBed.map(({ item }) => item.id));
  const inProgress = items.filter((item) => item.stage === "building" && !onBedIds.has(item.id)).sort(byActivity);
  const done = items.filter((item) => item.stage === "done").sort(byFinished);
  const shelved = items.filter((item) => item.stage === "shelved").sort(byFinished);

  return (
    <>
      <PageHeader
        title="Builds"
        subtitle="From idea to finished print, attempt by attempt."
        actions={
          // An empty list has its own "Start a build": one way to start, not two.
          (isPending || items.length > 0) && (
            <Button variant="secondary" icon={PlusIcon} onClick={newBuild}>
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
        <BuildsEmpty onNew={newBuild} />
      ) : (
        <div className="flex flex-col gap-12 md:gap-16">
          {/* Only what is physically on the plate; with nothing there the section isn't drawn. */}
          {onBed.length > 0 && (
            <Section title="On the bed" count={onBed.length > 1 ? onBed.length : undefined}>
              <Suspense fallback={<Skeleton className="h-44 rounded-lg" />}>
                <BedCards prints={onBed} people={byId} via={via} spread />
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
              <ul data-picks className="grid gap-1 md:grid-cols-2 md:gap-x-6 xl:grid-cols-3" aria-label="Done">
                {done.map((item) => (
                  <BuildRow key={item.id} item={item} />
                ))}
              </ul>
            </Section>
          )}
          {shelved.length > 0 && (
            <Section title="On the shelf" count={shelved.length} quiet>
              <ul data-picks className="grid gap-1 md:grid-cols-2 md:gap-x-6 xl:grid-cols-3" aria-label="On the shelf">
                {shelved.map((item) => (
                  <BuildRow key={item.id} item={item} />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
      {!isPending && <RecentlyDeletedLink />}
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

/** Starts an empty build and opens it, with the title ready to type. */
function useNewBuild() {
  const navigate = useNavigate();
  const { data: user } = useSuspenseQuery(sessionQuery);
  return () => {
    if (!user) return;
    const id = createBuild(user.id);
    void navigate({ to: "/builds/$buildId", params: { buildId: id }, search: { new: true } });
  };
}

function BuildsEmpty({ onNew }: { onNew: () => void }) {
  const isDesktop = useIsDesktop();
  return (
    <EmptyState
      illustration={<SpoolStrand />}
      title="Nothing cooking yet"
      action={
        <Button variant={isDesktop ? "secondary" : "primary"} icon={PlusIcon} onClick={onNew}>
          Start a build
        </Button>
      }
    >
      When an idea is ready to print, start building from it, or start one from scratch here. Every attempt, setting and
      photo gets tracked.
    </EmptyState>
  );
}
