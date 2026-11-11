import type { Item, Person } from "@shared/api";
import { monthLabel, summaryLine } from "@shared/journal";
import { backBurnerIdea } from "@shared/today";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { lazy, Suspense, useMemo } from "react";
import { PrintingCard } from "@/components/builds/PrintingCard";
import { EmptyPot, SpoolStrand } from "@/components/illustrations";
import { itemName } from "@/components/journal/JournalEntry";
import { PageHeader } from "@/components/shell/PageHeader";
import { BackBurner } from "@/components/today/BackBurner";
import { InThePrinter } from "@/components/today/InThePrinter";
import { Lately } from "@/components/today/Lately";
import { PickUpAgain, pickUpAgain } from "@/components/today/PickUpAgain";
import { UpNext, upNextIdeas } from "@/components/today/UpNext";
import { AutoHeight } from "@/components/ui/AutoHeight";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CheckIcon, PlusIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";
import { CardSkeleton, RowSkeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { printingAttempts } from "@/lib/builds";
import { useCapture } from "@/lib/capture";
import { useBuilds, useIdeas } from "@/lib/items";
import { journalQuery, summaryQuery } from "@/lib/journal";
import { duration, ease } from "@/lib/motion";
import { useScreenActions } from "@/lib/palette";
import { printerQuery, spoolsQuery } from "@/lib/pantry";
import { peopleQuery } from "@/lib/queries";
import { useDueUpkeep } from "@/lib/upkeep";
import { useIsDesktop } from "@/lib/use-media-query";
import { useNow } from "@/lib/use-now";

const UpkeepLine = lazy(() => import("@/components/today/UpkeepLine"));
const CommentsLine = lazy(() => import("@/components/today/CommentsLine"));

export const Route = createFileRoute("/_app/today")({
  component: Today,
});

const everything = new URLSearchParams();

/** This month, local time: where the journal's "so far" sentence counts from. */
function thisMonth(now: number) {
  const date = new Date(now);
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1,
  };
}

/**
 * The front door: what is printing, where to pick up again, what is loaded, what happened lately and one old
 * idea to look at again. Every section is drawn only when it has something to say, so a quiet day is a quiet
 * page; a brand-new notebook gets a welcome instead.
 */
function Today() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { setOpen } = useCapture();
  const now = useNow(60_000);
  const builds = useBuilds();
  const ideas = useIdeas();
  const via = useVia();
  const { data: people } = useQuery(peopleQuery);
  const byId = useMemo(() => new Map<string, Person>(people?.map((person) => [person.id, person])), [people]);
  const printer = useQuery(printerQuery);
  const spools = useQuery(spoolsQuery);
  const hasDueUpkeep = useDueUpkeep().length > 0;

  const month = thisMonth(now);
  const journal = useInfiniteQuery(journalQuery(everything));
  const summary = useQuery(summaryQuery(month.start, month.end));
  const page = journal.data?.pages[0];
  const items = useMemo(() => new Map<string, Item>(page?.items.map((item) => [item.id, item])), [page]);

  const live = printer.data?.bridge?.progress;
  const onBed = useMemo(() => printingAttempts(builds.items, now, live), [builds.items, now, live]);
  const onBedIds = useMemo(() => new Set(onBed.map(({ attempt }) => attempt.id)), [onBed]);
  const waiting = useMemo(() => pickUpAgain(builds.items), [builds.items]);
  const queued = useMemo(() => upNextIdeas(ideas.items), [ideas.items]);
  const burner = useMemo(() => backBurnerIdea(ideas.items, now), [ideas.items, now]);
  // The newest entries, without the print already shown on the bed.
  const entries = useMemo(
    () => (page?.entries ?? []).filter((entry) => !(entry.attemptId && onBedIds.has(entry.attemptId))),
    [page, onBedIds],
  );

  const toBuild = (buildId: string, attemptId: string) =>
    void navigate({ to: "/builds/$buildId", params: { buildId }, search: { attempt: attemptId, finish: "1" } });
  useScreenActions(
    "Today",
    onBed.slice(0, 3).map(({ item, attempt }) => ({
      id: `finish-${attempt.id}`,
      label: `Finish attempt ${attempt.number} of ${itemName(item).text}`,
      icon: CheckIcon,
      keywords: "finish print outcome done how did it go",
      run: () => toBuild(item.id, attempt.id),
    })),
  );

  const loading = builds.isPending || ideas.isPending;
  const brandNew = !loading && builds.items.length === 0 && ideas.items.length === 0;
  const hasPrinter = !!printer.data && Object.keys(printer.data.slots).length > 0 && (spools.data?.length ?? 0) > 0;
  const summaryText = summary.data ? summaryLine(summary.data) : "";
  const lately = entries.length > 0 || summaryText !== "";
  // "All quiet" only once everything that could fill the page has answered (not while offline with nothing saved:
  // a paused query isn't loading), or it would show first and then swap to the blocks.
  const settling = journal.isLoading || summary.isLoading || printer.isLoading || spools.isLoading;
  const quiet =
    !loading &&
    !settling &&
    !brandNew &&
    onBed.length === 0 &&
    waiting.length === 0 &&
    queued.length === 0 &&
    !burner &&
    !hasPrinter &&
    !lately;

  const subtitle = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const bedSection =
    onBed.length > 0 ? (
      <Section id="today-bed" title="On the bed" size="overline" count={onBed.length > 1 ? onBed.length : undefined}>
        {/* A print that gets its answer fades and collapses while the others move up; on phones the
            next one grows into the big card. With reduced motion everything is at its end state at once. */}
        <div className="flex flex-col">
          <AnimatePresence initial={false}>
            {onBed.map(({ item, attempt }, index) => (
              <m.div
                key={attempt.id}
                // The space under a card is its own padding, so a card that leaves takes its gap with it.
                className="pb-4 last:pb-0"
                exit={{
                  opacity: 0,
                  height: 0,
                  paddingBottom: 0,
                  overflow: "hidden",
                  // Faded before the collapse shows a clipped slice of it.
                  transition: reduce
                    ? { duration: 0 }
                    : { duration: duration.base, ease: ease.inOut, opacity: { duration: duration.fast } },
                }}
              >
                <AutoHeight trigger={isDesktop ? "row" : index > 0}>
                  <PrintingCard
                    compact={index > 0}
                    item={item}
                    attempt={attempt}
                    person={byId.get(attempt.createdBy)}
                    via={via(attempt.createdVia)}
                  />
                </AutoHeight>
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      </Section>
    ) : null;

  return (
    <>
      <PageHeader title="Today" subtitle={subtitle} />
      <div className="-mt-4 mb-6 empty:hidden">
        {hasDueUpkeep && (
          <Suspense fallback={null}>
            <UpkeepLine />
          </Suspense>
        )}
      </div>
      {brandNew ? (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<EmptyPot />}
          title="Nothing on the stove yet"
          action={
            <Button variant="secondary" icon={PlusIcon} onClick={() => setOpen(true)}>
              New idea
            </Button>
          }
        >
          Capture an idea or start a build. What's printing and what to pick up next will show here.
        </EmptyState>
      ) : quiet ? (
        <>
          {/* Nothing on the bed is exactly when a new message from the other person is worth a line. */}
          <div className="empty:hidden">
            <Suspense fallback={null}>
              <CommentsLine />
            </Suspense>
          </div>
          <EmptyState
            className="py-10 md:py-20"
            illustration={<SpoolStrand />}
            title="All quiet in the kitchen"
            action={
              <Link to="/ideas" className="focus-ring rounded-md">
                <Button variant="secondary" tabIndex={-1}>
                  See the ideas
                </Button>
              </Link>
            }
          >
            Nothing is printing and nothing is waiting. Pick an idea and put it on the bed.
          </EmptyState>
        </>
      ) : (
        // On a phone the blocks run in one column in the order below (bed, up next, pick up, printer, month, back burner).
        // From lg they sit in two columns; the wrappers vanish (display: contents) until then so `order` can mix them.
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-14">
          <div className="contents lg:flex lg:min-w-0 lg:flex-3 lg:flex-col lg:gap-10">
            <div className="order-1 empty:hidden">
              {loading ? (
                <div className="flex flex-col gap-4" aria-hidden>
                  <CardSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : (
                // The last print leaves the same way as the others, and the section with it.
                <AnimatePresence initial={false}>
                  {bedSection && (
                    <m.div
                      key="bed"
                      exit={{
                        opacity: 0,
                        scale: 0.98,
                        transition: { duration: reduce ? 0 : duration.base, ease: ease.inOut },
                      }}
                    >
                      {bedSection}
                    </m.div>
                  )}
                </AnimatePresence>
              )}
            </div>
            {/* Its own block right under what is on the bed, never above it: the print is the news, a comment a note. */}
            <div className="order-1 empty:hidden">
              {!loading && (
                <Suspense fallback={null}>
                  <CommentsLine />
                </Suspense>
              )}
            </div>
            <div className="order-3 empty:hidden">{!loading && <PickUpAgain builds={builds.items} />}</div>
            <div className="order-2 empty:hidden">{!loading && <UpNext ideas={ideas.items} />}</div>
            <div className="order-6 empty:hidden">
              {!loading && <BackBurner idea={burner} person={burner ? byId.get(burner.createdBy) : undefined} />}
            </div>
          </div>
          <div className="contents lg:sticky lg:top-8 lg:flex lg:min-w-0 lg:flex-2 lg:flex-col lg:gap-10">
            <div className="order-4 empty:hidden">
              {printer.data && spools.data && (
                <InThePrinter setup={printer.data.setup} slots={printer.data.slots} spools={spools.data} />
              )}
            </div>
            <div className="order-5 empty:hidden">
              <Lately
                label={`${monthLabel(month.start)} so far`}
                summary={summary.data ? summaryText : summary.isPending ? null : ""}
                entries={entries}
                items={items}
                people={byId}
                via={via}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
