import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BuildCard, BuildRow, lastActivity } from "@/components/builds/BuildCard";
import { SpoolStrand } from "@/components/illustrations/SpoolStrand";
import { PageHeader } from "@/components/shell/PageHeader";
import { RecentlyDeletedLink } from "@/components/shell/RecentlyDeletedLink";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { AddPhotoTile } from "@/components/ui/PhotoTiles";
import { Reflow } from "@/components/ui/Reflow";
import { Section as PageSection } from "@/components/ui/Section";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { createBuild } from "@/lib/builds";
import { type ItemView, useBuilds } from "@/lib/items";
import { useListPicker } from "@/lib/list-picker";
import { useArrived } from "@/lib/live";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/builds/")({
  component: Builds,
});

/** The same grid as the ideas inbox: two columns on phones, more on desktop. */
const grid = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4";

const isPrinting = (item: ItemView) => item.attempts.some((attempt) => attempt.outcome === null);

/** What's printing first, then what was worked on most recently. */
function byActivity(a: ItemView, b: ItemView) {
  return Number(isPrinting(b)) - Number(isPrinting(a)) || lastActivity(b) - lastActivity(a);
}

const byFinished = (a: ItemView, b: ItemView) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt);

function Builds() {
  useListPicker();
  const { items, isPending } = useBuilds();
  const { data: people } = useQuery(peopleQuery);
  const byId = new Map(people?.map((person) => [person.id, person]));
  const arrived = useArrived();
  const via = useVia();
  const newBuild = useNewBuild();
  const isDesktop = useIsDesktop();

  const active = items.filter((item) => item.stage === "building").sort(byActivity);
  const done = items.filter((item) => item.stage === "done").sort(byFinished);
  const shelved = items.filter((item) => item.stage === "shelved").sort(byFinished);

  return (
    <>
      <PageHeader title="Builds" subtitle="From idea to finished print, attempt by attempt." />
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
          <Section title="On the bed" count={active.length}>
            <ul data-picks className={`${grid} relative`} aria-label="On the bed">
              <Reflow>
                {active.map((item) => (
                  <BuildCard
                    key={item.id}
                    item={item}
                    person={byId.get(item.createdBy)}
                    via={via(item.createdVia)}
                    landing={arrived.has(item.id)}
                  />
                ))}
              </Reflow>
              <li className="col-span-2 list-none md:col-span-1">
                {isDesktop ? (
                  <AddPhotoTile size="card" icon={PlusIcon} label="New build" onClick={newBuild} />
                ) : (
                  <AddPhotoTile size="row" icon={PlusIcon} label="New build" onClick={newBuild} />
                )}
              </li>
            </ul>
          </Section>
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
    </>
  );
}

function Section({
  title,
  count,
  quiet,
  children,
}: {
  title: string;
  count: number;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <PageSection
      id={`builds-${title.toLowerCase().replace(/\W+/g, "-")}`}
      title={title}
      size={quiet ? "title" : "headline"}
      count={count}
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
      className="py-10 md:py-20"
      illustration={<SpoolStrand />}
      title="Nothing on the bed"
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
