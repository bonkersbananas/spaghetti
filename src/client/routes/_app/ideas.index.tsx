import { modelOf } from "@shared/model-mark";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { IdeaCard, type UpNextMenu } from "@/components/ideas/IdeaCard";
import { StartedIdeas, startedIdeas } from "@/components/ideas/StartedIdeas";
import { UpNextStrip } from "@/components/ideas/UpNextStrip";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { PageHeader } from "@/components/shell/PageHeader";
import { RecentlyDeletedLink } from "@/components/shell/RecentlyDeletedLink";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { Reflow } from "@/components/ui/Reflow";
import { Section } from "@/components/ui/Section";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { useCapture } from "@/lib/capture";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { useBuilds, useIdeas } from "@/lib/items";
import { useListPicker } from "@/lib/list-picker";
import { useArrived } from "@/lib/live";
import { scrollBehavior } from "@/lib/motion";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { dropUpNext, moveUpNext, setUpNext, splitQueue } from "@/lib/up-next";
import { useAfterPaint, useIsDesktop } from "@/lib/use-media-query";

// The way to the wishlists on phones: on demand, so desktop (which has the sidebar) never loads it.
const WishlistLink = lazy(() =>
  import("@/components/wishlist/WishlistLink").then((m) => ({ default: m.WishlistLink })),
);

export const Route = createFileRoute("/_app/ideas/")({
  component: Ideas,
});

/** The inbox's grid: two columns on phones, more on desktop. */
const gridClass = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4";

/** How many cards a phone (or a laptop) shows before it scrolls: the rest draw after the first paint (useAfterPaint). */
const FIRST_SCREEN = { phone: 8, desktop: 12 };

function Ideas() {
  useListPicker();
  const after = useAfterPaint();
  const { items: all, isPending, error, refetch } = useIdeas();
  const { queue, rest: inbox } = splitQueue(all);
  // "Has a model" / "Needs designing", beside The rest: one tap each, tap again to see everything. They narrow the
  // inbox, not Up next (already picked), and are only offered once an idea there has a model.
  const [modelFilter, setModelFilter] = useState<"model" | "design" | null>(null);
  const modelCount = inbox.filter((item) => modelOf(item)).length;
  const filter = modelCount > 0 ? modelFilter : null;
  const everything = filter ? inbox.filter((item) => !!modelOf(item) === (filter === "model")) : inbox;
  // Ideas that were started stay here, after the rest: they are the builds that began as an idea.
  const { items: builds } = useBuilds();
  const started = startedIdeas(builds);
  const { data: people } = useQuery(peopleQuery);
  const { data: user } = useQuery(sessionQuery);
  const me = user?.id;
  const { landed } = useCapture();
  const arrived = useArrived();
  // Up next and the wishlists come first, so on a phone an idea you just captured can land under the fold: bring it
  // into view, so you see it land.
  useEffect(() => {
    if (!landed) return;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector(`main [data-picks] a[href^="/ideas/${landed}"]`);
      if (card && card.getBoundingClientRect().top > window.innerHeight * 0.6) {
        card.scrollIntoView({ block: "center", behavior: scrollBehavior() });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [landed]);
  const via = useVia();
  const byId = new Map(people?.map((person) => [person.id, person]));
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  // The cards below the fold wait for the first paint, so a tap on Ideas (or on a delete that lands here) shows the top
  // of the grid at once; a return to the page draws it whole, for the scroll position the router restores.
  const rest = after ? everything : everything.slice(0, isDesktop ? FIRST_SCREEN.desktop : FIRST_SCREEN.phone);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const menuFor = (item: (typeof all)[number], index: number): UpNextMenu => ({
    queued: index >= 0,
    onToggle: () => setUpNext(queryClient, item, index < 0),
    onMoveUp: index > 0 ? () => moveUpNext(queryClient, queue, item.id, -1) : undefined,
    onMoveDown: index >= 0 && index < queue.length - 1 ? () => moveUpNext(queryClient, queue, item.id, 1) : undefined,
    wish: item,
  });
  // U, [ and ] act on the card J and K stopped on: the keyboard's way to the card's menu. A moved card keeps the focus.
  const picked = () => {
    const href = document.activeElement?.closest("main [data-picks] a[href^='/ideas/']")?.getAttribute("href");
    const id = href?.split("/").pop();
    return id ? all.find((idea) => idea.id === id) : undefined;
  };
  const onPicked =
    (act: (idea: (typeof all)[number]) => void, toggles = false) =>
    () => {
      const idea = picked();
      if (!idea || idea.pending) return;
      const queued = queue.some((item) => item.id === idea.id);
      act(idea);
      // The card lands elsewhere in the page: the focused node is replaced, so find it again once it has, where it is
      // now (U moves it between Up next and the inbox). The copy it left fades out a moment longer, and focus there
      // would leave with it.
      const list = queued !== toggles ? "[aria-label='Up next']" : ":not([aria-label='Up next'])";
      requestAnimationFrame(() =>
        setTimeout(
          () => document.querySelector<HTMLElement>(`main [data-picks]${list} a[href="/ideas/${idea.id}"]`)?.focus(),
          0,
        ),
      );
    };
  useHotkeys({
    listUpNext: isDesktop
      ? onPicked((idea) => setUpNext(queryClient, idea, !queue.some((queued) => queued.id === idea.id)), true)
      : undefined,
    listMoveEarlier: isDesktop ? onPicked((idea) => moveUpNext(queryClient, queue, idea.id, -1)) : undefined,
    listMoveLater: isDesktop ? onPicked((idea) => moveUpNext(queryClient, queue, idea.id, 1)) : undefined,
  });
  const card = (item: (typeof all)[number]) => (
    <IdeaCard
      key={item.id}
      item={item}
      person={byId.get(item.createdBy)}
      via={via(item.createdVia)}
      landing={item.id === landed || arrived.has(item.id)}
      headingLevel={queue.length > 0 ? 3 : 2}
      menu={menuFor(item, -1)}
    />
  );
  const filters = modelCount > 0 && (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset.
    <div role="group" aria-label="Filter ideas" className="-ml-2.5 flex flex-wrap items-baseline">
      <ToggleChip
        appearance="quiet"
        selected={filter === "model"}
        count={modelCount}
        onClick={() => setModelFilter(filter === "model" ? null : "model")}
      >
        Has a model
      </ToggleChip>
      <ToggleChip
        appearance="quiet"
        selected={filter === "design"}
        count={inbox.length - modelCount}
        onClick={() => setModelFilter(filter === "design" ? null : "design")}
      >
        Needs designing
      </ToggleChip>
    </div>
  );
  const grid = (
    <>
      {filter && !rest.length && (
        // The filter that emptied the inbox stays right above, so this says which one takes you back.
        <p className="text-body text-ink-soft">
          {filter === "model"
            ? "Nothing here has a model yet. Tap “Has a model” again to see every idea."
            : "Everything here has a model. Tap “Needs designing” again to see every idea."}
        </p>
      )}
      <ul data-picks className={`${gridClass} relative`} aria-label="Ideas">
        <Reflow key={filter ?? "all"}>{rest.map(card)}</Reflow>
      </ul>
    </>
  );

  return (
    <>
      <PageHeader title="Ideas" subtitle="The inbox. Every print starts as a half-thought." />
      {isPending ? (
        <div className={gridClass} aria-hidden>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <CardSkeleton key={index} aspect="portrait" />
          ))}
        </div>
      ) : all.length || started.length ? (
        <>
          {!isDesktop && me && (
            // Its own boundary, holding its place, so the grid never waits for it or jumps when it lands.
            <Suspense fallback={<div className="mb-6 h-14" aria-hidden />}>
              <WishlistLink me={me} ideas={all} people={people ?? []} className="mb-6" />
            </Suspense>
          )}
          {queue.length > 0 && (
            <Section id="up-next-heading" title="Up next" count={queue.length} className="mb-8 md:mb-10">
              <UpNextStrip
                queue={queue}
                menuFor={menuFor}
                landed={(item) => item.id === landed || arrived.has(item.id)}
                dragFor={(item) =>
                  isDesktop && queue.length > 1
                    ? {
                        dragging: dragged === item.id,
                        over: over === item.id && dragged !== item.id,
                        onDragStart: () => setDragged(item.id),
                        onDragEnd: () => {
                          setDragged(null);
                          setOver(null);
                        },
                        onDragOver: () => setOver(item.id),
                        onDrop: () => {
                          if (dragged) dropUpNext(queryClient, queue, dragged, item.id);
                          setDragged(null);
                          setOver(null);
                        },
                      }
                    : undefined
                }
              />
            </Section>
          )}
          {!all.length && (
            <p className="text-body text-ink-soft mb-2">Nothing new in the pot. What you started is below.</p>
          )}
          {inbox.length > 0 &&
            (queue.length > 0 ? (
              <Section id="inbox-heading" title="The rest" aside={filters || undefined} asideAfter>
                {grid}
              </Section>
            ) : (
              <>
                {filters && <div className="mb-4 md:mb-5">{filters}</div>}
                {grid}
              </>
            ))}
          <StartedIdeas builds={builds} />
        </>
      ) : error ? (
        <IdeasUnreachable onRetry={() => void refetch()} />
      ) : (
        <IdeasEmpty />
      )}
      {!isPending && <RecentlyDeletedLink />}
    </>
  );
}

/** The server can't be reached and there is nothing to show yet. The offline strip above says why. */
function IdeasUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      illustration={<EmptyPot />}
      title="The pot is out of reach"
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      Your ideas will be here when the connection is back. Anything you capture meanwhile is kept on this device.
    </EmptyState>
  );
}

function IdeasEmpty() {
  const { setOpen } = useCapture();
  // On desktop the sidebar's "New idea" is the screen's one primary action.
  const isDesktop = useIsDesktop();
  return (
    <EmptyState
      illustration={<EmptyPot />}
      title="Nothing simmering yet"
      action={
        <Button
          variant={isDesktop ? "secondary" : "primary"}
          icon={PlusIcon}
          shortcut={shortcutCaps("capture")}
          onClick={() => setOpen(true)}
        >
          Capture an idea
        </Button>
      }
    >
      Snap a photo of something that could be printed, or jot down a line. Titles can wait; tidy up later.
    </EmptyState>
  );
}
