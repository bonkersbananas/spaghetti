import { modelOf } from "@shared/model-mark";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
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
const grid = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4";

/** How many cards a phone (or a laptop) shows before it scrolls: the rest draw after the first paint (useAfterPaint). */
const FIRST_SCREEN = { phone: 8, desktop: 12 };

function Ideas() {
  useListPicker();
  const after = useAfterPaint();
  const { items: all, isPending, error, refetch } = useIdeas();
  // "Has a model" / "Needs designing": one tap each, tap again to see everything. Only offered once an idea has a model.
  const [modelFilter, setModelFilter] = useState<"model" | "design" | null>(null);
  const modelCount = all.filter((item) => modelOf(item)).length;
  const filter = modelCount > 0 ? modelFilter : null;
  const items = filter ? all.filter((item) => !!modelOf(item) === (filter === "model")) : all;
  // Ideas that were started stay here, after the rest: they are the builds that began as an idea.
  const { items: builds } = useBuilds();
  const started = startedIdeas(builds);
  const { data: people } = useQuery(peopleQuery);
  const { data: user } = useQuery(sessionQuery);
  const me = user?.id;
  const { landed } = useCapture();
  const arrived = useArrived();
  const via = useVia();
  const byId = new Map(people?.map((person) => [person.id, person]));
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { queue, rest: everything } = splitQueue(items);
  // The cards below the fold wait for the first paint, so a tap on Ideas (or on a delete that lands here) shows the top
  // of the grid at once; a return to the page draws it whole, for the scroll position the router restores.
  const rest = after ? everything : everything.slice(0, isDesktop ? FIRST_SCREEN.desktop : FIRST_SCREEN.phone);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const menuFor = (item: (typeof items)[number], index: number): UpNextMenu => ({
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
    return id ? items.find((idea) => idea.id === id) : undefined;
  };
  const onPicked = (act: (idea: (typeof items)[number]) => void) => () => {
    const idea = picked();
    if (!idea || idea.pending) return;
    act(idea);
    // The card lands elsewhere in the page: the focused node is replaced, so find it again once it has.
    requestAnimationFrame(() =>
      setTimeout(
        () => document.querySelector<HTMLElement>(`main [data-picks] a[href="/ideas/${idea.id}"]`)?.focus(),
        0,
      ),
    );
  };
  useHotkeys({
    listUpNext: isDesktop
      ? onPicked((idea) => setUpNext(queryClient, idea, !queue.some((queued) => queued.id === idea.id)))
      : undefined,
    listMoveEarlier: isDesktop ? onPicked((idea) => moveUpNext(queryClient, queue, idea.id, -1)) : undefined,
    listMoveLater: isDesktop ? onPicked((idea) => moveUpNext(queryClient, queue, idea.id, 1)) : undefined,
  });
  const card = (item: (typeof items)[number]) => (
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

  return (
    <>
      <PageHeader title="Ideas" subtitle="The inbox. Every print starts as a half-thought." />
      {isPending ? (
        <div className={grid} aria-hidden>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <CardSkeleton key={index} aspect="portrait" />
          ))}
        </div>
      ) : all.length || started.length ? (
        <>
          {!isDesktop && me && (
            // Its own boundary, holding its place, so the grid never waits for it or jumps when it lands.
            <Suspense fallback={<div className="mb-8 h-16" aria-hidden />}>
              <WishlistLink me={me} ideas={all} people={people ?? []} className="mb-8" />
            </Suspense>
          )}
          {modelCount > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              <ToggleChip
                selected={filter === "model"}
                onClick={() => setModelFilter(filter === "model" ? null : "model")}
              >
                Has a model <span className="text-ink-faint font-medium">{modelCount}</span>
              </ToggleChip>
              <ToggleChip
                selected={filter === "design"}
                onClick={() => setModelFilter(filter === "design" ? null : "design")}
              >
                Needs designing <span className="text-ink-faint font-medium">{all.length - modelCount}</span>
              </ToggleChip>
            </div>
          )}
          {!items.length && (
            <p className="text-body text-ink-soft mb-2">
              {filter
                ? "Nothing here. Tap the chip again to see every idea."
                : "Nothing new in the pot. What you started is below."}
            </p>
          )}
          {queue.length > 0 && (
            <Section id="up-next-heading" title="Up next" size="title" count={queue.length} className="mb-8 md:mb-10">
              <UpNextStrip
                key={filter ?? "all"}
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
          {rest.length > 0 &&
            (queue.length > 0 ? (
              <Section id="inbox-heading" title="The rest" size="title">
                <ul data-picks className={`${grid} relative`} aria-label="Ideas">
                  <Reflow key={filter ?? "all"}>{rest.map(card)}</Reflow>
                </ul>
              </Section>
            ) : (
              <ul data-picks className={`${grid} relative`} aria-label="Ideas">
                <Reflow key={filter ?? "all"}>{rest.map(card)}</Reflow>
              </ul>
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
      className="py-10 md:py-20"
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
      className="py-10 md:py-20"
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
